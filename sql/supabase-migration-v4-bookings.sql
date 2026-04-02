-- Migration v4: Self-booking feature
-- Adds booking_requests table for website self-booking with admin approval workflow

CREATE TABLE IF NOT EXISTS booking_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  website_booking_id INTEGER,
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  service_type TEXT NOT NULL DEFAULT 'standard',
  frequency TEXT DEFAULT 'one-time',
  sqft INTEGER,
  bathrooms INTEGER,
  pet_hair TEXT DEFAULT 'none',
  condition TEXT DEFAULT 'maintenance',
  estimate_min INTEGER,
  estimate_max INTEGER,
  requested_date DATE NOT NULL,
  distance_miles INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
  admin_notes TEXT,
  assignee TEXT,
  google_event_id TEXT,
  connecteam_shift_id TEXT,
  job_id UUID REFERENCES jobs(id),
  source TEXT DEFAULT 'Website',
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for filtering by status (most common query)
CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_booking_requests_date ON booking_requests(requested_date);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_booking_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_requests_updated_at ON booking_requests;
CREATE TRIGGER booking_requests_updated_at
  BEFORE UPDATE ON booking_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_booking_requests_updated_at();

-- Enable RLS
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to booking_requests"
  ON booking_requests FOR ALL
  USING (true)
  WITH CHECK (true);
