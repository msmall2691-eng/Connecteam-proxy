-- Migration v7: Workflow enhancements
-- Adds: visit_status_history, Turno webhook support
-- Alters: visits (zone field), properties (zone field)
-- Deprecates: jobs.date, jobs.start_time, jobs.end_time (comments only — not dropped yet)
-- Run this in Supabase SQL Editor AFTER v6

-- ══════════════════════════════════════════
-- A. VISIT STATUS HISTORY (audit trail)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visit_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT DEFAULT 'system',
    -- 'system', 'admin', 'client', 'connecteam', or employee name
  notes TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visit_status_history_visit ON visit_status_history(visit_id);
CREATE INDEX IF NOT EXISTS idx_visit_status_history_date ON visit_status_history(changed_at);

ALTER TABLE visit_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access to visit_status_history" ON visit_status_history FOR ALL USING (true) WITH CHECK (true);

-- ══════════════════════════════════════════
-- B. TRIGGER: Auto-log visit status changes
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION log_visit_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO visit_status_history (visit_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, 'system');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS visit_status_change_trigger ON visits;
CREATE TRIGGER visit_status_change_trigger
  AFTER UPDATE ON visits FOR EACH ROW
  EXECUTE FUNCTION log_visit_status_change();

-- ══════════════════════════════════════════
-- C. ZONE FIELD on visits and properties (for route optimization)
-- ══════════════════════════════════════════
ALTER TABLE visits ADD COLUMN IF NOT EXISTS zone TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS zone TEXT;

CREATE INDEX IF NOT EXISTS idx_visits_zone ON visits(zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_zone ON properties(zone) WHERE zone IS NOT NULL;

-- ══════════════════════════════════════════
-- D. TURNO INTEGRATION FIELDS
-- ══════════════════════════════════════════
-- visits already has turno_task_id from v6
-- Add Turno config fields to properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS turno_listing_id TEXT;
  -- Turno listing ID for webhook matching

CREATE INDEX IF NOT EXISTS idx_properties_turno ON properties(turno_listing_id) WHERE turno_listing_id IS NOT NULL;

-- ══════════════════════════════════════════
-- E. CONFIRMATION TOKEN on visits (for SMS/email confirm links)
-- ══════════════════════════════════════════
ALTER TABLE visits ADD COLUMN IF NOT EXISTS confirm_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_visits_confirm_token ON visits(confirm_token) WHERE confirm_token IS NOT NULL;

-- ══════════════════════════════════════════
-- F. DEPRECATION COMMENTS on jobs table
-- Jobs are now service agreements. These fields are still populated
-- for backward compatibility but visits are the source of truth.
-- ══════════════════════════════════════════
COMMENT ON COLUMN jobs.date IS 'DEPRECATED v7: Use visits.scheduled_date instead. Kept for backward compat.';
COMMENT ON COLUMN jobs.start_time IS 'DEPRECATED v7: Use jobs.preferred_start_time or visits.scheduled_start_time instead.';
COMMENT ON COLUMN jobs.end_time IS 'DEPRECATED v7: Use jobs.preferred_end_time or visits.scheduled_end_time instead.';
COMMENT ON COLUMN jobs.status IS 'DEPRECATED v7: Job-level status is active/paused. Per-occurrence status lives on visits.';
COMMENT ON COLUMN jobs.google_event_id IS 'DEPRECATED v7: Calendar sync tracked via calendar_sync_log on visits.';
COMMENT ON COLUMN jobs.service_type IS 'DEPRECATED v7: Use jobs.service_type_id FK instead.';
