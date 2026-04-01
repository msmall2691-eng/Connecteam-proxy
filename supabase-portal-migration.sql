-- ══════════════════════════════════════════════════════════════
-- Client Portal Migration
-- Adds portal_users table, service_requests table, and
-- portal-related columns to clients table
-- ══════════════════════════════════════════════════════════════

-- Portal users table (clients who can log in)
CREATE TABLE IF NOT EXISTS portal_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  temp_password BOOLEAN DEFAULT true,
  must_change_password BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  login_count INTEGER DEFAULT 0,
  reset_token TEXT,
  reset_token_expires TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;

-- Portal users can only read their own data
CREATE POLICY portal_users_self_read ON portal_users
  FOR SELECT USING (id = auth.uid());

-- Service-level access for API
CREATE POLICY portal_users_service ON portal_users
  FOR ALL USING (true) WITH CHECK (true);

-- Add portal_enabled flag to clients table
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_enabled BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_user_id UUID REFERENCES portal_users(id);

-- Service request table for portal
CREATE TABLE IF NOT EXISTS service_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id),
  portal_user_id UUID REFERENCES portal_users(id),
  type TEXT NOT NULL CHECK (type IN ('one-time', 'recurring', 'deep-clean', 'issue', 'change', 'cancel')),
  title TEXT NOT NULL,
  description TEXT,
  preferred_date DATE,
  preferred_time TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'approved', 'scheduled', 'declined', 'completed')),
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_portal_users_client_id ON portal_users(client_id);
CREATE INDEX IF NOT EXISTS idx_portal_users_email ON portal_users(email);
CREATE INDEX IF NOT EXISTS idx_service_requests_client_id ON service_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_status ON service_requests(status);

-- Update trigger for portal_users
CREATE TRIGGER update_portal_users_updated_at
  BEFORE UPDATE ON portal_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_service_requests_updated_at
  BEFORE UPDATE ON service_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
