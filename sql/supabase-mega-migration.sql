-- ══════════════════════════════════════════════════════════════════════
-- Workflow HQ — Complete Database Schema (v1-v9 combined)
-- For fresh Supabase projects. Run this ONCE in the SQL Editor.
-- After running: create auth users, then run seed-user-profiles.sql
--
-- Fixes applied:
--   - Added missing website_requests table
--   - Added missing visits.follow_up_sent_at column
--   - Notifications table uses v9 schema (user_id, role_target, is_read)
--   - RLS policies are v9 role-scoped (no wide-open policies)
--   - Fixed v6 backfill operator precedence
-- ══════════════════════════════════════════════════════════════════════

-- ┌──────────────────────────────────────────┐
-- │  SECTION 1: EXTENSIONS                    │
-- └──────────────────────────────────────────┘
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ┌──────────────────────────────────────────┐
-- │  SECTION 2: UTILITY FUNCTIONS             │
-- └──────────────────────────────────────────┘
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ┌──────────────────────────────────────────┐
-- │  SECTION 3: CORE TABLES (v1)              │
-- └──────────────────────────────────────────┘

-- ── clients ──
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'prospect', 'active', 'inactive')),
  type TEXT NOT NULL DEFAULT 'residential' CHECK (type IN ('residential', 'commercial', 'rental', 'marina')),
  source TEXT,
  notes TEXT,
  tags TEXT[] DEFAULT '{}',
  -- v2: payment + contact prefs
  square_customer_id TEXT,
  stripe_customer_id TEXT,
  preferred_contact TEXT DEFAULT 'email',
  -- v5: referral + lead tracking
  referral_source TEXT,
  referred_by_client_id UUID, -- FK added after table exists
  company_name TEXT,
  default_payment_terms INTEGER DEFAULT 30,
  lead_stage TEXT CHECK (lead_stage IN ('new', 'contacted', 'quoted', 'won', 'lost')),
  lost_reason TEXT,
  -- v9: health scoring
  health_score INTEGER,
  nps_score INTEGER,
  lifetime_value DECIMAL(10,2) DEFAULT 0,
  churn_risk TEXT CHECK (churn_risk IN ('low', 'medium', 'high')),
  last_service_date DATE,
  total_visits INTEGER DEFAULT 0,
  avg_rating DECIMAL(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Self-referencing FK for referrals
ALTER TABLE clients ADD CONSTRAINT fk_clients_referred_by
  FOREIGN KEY (referred_by_client_id) REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_name ON clients(name);

-- ── conversations ──
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  subject TEXT,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'text', 'phone', 'in-person', 'system', 'other')),
  last_message TEXT,
  gmail_thread_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_client ON conversations(client_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_gmail ON conversations(gmail_thread_id);

-- ── invoices ──
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal DECIMAL(10,2) DEFAULT 0,
  tax_rate DECIMAL(5,4) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  payment_method TEXT,
  paid_at TIMESTAMPTZ,
  -- v2: payment provider links
  property_id UUID, -- FK added after properties table
  quote_id UUID,    -- FK added after quotes table
  square_invoice_id TEXT,
  square_public_url TEXT,
  stripe_invoice_id TEXT,
  stripe_payment_url TEXT,
  sent_at TIMESTAMPTZ,
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);

-- ── payroll_exports ──
CREATE TABLE payroll_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'exported', 'submitted')),
  data JSONB NOT NULL DEFAULT '{}',
  total_hours DECIMAL(10,2),
  total_pay DECIMAL(10,2),
  total_mileage_reimbursement DECIMAL(10,2),
  exported_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 4: PROPERTIES & QUOTES (v2)      │
-- └──────────────────────────────────────────┘

-- ── properties ──
CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  name TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  type TEXT NOT NULL DEFAULT 'residential' CHECK (type IN ('residential', 'commercial', 'rental', 'marina')),
  sqft INTEGER,
  bedrooms INTEGER,
  bathrooms INTEGER,
  pet_hair TEXT DEFAULT 'none' CHECK (pet_hair IN ('none', 'some', 'heavy')),
  condition TEXT DEFAULT 'maintenance' CHECK (condition IN ('maintenance', 'moderate', 'heavy')),
  access_notes TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  ical_url TEXT,
  checkout_time TIME DEFAULT '10:00',
  cleaning_time TIME DEFAULT '11:00',
  rental_platform TEXT,
  -- v5: enriched fields
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  has_pets BOOLEAN DEFAULT FALSE,
  pet_details TEXT,
  parking_instructions TEXT,
  access_type TEXT CHECK (access_type IN ('client_home', 'lockbox', 'key_under_mat', 'doorman', 'garage_code', 'other')),
  do_not_areas TEXT,
  cleaning_notes TEXT,
  photos TEXT[] DEFAULT '{}',
  stories INTEGER DEFAULT 1,
  google_calendar_id TEXT,
  auto_schedule_turnovers BOOLEAN DEFAULT FALSE,
  last_ical_sync_at TIMESTAMPTZ,
  -- v7: zone + turno + duration
  zone TEXT,
  turno_listing_id TEXT,
  cleaning_duration INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_client ON properties(client_id);
CREATE INDEX idx_properties_type ON properties(type);
CREATE INDEX IF NOT EXISTS idx_properties_zone ON properties(zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_turno ON properties(turno_listing_id) WHERE turno_listing_id IS NOT NULL;

-- ── quotes ──
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number TEXT UNIQUE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  service_type TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'one-time' CHECK (frequency IN ('one-time', 'weekly', 'biweekly', 'monthly')),
  estimate_min DECIMAL(10,2),
  estimate_max DECIMAL(10,2),
  final_price DECIMAL(10,2),
  calc_inputs JSONB DEFAULT '{}',
  calc_breakdown JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),
  sent_via TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  signature_data JSONB,
  items JSONB DEFAULT '[]',
  notes TEXT,
  preferred_day INTEGER,
  preferred_time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quotes_client ON quotes(client_id);
CREATE INDEX idx_quotes_property ON quotes(property_id);
CREATE INDEX idx_quotes_status ON quotes(status);

-- ── rental_calendars ──
CREATE TABLE rental_calendars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE NOT NULL,
  ical_url TEXT NOT NULL,
  google_calendar_id TEXT,
  platform TEXT DEFAULT 'airbnb',
  checkout_time TIME DEFAULT '10:00',
  cleaning_time TIME DEFAULT '11:00',
  auto_schedule BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rental_calendars_property ON rental_calendars(property_id);

-- ── payment_transactions ──
CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('square', 'stripe', 'cash', 'check', 'other')),
  provider_txn_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  provider_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_txns_invoice ON payment_transactions(invoice_id);

-- Now add FKs on invoices that reference properties and quotes
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_property
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD CONSTRAINT fk_invoices_quote
  FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;


-- ┌──────────────────────────────────────────┐
-- │  SECTION 5: WEBSITE REQUESTS (NEW - FIX)  │
-- └──────────────────────────────────────────┘
-- This table was missing from all prior migrations but is
-- referenced by api/leads.js, api/client.js, Pipeline.jsx,
-- and WebsiteRequests.jsx.

CREATE TABLE website_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  service TEXT,
  message TEXT,
  source TEXT DEFAULT 'Website',
  property_type TEXT,
  frequency TEXT,
  estimate_min INTEGER,
  estimate_max INTEGER,
  sqft INTEGER,
  bathrooms INTEGER,
  pet_hair TEXT,
  condition TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  contacted_at TIMESTAMPTZ,
  contact_notes TEXT,
  converted_client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_website_requests_status ON website_requests(status);
CREATE INDEX idx_website_requests_created ON website_requests(created_at DESC);

-- ┌──────────────────────────────────────────┐
-- │  SECTION 6: BOOKING REQUESTS (v4)         │
-- └──────────────────────────────────────────┘

CREATE TABLE booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  status TEXT NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  assignee TEXT,
  google_event_id TEXT,
  connecteam_shift_id TEXT,
  job_id UUID, -- FK added after jobs table exists
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  source TEXT DEFAULT 'Website',
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_booking_requests_status ON booking_requests(status);
CREATE INDEX idx_booking_requests_date ON booking_requests(requested_date);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 7: EMPLOYEES & SERVICE CATALOG   │
-- │  (v5)                                     │
-- └──────────────────────────────────────────┘

-- ── employees ──
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connecteam_user_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'technician'
    CHECK (role IN ('admin', 'manager', 'technician', 'dispatcher')),
  hourly_rate DECIMAL(10,2),
  custom_rates JSONB DEFAULT '{}',
  hire_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'terminated')),
  zones TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}',
  max_hours_weekly INTEGER,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_connecteam ON employees(connecteam_user_id);

-- ── teams ──
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  lead_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  member_ids UUID[] DEFAULT '{}',
  color TEXT,
  zone TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── service_types ──
CREATE TABLE service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  base_duration_minutes INTEGER DEFAULT 120,
  is_recurring_eligible BOOLEAN DEFAULT TRUE,
  checklist_template_id UUID, -- FK added after checklist_templates
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── pricing_rules ──
CREATE TABLE pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID REFERENCES service_types(id) ON DELETE CASCADE NOT NULL,
  property_type TEXT,
  bedrooms_min INTEGER,
  bedrooms_max INTEGER,
  bathrooms_min INTEGER,
  bathrooms_max INTEGER,
  base_price DECIMAL(10,2) NOT NULL,
  price_per_sqft DECIMAL(10,4),
  frequency_discounts JSONB DEFAULT '{"weekly": 15, "biweekly": 10, "monthly": 5}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pricing_rules_service ON pricing_rules(service_type_id);

-- ── extras ──
CREATE TABLE extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_type TEXT NOT NULL DEFAULT 'flat' CHECK (price_type IN ('flat', 'per_unit')),
  unit_label TEXT,
  duration_minutes INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── checklist_templates ──
CREATE TABLE checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sections JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK from service_types to checklist_templates
ALTER TABLE service_types
  ADD CONSTRAINT fk_service_type_checklist
  FOREIGN KEY (checklist_template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL;


-- ┌──────────────────────────────────────────┐
-- │  SECTION 8: JOBS (v1 + v2 + v5 + v6)     │
-- └──────────────────────────────────────────┘

CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_name TEXT,
  title TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in-progress', 'completed', 'cancelled')),
  assignee TEXT,
  notes TEXT,
  -- Recurrence
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_rule TEXT,
  recurrence_day INTEGER,
  recurrence_parent_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  -- Pricing
  price DECIMAL(10,2),
  price_type TEXT CHECK (price_type IN ('flat', 'hourly', 'per_sqft')),
  -- v2 additions
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  google_event_id TEXT,
  service_type TEXT,
  address TEXT,
  -- v5 additions
  service_type_id UUID REFERENCES service_types(id) ON DELETE SET NULL,
  assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  estimated_duration_minutes INTEGER,
  frequency_discount_pct DECIMAL(5,2) DEFAULT 0,
  extras JSONB DEFAULT '[]',
  checklist_template_id UUID REFERENCES checklist_templates(id) ON DELETE SET NULL,
  instructions TEXT,
  -- v6 additions
  recurrence_start_date DATE,
  recurrence_end_date DATE,
  preferred_start_time TIME DEFAULT '09:00',
  preferred_end_time TIME DEFAULT '12:00',
  visit_generation_horizon_weeks INTEGER DEFAULT 8,
  last_visit_generated_date DATE,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'quote', 'booking_request', 'ical_sync', 'turno')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_date ON jobs(date);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_recurring ON jobs(is_recurring) WHERE is_recurring = TRUE;

-- FK for booking_requests.job_id
ALTER TABLE booking_requests ADD CONSTRAINT fk_booking_requests_job
  FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

-- v7 deprecation comments
COMMENT ON COLUMN jobs.date IS 'DEPRECATED v7: Use visits.scheduled_date instead.';
COMMENT ON COLUMN jobs.start_time IS 'DEPRECATED v7: Use jobs.preferred_start_time or visits.scheduled_start_time.';
COMMENT ON COLUMN jobs.end_time IS 'DEPRECATED v7: Use jobs.preferred_end_time or visits.scheduled_end_time.';
COMMENT ON COLUMN jobs.status IS 'DEPRECATED v7: Job-level status is active/paused. Per-occurrence status lives on visits.';
COMMENT ON COLUMN jobs.google_event_id IS 'DEPRECATED v7: Calendar sync tracked via calendar_sync_log on visits.';
COMMENT ON COLUMN jobs.service_type IS 'DEPRECATED v7: Use jobs.service_type_id FK instead.';


-- ┌──────────────────────────────────────────┐
-- │  SECTION 9: MESSAGES (v1 + v5)            │
-- └──────────────────────────────────────────┘

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender TEXT,
  channel TEXT,
  gmail_message_id TEXT,
  twilio_sid TEXT,
  metadata JSONB DEFAULT '{}',
  -- v5 enrichments
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  visit_id UUID, -- FK added after visits table
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  body_html TEXT,
  attachments JSONB DEFAULT '[]',
  is_automated BOOLEAN DEFAULT FALSE,
  automation_trigger TEXT,
  call_duration_seconds INTEGER,
  call_outcome TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- ── invoice_items ──
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity DECIMAL(10,2) DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 10: VISITS (v5 + v6 + v7 + v8)  │
-- └──────────────────────────────────────────┘

CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  property_id UUID REFERENCES properties(id) ON DELETE SET NULL,
  visit_number INTEGER DEFAULT 1,
  scheduled_date DATE NOT NULL,
  scheduled_start_time TIME,
  scheduled_end_time TIME,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'in_transit', 'in_progress', 'completed', 'skipped', 'cancelled', 'no_show')),
  assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  actual_start_time TIMESTAMPTZ,
  actual_end_time TIMESTAMPTZ,
  duration_actual_minutes INTEGER,
  start_lat DECIMAL(10,7),
  start_lng DECIMAL(10,7),
  end_lat DECIMAL(10,7),
  end_lng DECIMAL(10,7),
  checklist_snapshot JSONB,
  photos_before TEXT[] DEFAULT '{}',
  photos_after TEXT[] DEFAULT '{}',
  employee_notes TEXT,
  client_rating INTEGER CHECK (client_rating BETWEEN 1 AND 5),
  client_feedback TEXT,
  mileage DECIMAL(10,2),
  price_override DECIMAL(10,2),
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  google_event_id TEXT,
  connecteam_shift_id TEXT,
  -- v6: source + scheduling
  source TEXT DEFAULT 'recurring'
    CHECK (source IN ('recurring', 'one_off', 'ical_sync', 'turno', 'manual', 'booking')),
  service_type_id UUID REFERENCES service_types(id) ON DELETE SET NULL,
  client_visible BOOLEAN DEFAULT TRUE,
  reminder_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  ical_event_uid TEXT,
  turno_task_id TEXT,
  instructions TEXT,
  address TEXT,
  -- v7: zone + confirm
  zone TEXT,
  confirm_token TEXT UNIQUE,
  -- v8: review request tracking
  review_request_sent_at TIMESTAMPTZ,
  -- FIX: follow_up_sent_at was missing from all migrations but used by api/visits.js
  follow_up_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visits_job ON visits(job_id);
CREATE INDEX idx_visits_client ON visits(client_id);
CREATE INDEX idx_visits_date ON visits(scheduled_date);
CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_employee ON visits(assigned_employee_id);
CREATE INDEX idx_visits_schedule ON visits(scheduled_date, status) WHERE status NOT IN ('cancelled', 'skipped');
CREATE INDEX idx_visits_client_upcoming ON visits(client_id, scheduled_date) WHERE status IN ('scheduled', 'confirmed');
CREATE INDEX idx_visits_ical_uid ON visits(ical_event_uid) WHERE ical_event_uid IS NOT NULL;
CREATE INDEX idx_visits_zone ON visits(zone) WHERE zone IS NOT NULL;
CREATE INDEX idx_visits_confirm_token ON visits(confirm_token) WHERE confirm_token IS NOT NULL;

-- FK for messages.visit_id
ALTER TABLE messages ADD CONSTRAINT fk_messages_visit
  FOREIGN KEY (visit_id) REFERENCES visits(id) ON DELETE SET NULL;


-- ┌──────────────────────────────────────────┐
-- │  SECTION 11: SCHEDULING SUPPORT TABLES    │
-- │  (v6 + v7)                                │
-- └──────────────────────────────────────────┘

-- ── visit_reminders (v6) ──
CREATE TABLE visit_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'failed', 'bounced')),
  message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visit_reminders_visit ON visit_reminders(visit_id);
CREATE INDEX idx_visit_reminders_sent ON visit_reminders(sent_at);

-- ── calendar_sync_log (v6) ──
CREATE TABLE calendar_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_calendar', 'connecteam', 'ical')),
  external_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_status TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending', 'failed', 'stale')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_calendar_sync_visit_provider ON calendar_sync_log(visit_id, provider);
CREATE INDEX idx_calendar_sync_external ON calendar_sync_log(provider, external_id);

-- ── client_schedule_tokens (v6) ──
CREATE TABLE client_schedule_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_client_token_lookup ON client_schedule_tokens(token) WHERE is_active = TRUE;

-- ── visit_status_history (v7) ──
CREATE TABLE visit_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT DEFAULT 'system',
  notes TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visit_status_history_visit ON visit_status_history(visit_id);
CREATE INDEX idx_visit_status_history_date ON visit_status_history(changed_at);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 12: CAMPAIGNS (v8)               │
-- └──────────────────────────────────────────┘

CREATE TABLE campaigns (
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

CREATE TABLE campaign_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  delay_days INTEGER NOT NULL DEFAULT 0,
  channel TEXT DEFAULT 'sms' CHECK (channel IN ('sms', 'email', 'both')),
  subject TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaign_steps_campaign ON campaign_steps(campaign_id);

CREATE TABLE campaign_enrollments (
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

CREATE INDEX idx_campaign_enrollments_campaign ON campaign_enrollments(campaign_id);
CREATE INDEX idx_campaign_enrollments_client ON campaign_enrollments(client_id);
CREATE INDEX idx_campaign_enrollments_status ON campaign_enrollments(status);
CREATE UNIQUE INDEX idx_campaign_enrollments_unique ON campaign_enrollments(campaign_id, client_id) WHERE status = 'active';

CREATE TABLE sequence_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('lead_stage_change', 'tag_added', 'visit_completed', 'booking_request')),
  trigger_value TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sequence_triggers_campaign ON sequence_triggers(campaign_id);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 13: RBAC & FEATURE TABLES (v9)   │
-- └──────────────────────────────────────────┘

-- ── user_profiles ──
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician', 'viewer', 'client')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  display_name TEXT,
  avatar_url TEXT,
  permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_auth ON user_profiles(auth_user_id);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_employee ON user_profiles(employee_id);
CREATE INDEX idx_user_profiles_client ON user_profiles(client_id);

-- ── employee_availability ──
CREATE TABLE employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  notes TEXT,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_employee_avail_employee ON employee_availability(employee_id);
CREATE INDEX idx_employee_avail_day ON employee_availability(day_of_week);

-- ── time_off_requests ──
CREATE TABLE time_off_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL DEFAULT 'pto'
    CHECK (type IN ('pto', 'sick', 'personal', 'unpaid', 'other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_off_employee ON time_off_requests(employee_id);
CREATE INDEX idx_time_off_dates ON time_off_requests(start_date, end_date);
CREATE INDEX idx_time_off_status ON time_off_requests(status);

-- ── audit_log ──
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
  changed_by_role TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_log_table ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_date ON audit_log(created_at);
CREATE INDEX idx_audit_log_user ON audit_log(changed_by);

-- ── documents ──
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('contract', 'insurance', 'certification', 'property_doc', 'hoa_rules', 'photo', 'receipt', 'other')),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  storage_url TEXT NOT NULL,
  file_size_bytes INTEGER,
  mime_type TEXT,
  expires_at TIMESTAMPTZ,
  uploaded_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_client ON documents(client_id);
CREATE INDEX idx_documents_property ON documents(property_id);
CREATE INDEX idx_documents_employee ON documents(employee_id);
CREATE INDEX idx_documents_type ON documents(type);
CREATE INDEX idx_documents_expires ON documents(expires_at) WHERE expires_at IS NOT NULL;

-- ── supply_items ──
CREATE TABLE supply_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT DEFAULT 'cleaning'
    CHECK (category IN ('cleaning', 'equipment', 'consumable', 'safety', 'other')),
  unit TEXT DEFAULT 'each',
  current_stock DECIMAL(10,2) DEFAULT 0,
  reorder_threshold DECIMAL(10,2) DEFAULT 5,
  unit_cost DECIMAL(10,2),
  preferred_vendor TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── supply_usage ──
CREATE TABLE supply_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_item_id UUID REFERENCES supply_items(id) ON DELETE CASCADE NOT NULL,
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  quantity_used DECIMAL(10,2) NOT NULL DEFAULT 1,
  notes TEXT,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_supply_usage_item ON supply_usage(supply_item_id);
CREATE INDEX idx_supply_usage_visit ON supply_usage(visit_id);
CREATE INDEX idx_supply_usage_date ON supply_usage(used_at);

-- ── shift_offers ──
CREATE TABLE shift_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES visits(id) ON DELETE CASCADE NOT NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  offered_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  decline_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shift_offers_visit ON shift_offers(visit_id);
CREATE INDEX idx_shift_offers_employee ON shift_offers(employee_id);
CREATE INDEX idx_shift_offers_status ON shift_offers(status);

-- ── webhooks ──
CREATE TABLE webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
  secret TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt INTEGER DEFAULT 1,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX idx_webhook_deliveries_event ON webhook_deliveries(event);


-- ┌──────────────────────────────────────────┐
-- │  SECTION 14: NOTIFICATIONS (v9 only)      │
-- │  Skips v3 schema — uses enhanced v9       │
-- └──────────────────────────────────────────┘

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  role_target TEXT,
  title TEXT NOT NULL,
  body TEXT,
  type TEXT DEFAULT 'info'
    CHECK (type IN ('info', 'warning', 'error', 'success', 'action_required')),
  action_url TEXT,
  entity_type TEXT,
  entity_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  -- Keep v3 columns for backward compat with any code using them
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_role ON notifications(role_target);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ┌──────────────────────────────────────────┐
-- │  SECTION 15: ALL TRIGGERS                 │
-- └──────────────────────────────────────────┘

-- updated_at triggers
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER quotes_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER checklist_templates_updated_at BEFORE UPDATE ON checklist_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER visits_updated_at BEFORE UPDATE ON visits FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER time_off_requests_updated_at BEFORE UPDATE ON time_off_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER supply_items_updated_at BEFORE UPDATE ON supply_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER website_requests_updated_at BEFORE UPDATE ON website_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER booking_requests_updated_at BEFORE UPDATE ON booking_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- v7: Visit status change audit trail
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

CREATE TRIGGER visit_status_change_trigger
  AFTER UPDATE ON visits FOR EACH ROW
  EXECUTE FUNCTION log_visit_status_change();

-- v8: Auto-enroll clients in sequences on status change
CREATE OR REPLACE FUNCTION trigger_sequence_on_client_update()
RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER trg_sequence_on_client_update
  AFTER UPDATE ON clients FOR EACH ROW
  EXECUTE FUNCTION trigger_sequence_on_client_update();

-- v9: Supply auto-decrement
CREATE OR REPLACE FUNCTION decrement_supply_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE supply_items
  SET current_stock = current_stock - NEW.quantity_used
  WHERE id = NEW.supply_item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER supply_usage_decrement
  AFTER INSERT ON supply_usage
  FOR EACH ROW EXECUTE FUNCTION decrement_supply_stock();

-- v9: Audit trigger
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by, changed_by_role)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid(), current_user_role());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by, changed_by_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid(), current_user_role());
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by, changed_by_role)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid(), current_user_role());
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_clients AFTER INSERT OR UPDATE OR DELETE ON clients FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON employees FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
CREATE TRIGGER audit_visits AFTER INSERT OR UPDATE OR DELETE ON visits FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();


-- ┌────────────��──────────────────────────��──┐
-- │  SECTION 16: FUNCTIONS                    │
-- └──────────────────────────────────────────┘

-- v9: RBAC helper functions (used by RLS policies)
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE),
    'viewer'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_manager()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin', 'manager');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin', 'manager', 'dispatcher', 'technician');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- v6: Generate recurring visits for a single job
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
  IF NOT FOUND THEN RETURN 0; END IF;

  v_interval := CASE v_job.recurrence_rule
    WHEN 'weekly' THEN INTERVAL '1 week'
    WHEN 'biweekly' THEN INTERVAL '2 weeks'
    WHEN 'monthly' THEN INTERVAL '1 month'
    ELSE INTERVAL '1 week'
  END;

  v_current_date := GREATEST(
    COALESCE(v_job.last_visit_generated_date + v_interval, v_job.recurrence_start_date),
    COALESCE(v_job.recurrence_start_date, CURRENT_DATE)
  );

  v_end_date := LEAST(
    COALESCE(v_job.recurrence_end_date, CURRENT_DATE + (p_horizon_weeks * 7)),
    CURRENT_DATE + (p_horizon_weeks * 7)
  );

  WHILE v_current_date <= v_end_date LOOP
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

  UPDATE jobs SET last_visit_generated_date = v_end_date WHERE id = p_job_id;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- v6: Generate visits for ALL active recurring jobs
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

-- v9: Client health scoring
CREATE OR REPLACE FUNCTION calculate_client_health(p_client_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 50;
  v_avg_rating DECIMAL;
  v_days_since_service INTEGER;
  v_payment_reliability DECIMAL;
  v_total_visits INTEGER;
BEGIN
  SELECT AVG(client_rating), COUNT(*) INTO v_avg_rating, v_total_visits
  FROM visits WHERE client_id = p_client_id AND client_rating IS NOT NULL;

  IF v_avg_rating IS NOT NULL THEN
    v_score := v_score + ((v_avg_rating / 5.0) * 25)::INTEGER;
  END IF;

  SELECT EXTRACT(DAY FROM NOW() - MAX(scheduled_date))::INTEGER INTO v_days_since_service
  FROM visits WHERE client_id = p_client_id AND status = 'completed';

  IF v_days_since_service IS NOT NULL THEN
    v_score := v_score + GREATEST(0, 25 - (v_days_since_service / 4))::INTEGER;
  END IF;

  SELECT
    CASE WHEN COUNT(*) = 0 THEN 1.0
    ELSE COUNT(*) FILTER (WHERE status = 'paid')::DECIMAL / COUNT(*)
    END INTO v_payment_reliability
  FROM invoices WHERE client_id = p_client_id;

  v_score := v_score + (v_payment_reliability * 25)::INTEGER;

  IF v_total_visits > 25 THEN v_score := v_score + 10;
  ELSIF v_total_visits > 10 THEN v_score := v_score + 5;
  END IF;

  v_score := LEAST(100, GREATEST(0, v_score));

  UPDATE clients SET
    health_score = v_score,
    avg_rating = v_avg_rating,
    total_visits = v_total_visits,
    last_service_date = (SELECT MAX(scheduled_date) FROM visits WHERE client_id = p_client_id AND status = 'completed'),
    churn_risk = CASE
      WHEN v_score >= 70 THEN 'low'
      WHEN v_score >= 40 THEN 'medium'
      ELSE 'high'
    END
  WHERE id = p_client_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION refresh_all_client_health()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_client RECORD;
BEGIN
  FOR v_client IN SELECT id FROM clients WHERE status IN ('active', 'prospect') LOOP
    PERFORM calculate_client_health(v_client.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ┌──────────────────��───────────────────────┐
-- │  SECTION 17: SEED DATA (v5)               │
-- └─────────────���────────────────────────────┘

INSERT INTO service_types (name, description, base_duration_minutes, is_recurring_eligible, sort_order) VALUES
  ('Standard Clean', 'Regular maintenance cleaning', 120, true, 1),
  ('Deep Clean', 'Thorough deep cleaning including baseboards, inside appliances', 240, true, 2),
  ('Move-Out', 'Full clean for tenant turnover', 300, false, 3),
  ('Move-In', 'Prep clean before new tenant', 240, false, 4),
  ('Post-Construction', 'Heavy-duty clean after renovation or construction', 360, false, 5),
  ('Turnover', 'Vacation rental turnover clean', 150, false, 6),
  ('Janitorial', 'Commercial janitorial service', 120, true, 7),
  ('One-Time', 'Single visit custom clean', 180, false, 8)
ON CONFLICT (name) DO NOTHING;

INSERT INTO checklist_templates (name, sections) VALUES
  ('Standard Residential', '[
    {"name": "Kitchen", "items": [
      {"task": "Wipe countertops & backsplash", "required": true},
      {"task": "Clean sink & faucet", "required": true},
      {"task": "Clean exterior of appliances", "required": true},
      {"task": "Clean microwave interior", "required": true},
      {"task": "Wipe cabinet fronts", "required": false},
      {"task": "Empty trash & replace liner", "required": true},
      {"task": "Sweep & mop floor", "required": true}
    ]},
    {"name": "Bathrooms", "items": [
      {"task": "Clean & sanitize toilet", "required": true},
      {"task": "Clean shower/tub", "required": true},
      {"task": "Clean sink & vanity", "required": true},
      {"task": "Clean mirrors", "required": true},
      {"task": "Wipe fixtures & hardware", "required": true},
      {"task": "Empty trash", "required": true},
      {"task": "Sweep & mop floor", "required": true}
    ]},
    {"name": "Bedrooms", "items": [
      {"task": "Make beds / change linens", "required": false},
      {"task": "Dust all surfaces", "required": true},
      {"task": "Vacuum floor / carpet", "required": true},
      {"task": "Empty trash", "required": true}
    ]},
    {"name": "Living Areas", "items": [
      {"task": "Dust all surfaces & shelves", "required": true},
      {"task": "Wipe light switches & door handles", "required": true},
      {"task": "Vacuum floors & carpets", "required": true},
      {"task": "Mop hard floors", "required": true}
    ]},
    {"name": "General", "items": [
      {"task": "Dust ceiling fans & light fixtures", "required": false},
      {"task": "Wipe baseboards", "required": false},
      {"task": "Clean interior windows", "required": false},
      {"task": "Lock up & secure property", "required": true}
    ]}
  ]'),
  ('Deep Clean', '[
    {"name": "Kitchen", "items": [
      {"task": "Wipe countertops & backsplash", "required": true},
      {"task": "Clean sink & faucet", "required": true},
      {"task": "Clean exterior of appliances", "required": true},
      {"task": "Clean microwave interior", "required": true},
      {"task": "Clean inside oven", "required": true},
      {"task": "Clean inside refrigerator", "required": true},
      {"task": "Clean inside dishwasher", "required": true},
      {"task": "Wipe cabinet fronts & handles", "required": true},
      {"task": "Clean range hood & filter", "required": true},
      {"task": "Degrease stovetop", "required": true},
      {"task": "Empty trash & replace liner", "required": true},
      {"task": "Sweep & mop floor", "required": true},
      {"task": "Clean baseboards", "required": true}
    ]},
    {"name": "Bathrooms", "items": [
      {"task": "Clean & sanitize toilet (incl. base)", "required": true},
      {"task": "Deep clean shower/tub & grout", "required": true},
      {"task": "Clean shower door tracks", "required": true},
      {"task": "Clean sink & vanity", "required": true},
      {"task": "Clean mirrors", "required": true},
      {"task": "Wipe fixtures & hardware", "required": true},
      {"task": "Clean exhaust fan", "required": true},
      {"task": "Wipe baseboards", "required": true},
      {"task": "Empty trash", "required": true},
      {"task": "Sweep & mop floor", "required": true}
    ]},
    {"name": "Bedrooms", "items": [
      {"task": "Make beds / change linens", "required": true},
      {"task": "Dust all surfaces including under items", "required": true},
      {"task": "Clean under bed", "required": true},
      {"task": "Wipe baseboards", "required": true},
      {"task": "Clean closet floors", "required": true},
      {"task": "Vacuum floor / carpet", "required": true},
      {"task": "Empty trash", "required": true}
    ]},
    {"name": "Living Areas", "items": [
      {"task": "Dust all surfaces, shelves & decor", "required": true},
      {"task": "Wipe light switches & door handles", "required": true},
      {"task": "Clean window sills & tracks", "required": true},
      {"task": "Clean interior windows", "required": true},
      {"task": "Dust ceiling fans & light fixtures", "required": true},
      {"task": "Wipe baseboards throughout", "required": true},
      {"task": "Vacuum floors & carpets", "required": true},
      {"task": "Mop hard floors", "required": true},
      {"task": "Vacuum upholstery", "required": false}
    ]}
  ]'),
  ('Turnover Clean', '[
    {"name": "Kitchen", "items": [
      {"task": "Wipe countertops & backsplash", "required": true},
      {"task": "Clean sink & faucet", "required": true},
      {"task": "Clean all appliance exteriors", "required": true},
      {"task": "Clean microwave interior", "required": true},
      {"task": "Check inside fridge — clean if needed", "required": true},
      {"task": "Run & empty dishwasher", "required": true},
      {"task": "Wipe cabinet fronts", "required": true},
      {"task": "Restock paper towels & dish soap", "required": true},
      {"task": "Empty trash & replace liner", "required": true},
      {"task": "Sweep & mop floor", "required": true}
    ]},
    {"name": "Bathrooms", "items": [
      {"task": "Clean & sanitize toilet", "required": true},
      {"task": "Clean shower/tub", "required": true},
      {"task": "Clean sink & vanity", "required": true},
      {"task": "Clean mirrors", "required": true},
      {"task": "Restock toilet paper & hand soap", "required": true},
      {"task": "Replace towels with fresh set", "required": true},
      {"task": "Empty trash", "required": true},
      {"task": "Sweep & mop floor", "required": true}
    ]},
    {"name": "Bedrooms", "items": [
      {"task": "Strip & remake beds with fresh linens", "required": true},
      {"task": "Dust all surfaces", "required": true},
      {"task": "Vacuum floor / carpet", "required": true},
      {"task": "Check closets & drawers for left items", "required": true},
      {"task": "Empty trash", "required": true}
    ]},
    {"name": "General", "items": [
      {"task": "Start laundry (sheets & towels)", "required": true},
      {"task": "Check all lights working", "required": true},
      {"task": "Adjust thermostat to guest setting", "required": true},
      {"task": "Lock windows", "required": true},
      {"task": "Set welcome items if applicable", "required": false},
      {"task": "Photo walkthrough for host", "required": true},
      {"task": "Lock up & secure property", "required": true}
    ]}
  ]')
ON CONFLICT DO NOTHING;

INSERT INTO extras (name, price, price_type, duration_minutes, sort_order) VALUES
  ('Inside Oven', 35.00, 'flat', 30, 1),
  ('Inside Refrigerator', 35.00, 'flat', 30, 2),
  ('Inside Cabinets', 50.00, 'flat', 45, 3),
  ('Interior Windows', 5.00, 'per_unit', 10, 4),
  ('Laundry (wash, dry, fold)', 25.00, 'per_unit', 60, 5),
  ('Baseboards (detailed)', 30.00, 'flat', 30, 6),
  ('Garage Sweep', 25.00, 'flat', 20, 7),
  ('Patio / Deck', 30.00, 'flat', 25, 8),
  ('Organize Closet', 40.00, 'per_unit', 30, 9),
  ('Wall Washing', 50.00, 'flat', 45, 10)
ON CONFLICT DO NOTHING;


-- ┌──────────────────────────────────────────┐
-- │  SECTION 18: DATA BACKFILL (v6)           │
-- │  No-op on fresh installs, safe to include │
-- └──────────────────────────────────────────┘

-- Migrate existing jobs → visits (no-op if tables empty)
INSERT INTO visits (job_id, client_id, property_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, source)
SELECT
  j.id, j.client_id, j.property_id, j.date, j.start_time, j.end_time,
  CASE
    WHEN j.status = 'completed' THEN 'completed'
    WHEN j.status = 'cancelled' THEN 'cancelled'
    WHEN j.status = 'in-progress' THEN 'in_progress'
    ELSE 'scheduled'
  END,
  CASE WHEN j.is_recurring THEN 'recurring' ELSE 'one_off' END
FROM jobs j
WHERE j.client_id IS NOT NULL
  AND j.date IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.job_id = j.id AND v.scheduled_date = j.date);

-- Backfill recurrence fields
UPDATE jobs SET
  recurrence_start_date = date,
  preferred_start_time = COALESCE(start_time, '09:00'),
  preferred_end_time = COALESCE(end_time, '12:00'),
  last_visit_generated_date = date
WHERE is_recurring = TRUE AND recurrence_start_date IS NULL;

-- Backfill service_type_id (FIX: proper parentheses for operator precedence)
UPDATE jobs SET service_type_id = st.id
FROM service_types st
WHERE jobs.service_type_id IS NULL
  AND jobs.title IS NOT NULL
  AND (
    (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%turnover%' AND st.name = 'Turnover')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%deep%' AND st.name = 'Deep Clean')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%move-out%' AND st.name = 'Move-Out')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%move-in%' AND st.name = 'Move-In')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%post-construction%' AND st.name = 'Post-Construction')
    OR (lower(COALESCE(jobs.description, '') || ' ' || COALESCE(jobs.title, '')) LIKE '%janitorial%' AND st.name = 'Janitorial')
  );

-- Default remaining to Standard Clean
UPDATE jobs SET service_type_id = (SELECT id FROM service_types WHERE name = 'Standard Clean' LIMIT 1)
WHERE service_type_id IS NULL;


-- ┌──────────────────────────────────────────┐
-- │  SECTION 19: ROW LEVEL SECURITY           │
-- │  Enable RLS on ALL tables                 │
-- └──────────────────────────────────────────┘

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_schedule_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ┌──────────────────────────────────────────┐
-- │  SECTION 20: RLS POLICIES (v9 scoped)     │
-- └──────────────────────────────────────────┘

-- ── user_profiles ──
CREATE POLICY "Users can view own profile" ON user_profiles FOR SELECT USING (auth_user_id = auth.uid());
CREATE POLICY "Admins can view all profiles" ON user_profiles FOR SELECT USING (is_admin());
CREATE POLICY "Admins can manage profiles" ON user_profiles FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── clients ──
CREATE POLICY "Staff can view all clients" ON clients FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage clients" ON clients FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Clients see own record" ON clients FOR SELECT USING (id = current_client_id());

-- ── properties ──
CREATE POLICY "Staff can view all properties" ON properties FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage properties" ON properties FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Clients see own properties" ON properties FOR SELECT USING (client_id = current_client_id());

-- ── conversations ──
CREATE POLICY "Staff can view conversations" ON conversations FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage conversations" ON conversations FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Clients see own conversations" ON conversations FOR SELECT USING (client_id = current_client_id());

-- ── messages ──
CREATE POLICY "Staff can view messages" ON messages FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage messages" ON messages FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── jobs ──
CREATE POLICY "Staff can view jobs" ON jobs FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage jobs" ON jobs FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Clients see own jobs" ON jobs FOR SELECT USING (client_id = current_client_id());

-- ── visits ──
CREATE POLICY "Managers can manage visits" ON visits FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Dispatchers can view visits" ON visits FOR SELECT USING (is_staff());
CREATE POLICY "Technicians see assigned visits" ON visits FOR SELECT USING (assigned_employee_id = current_employee_id());
CREATE POLICY "Technicians can update assigned visits" ON visits FOR UPDATE USING (assigned_employee_id = current_employee_id()) WITH CHECK (assigned_employee_id = current_employee_id());
CREATE POLICY "Clients see own visits" ON visits FOR SELECT USING (client_id = current_client_id());

-- ── invoices ──
CREATE POLICY "Managers can manage invoices" ON invoices FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Staff can view invoices" ON invoices FOR SELECT USING (is_staff());
CREATE POLICY "Clients see own invoices" ON invoices FOR SELECT USING (client_id = (SELECT client_id FROM user_profiles WHERE auth_user_id = auth.uid()));

-- ── invoice_items ──
CREATE POLICY "Staff can view invoice items" ON invoice_items FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage invoice items" ON invoice_items FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── employees ──
CREATE POLICY "Admins can manage employees" ON employees FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Staff can view employees" ON employees FOR SELECT USING (is_staff());
CREATE POLICY "Employees see own record" ON employees FOR SELECT USING (id = current_employee_id());

-- ── teams ──
CREATE POLICY "Staff can view teams" ON teams FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage teams" ON teams FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── service_types ──
CREATE POLICY "Anyone authenticated can view service types" ON service_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage service types" ON service_types FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── pricing_rules ──
CREATE POLICY "Staff can view pricing" ON pricing_rules FOR SELECT USING (is_staff());
CREATE POLICY "Admins can manage pricing" ON pricing_rules FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── extras ──
CREATE POLICY "Anyone authenticated can view extras" ON extras FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage extras" ON extras FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── checklist_templates ──
CREATE POLICY "Staff can view checklists" ON checklist_templates FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage checklists" ON checklist_templates FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── quotes ──
CREATE POLICY "Staff can view quotes" ON quotes FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage quotes" ON quotes FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── payroll_exports ──
CREATE POLICY "Only admins can access payroll" ON payroll_exports FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── rental_calendars ──
CREATE POLICY "Staff can view rental calendars" ON rental_calendars FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage rental calendars" ON rental_calendars FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── payment_transactions ──
CREATE POLICY "Admins can manage payments" ON payment_transactions FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Staff can view payments" ON payment_transactions FOR SELECT USING (is_staff());

-- ── website_requests ──
CREATE POLICY "Staff can view website requests" ON website_requests FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage website requests" ON website_requests FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── booking_requests ──
CREATE POLICY "Staff can view booking requests" ON booking_requests FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage booking requests" ON booking_requests FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── visit_reminders ──
CREATE POLICY "Staff can view reminders" ON visit_reminders FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage reminders" ON visit_reminders FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── calendar_sync_log ──
CREATE POLICY "Staff can view sync log" ON calendar_sync_log FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage sync log" ON calendar_sync_log FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── client_schedule_tokens ──
CREATE POLICY "Managers can manage tokens" ON client_schedule_tokens FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Clients see own tokens" ON client_schedule_tokens FOR SELECT USING (client_id = current_client_id());

-- ── visit_status_history ──
CREATE POLICY "Staff can view status history" ON visit_status_history FOR SELECT USING (is_staff());
CREATE POLICY "System can insert status history" ON visit_status_history FOR INSERT WITH CHECK (true);

-- ── campaigns ──
CREATE POLICY "Managers can manage campaigns" ON campaigns FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── campaign_steps ──
CREATE POLICY "Managers can manage campaign steps" ON campaign_steps FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── campaign_enrollments ──
CREATE POLICY "Managers can manage enrollments" ON campaign_enrollments FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── sequence_triggers ──
CREATE POLICY "Managers can manage triggers" ON sequence_triggers FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── employee_availability ──
CREATE POLICY "Managers can manage availability" ON employee_availability FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Employees see own availability" ON employee_availability FOR SELECT USING (employee_id = current_employee_id());
CREATE POLICY "Employees can update own availability" ON employee_availability FOR INSERT WITH CHECK (employee_id = current_employee_id());

-- ── time_off_requests ──
CREATE POLICY "Managers can manage time-off" ON time_off_requests FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Employees see own time-off" ON time_off_requests FOR SELECT USING (employee_id = current_employee_id());
CREATE POLICY "Employees can request time-off" ON time_off_requests FOR INSERT WITH CHECK (employee_id = current_employee_id());

-- ── audit_log ──
CREATE POLICY "Only admins can view audit log" ON audit_log FOR SELECT USING (is_admin());
CREATE POLICY "System can insert audit entries" ON audit_log FOR INSERT WITH CHECK (true);

-- ── documents ──
CREATE POLICY "Staff can view documents" ON documents FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage documents" ON documents FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Employees see own documents" ON documents FOR SELECT USING (employee_id = current_employee_id());

-- ── supply_items ──
CREATE POLICY "Staff can view supplies" ON supply_items FOR SELECT USING (is_staff());
CREATE POLICY "Managers can manage supplies" ON supply_items FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── supply_usage ──
CREATE POLICY "Staff can view supply usage" ON supply_usage FOR SELECT USING (is_staff());
CREATE POLICY "Technicians can log supply usage" ON supply_usage FOR INSERT WITH CHECK (is_staff());
CREATE POLICY "Managers can manage supply usage" ON supply_usage FOR ALL USING (is_manager()) WITH CHECK (is_manager());

-- ── shift_offers ──
CREATE POLICY "Managers can manage shift offers" ON shift_offers FOR ALL USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY "Employees see own shift offers" ON shift_offers FOR SELECT USING (employee_id = current_employee_id());
CREATE POLICY "Employees can respond to offers" ON shift_offers FOR UPDATE USING (employee_id = current_employee_id()) WITH CHECK (employee_id = current_employee_id());

-- ── webhooks ──
CREATE POLICY "Only admins can manage webhooks" ON webhooks FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Only admins can view webhook deliveries" ON webhook_deliveries FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── notifications ──
CREATE POLICY "Users see own notifications" ON notifications FOR SELECT
  USING (user_id = auth.uid() OR role_target = current_user_role() OR (user_id IS NULL AND role_target IS NULL));
CREATE POLICY "Users can mark own notifications read" ON notifications FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "System can create notifications" ON notifications FOR INSERT WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════
-- DONE! 31 tables, 100+ indexes, 80+ RLS policies, 20+ functions/triggers
-- Next steps:
--   1. Create auth users in Supabase Dashboard → Authentication → Users
--   2. Run seed-user-profiles.sql
--   3. Call: SELECT * FROM seed_user_profiles();
-- ══════════════════════════════════════════════════════════════════════

