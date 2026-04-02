-- Migration v8: Campaigns, Sequences, and Review Request support
-- Adds campaigns (blast + drip sequences), campaign steps, enrollment tracking
-- Adds review_request_sent_at to visits table

-- ════════════════════════════════════════════════
-- Campaigns table (blasts and sequences)
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('blast', 'sequence')),
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email', 'both')),
  subject TEXT,
  body TEXT,
  audience JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'active', 'paused', 'completed')),
  sent_at TIMESTAMPTZ,
  sent_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════
-- Campaign steps (for sequences/drip campaigns)
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  delay_days INTEGER NOT NULL DEFAULT 0,
  channel TEXT DEFAULT 'sms' CHECK (channel IN ('sms', 'email', 'both')),
  subject TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id);

-- ════════════════════════════════════════════════
-- Campaign enrollments (clients in active sequences)
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  trigger TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  current_step INTEGER DEFAULT 0,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  last_step_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_enrollments_campaign ON campaign_enrollments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_enrollments_client ON campaign_enrollments(client_id);
CREATE INDEX IF NOT EXISTS idx_campaign_enrollments_status ON campaign_enrollments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_enrollments_unique ON campaign_enrollments(campaign_id, client_id) WHERE status = 'active';

-- ════════════════════════════════════════════════
-- Sequence triggers (auto-enroll on lead stage change)
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sequence_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('lead_stage_change', 'tag_added', 'visit_completed', 'booking_request')),
  trigger_value TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequence_triggers_campaign ON sequence_triggers(campaign_id);

-- ════════════════════════════════════════════════
-- Add review request tracking to visits
-- ════════════════════════════════════════════════
ALTER TABLE visits ADD COLUMN IF NOT EXISTS review_request_sent_at TIMESTAMPTZ;

-- ════════════════════════════════════════════════
-- Trigger: auto-enroll clients in sequences on lead status change
-- ════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trigger_sequence_on_client_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO campaign_enrollments (campaign_id, client_id, trigger, status, enrolled_at)
    SELECT st.campaign_id, NEW.id, 'lead_stage_change:' || NEW.status, 'active', NOW()
    FROM sequence_triggers st
    JOIN campaigns c ON c.id = st.campaign_id
    WHERE st.trigger_type = 'lead_stage_change'
      AND st.trigger_value = NEW.status
      AND st.is_active = true
      AND c.status IN ('active', 'draft')
      AND NOT EXISTS (
        SELECT 1 FROM campaign_enrollments ce
        WHERE ce.campaign_id = st.campaign_id
          AND ce.client_id = NEW.id
          AND ce.status = 'active'
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sequence_on_client_update ON clients;
CREATE TRIGGER trg_sequence_on_client_update
  AFTER UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sequence_on_client_update();
