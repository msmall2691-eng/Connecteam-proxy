-- Migration v6: Scheduling Redesign
-- Goal: Make visits the single source of truth for the schedule.
-- Jobs become service agreements (what/who/how often/price).
-- Visits become the operational calendar (every individual occurrence).
-- Adds: visit_reminders, calendar_sync_log, client_schedule_tokens
-- Alters: jobs (recurrence cleanup), visits (source tracking)
-- Run this in Supabase SQL Editor AFTER all previous migrations (v1-v5)

-- ══════════════════════════════════════════
-- A. CLEAN UP JOBS — make it a service agreement only
-- ══════════════════════════════════════════

-- Remove the single-occurrence date/time from jobs.
-- These belong on visits. Keep them temporarily for data migration,
-- then drop after migrating existing job rows into visits.

-- Add proper recurrence fields
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurrence_start_date DATE;
  -- when the recurring service begins
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;
  -- null = ongoing, set a date to end the agreement
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preferred_start_time TIME DEFAULT '09:00';
  -- default start time for generated visits
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preferred_end_time TIME DEFAULT '12:00';
  -- default end time for generated visits
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS visit_generation_horizon_weeks INTEGER DEFAULT 8;
  -- how far ahead to auto-generate visits
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_visit_generated_date DATE;
  -- tracks how far we've generated visits
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
  CHECK (source IN ('manual', 'quote', 'booking_request', 'ical_sync', 'turno'));
  -- how this job was created
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
  -- soft toggle to pause a recurring job without deleting it

-- Fix service_type_id: should be required for new jobs
-- (can't make NOT NULL yet because existing rows may be null)
-- We'll backfill, then add the constraint

-- ══════════════════════════════════════════
-- B. ENHANCE VISITS — the canonical schedule
-- ══════════════════════════════════════════

-- Add source tracking so we know how each visit was created
ALTER TABLE visits ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'recurring'
  CHECK (source IN ('recurring', 'one_off', 'ical_sync', 'turno', 'manual', 'booking'));
  -- recurring = auto-generated from parent job recurrence
  -- one_off = from a non-recurring job
  -- ical_sync = created by iCal turnover scan
  -- turno = imported from Turno integration
  -- manual = manually added by admin
  -- booking = from a client booking request

ALTER TABLE visits ADD COLUMN IF NOT EXISTS service_type_id UUID REFERENCES service_types(id) ON DELETE SET NULL;
  -- denormalized from job for fast queries without join

ALTER TABLE visits ADD COLUMN IF NOT EXISTS client_visible BOOLEAN DEFAULT TRUE;
  -- whether this visit shows in the client portal

ALTER TABLE visits ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;
  -- when the last reminder was sent for this visit

ALTER TABLE visits ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
  -- when the client confirmed this visit

ALTER TABLE visits ADD COLUMN IF NOT EXISTS ical_event_uid TEXT;
  -- links back to the source iCal event (for STR turnovers)

ALTER TABLE visits ADD COLUMN IF NOT EXISTS turno_task_id TEXT;
  -- links to Turno task if imported from Turno

ALTER TABLE visits ADD COLUMN IF NOT EXISTS instructions TEXT;
  -- per-visit special instructions (override job-level)

ALTER TABLE visits ADD COLUMN IF NOT EXISTS address TEXT;
  -- denormalized for quick schedule views without joining properties

-- Better index for schedule queries
CREATE INDEX IF NOT EXISTS idx_visits_schedule
  ON visits(scheduled_date, status)
  WHERE status NOT IN ('cancelled', 'skipped');

CREATE INDEX IF NOT EXISTS idx_visits_client_upcoming
  ON visits(client_id, scheduled_date)
  WHERE status IN ('scheduled', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_visits_ical_uid
  ON visits(ical_event_uid)
  WHERE ical_event_uid IS NOT NULL;

-- ══════════════════════════════════════════
-- C. VISIT REMINDERS (track what was sent)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visit_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'delivered', 'failed', 'bounced')),
  message_id TEXT,
    -- external ID (Gmail message ID or Twilio SID)
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_reminders_visit ON visit_reminders(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_reminders_sent ON visit_reminders(sent_at);

-- ══════════════════════════════════════════
-- D. CALENDAR SYNC LOG (track what's synced where)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS calendar_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'connecteam', 'ical')),
  external_id TEXT NOT NULL,
    -- google_event_id, connecteam_shift_id, or ical UID
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    -- outbound = we pushed to external, inbound = we pulled from external
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'synced'
    CHECK (sync_status IN ('synced', 'pending', 'failed', 'stale')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_sync_visit_provider
  ON calendar_sync_log(visit_id, provider);

CREATE INDEX IF NOT EXISTS idx_calendar_sync_external
  ON calendar_sync_log(provider, external_id);

-- ══════════════════════════════════════════
-- E. CLIENT SCHEDULE TOKENS (client portal access)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS client_schedule_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
    -- random token for URL: /portal/schedule/{token}
  expires_at TIMESTAMPTZ,
    -- null = never expires
  is_active BOOLEAN DEFAULT TRUE,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_token_lookup
  ON client_schedule_tokens(token) WHERE is_active = TRUE;

-- ══════════════════════════════════════════
-- F. BACKFILL: Migrate existing jobs → visits
-- ══════════════════════════════════════════
-- For every non-recurring job that has a date, create a corresponding visit
-- (only if no visit exists for that job yet)
INSERT INTO visits (job_id, client_id, property_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, source)
SELECT
  j.id,
  j.client_id,
  j.property_id,
  j.date,
  j.start_time,
  j.end_time,
  CASE
    WHEN j.status = 'completed' THEN 'completed'
    WHEN j.status = 'cancelled' THEN 'cancelled'
    WHEN j.status = 'in-progress' THEN 'in_progress'
    ELSE 'scheduled'
  END,
  CASE
    WHEN j.is_recurring THEN 'recurring'
    ELSE 'one_off'
  END
FROM jobs j
WHERE j.client_id IS NOT NULL
  AND j.date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.scheduled_date = j.date
  );

-- Backfill jobs recurrence fields from existing data
UPDATE jobs SET
  recurrence_start_date = date,
  preferred_start_time = COALESCE(start_time, '09:00'),
  preferred_end_time = COALESCE(end_time, '12:00'),
  last_visit_generated_date = date
WHERE is_recurring = TRUE AND recurrence_start_date IS NULL;

-- Backfill service_type_id from free-text service_type field
UPDATE jobs SET service_type_id = st.id
FROM service_types st
WHERE jobs.service_type_id IS NULL
  AND jobs.title IS NOT NULL
  AND (
    -- Match by service_type text field (from quote/booking)
    (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%turnover%' AND st.name = 'Turnover')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%deep%' AND st.name = 'Deep Clean')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%move-out%' AND st.name = 'Move-Out')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%move-in%' AND st.name = 'Move-In')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%post-construction%' AND st.name = 'Post-Construction')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%janitorial%' AND st.name = 'Janitorial')
  );

-- Default remaining jobs to Standard Clean
UPDATE jobs SET service_type_id = (SELECT id FROM service_types WHERE name = 'Standard Clean' LIMIT 1)
WHERE service_type_id IS NULL;

-- ══════════════════════════════════════════
-- G. ROW LEVEL SECURITY
-- ══════════════════════════════════════════
ALTER TABLE visit_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_schedule_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access to visit_reminders" ON visit_reminders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to calendar_sync_log" ON calendar_sync_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to client_schedule_tokens" ON client_schedule_tokens FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════
-- H. HELPER: Function to generate visits for a recurring job
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION generate_recurring_visits(
  p_job_id UUID,
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS INTEGER AS $$
DECLARE
  v_job RECORD;
  v_current_date DATE;
  v_end_date DATE;
  v_interval INTERVAL;
  v_count INTEGER := 0;
BEGIN
  SELECT * INTO v_job FROM jobs WHERE id = p_job_id AND is_recurring = TRUE AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Determine recurrence interval
  v_interval := CASE v_job.recurrence_rule
    WHEN 'weekly' THEN INTERVAL '1 week'
    WHEN 'biweekly' THEN INTERVAL '2 weeks'
    WHEN 'monthly' THEN INTERVAL '1 month'
    ELSE INTERVAL '1 week'
  END;

  -- Start from the later of: last generated date + interval, or recurrence_start_date
  v_current_date := GREATEST(
    COALESCE(v_job.last_visit_generated_date + v_interval, v_job.recurrence_start_date),
    COALESCE(v_job.recurrence_start_date, CURRENT_DATE)
  );

  -- End date: min of recurrence_end_date and horizon
  v_end_date := LEAST(
    COALESCE(v_job.recurrence_end_date, CURRENT_DATE + (p_horizon_weeks * 7)),
    CURRENT_DATE + (p_horizon_weeks * 7)
  );

  WHILE v_current_date <= v_end_date LOOP
    -- Skip if visit already exists for this job+date
    IF NOT EXISTS (
      SELECT 1 FROM visits WHERE job_id = p_job_id AND scheduled_date = v_current_date
    ) THEN
      INSERT INTO visits (
        job_id, client_id, property_id, scheduled_date,
        scheduled_start_time, scheduled_end_time,
        status, source, service_type_id,
        assigned_employee_id, assigned_team_id,
        address, instructions, client_visible
      )
      SELECT
        v_job.id, v_job.client_id, v_job.property_id, v_current_date,
        COALESCE(v_job.preferred_start_time, '09:00'),
        COALESCE(v_job.preferred_end_time, '12:00'),
        'scheduled', 'recurring', v_job.service_type_id,
        v_job.assigned_employee_id, v_job.assigned_team_id,
        p.address_line1, v_job.instructions, TRUE
      FROM properties p WHERE p.id = v_job.property_id;

      -- If no property, insert without address
      IF NOT FOUND THEN
        INSERT INTO visits (
          job_id, client_id, property_id, scheduled_date,
          scheduled_start_time, scheduled_end_time,
          status, source, service_type_id,
          assigned_employee_id, assigned_team_id,
          instructions, client_visible
        ) VALUES (
          v_job.id, v_job.client_id, v_job.property_id, v_current_date,
          COALESCE(v_job.preferred_start_time, '09:00'),
          COALESCE(v_job.preferred_end_time, '12:00'),
          'scheduled', 'recurring', v_job.service_type_id,
          v_job.assigned_employee_id, v_job.assigned_team_id,
          v_job.instructions, TRUE
        );
      END IF;

      v_count := v_count + 1;
    END IF;

    v_current_date := v_current_date + v_interval;
  END LOOP;

  -- Update last generated date
  UPDATE jobs SET last_visit_generated_date = v_end_date WHERE id = p_job_id;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════
-- I. HELPER: Generate visits for ALL active recurring jobs
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION generate_all_recurring_visits(
  p_horizon_weeks INTEGER DEFAULT 8
)
RETURNS TABLE(job_id UUID, visits_created INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT j.id, generate_recurring_visits(j.id, p_horizon_weeks)
  FROM jobs j
  WHERE j.is_recurring = TRUE AND j.is_active = TRUE;
END;
$$ LANGUAGE plpgsql;
