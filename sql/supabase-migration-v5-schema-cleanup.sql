-- Migration v5: Schema cleanup & CRM improvements
-- Adds: employees, visits, service_types, pricing_rules, checklist_templates, extras
-- Alters: jobs, messages, booking_requests, properties
-- Deduplicates: rental_calendars fields, booking_requests fields
-- Run this in Supabase SQL Editor AFTER all previous migrations

-- ══════════════════════════════════════════
-- A. EMPLOYEES (local mirror of Connecteam users)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employees (
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
    -- e.g. {"Naples Marina": {"type": "per_shift", "amount": 93}}
  hire_date DATE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'terminated')),
  zones TEXT[] DEFAULT '{}',
  skills TEXT[] DEFAULT '{}',
    -- e.g. {"deep_clean", "post_construction", "commercial"}
  max_hours_weekly INTEGER,
  color TEXT,
    -- hex color for calendar display
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_connecteam ON employees(connecteam_user_id);

CREATE TRIGGER employees_updated_at
  BEFORE UPDATE ON employees FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- B. TEAMS (crew grouping)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS teams (
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

CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON teams FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- C. SERVICE TYPES (standardized catalog)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS service_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
    -- e.g. "Standard Clean", "Deep Clean", "Move-Out", "Post-Construction", "Turnover"
  description TEXT,
  base_duration_minutes INTEGER DEFAULT 120,
  is_recurring_eligible BOOLEAN DEFAULT TRUE,
  checklist_template_id UUID, -- FK added after checklist_templates created
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- D. PRICING RULES (per service type + property size)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id UUID REFERENCES service_types(id) ON DELETE CASCADE NOT NULL,
  property_type TEXT,
    -- null = all property types
  bedrooms_min INTEGER,
  bedrooms_max INTEGER,
  bathrooms_min INTEGER,
  bathrooms_max INTEGER,
  base_price DECIMAL(10,2) NOT NULL,
  price_per_sqft DECIMAL(10,4),
    -- for commercial pricing
  frequency_discounts JSONB DEFAULT '{"weekly": 15, "biweekly": 10, "monthly": 5}',
    -- percent off for recurring
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_service ON pricing_rules(service_type_id);

-- ══════════════════════════════════════════
-- E. EXTRAS / ADD-ONS
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
    -- e.g. "Inside Oven", "Inside Fridge", "Laundry", "Interior Windows"
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  price_type TEXT NOT NULL DEFAULT 'flat'
    CHECK (price_type IN ('flat', 'per_unit')),
  unit_label TEXT,
    -- e.g. "per window", "per load"
  duration_minutes INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- F. CHECKLIST TEMPLATES
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
    -- e.g. "Standard Residential", "Deep Clean", "Move-Out"
  sections JSONB NOT NULL DEFAULT '[]',
    -- [{name: "Kitchen", items: [{task: "Wipe countertops", required: true}, ...]}, ...]
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER checklist_templates_updated_at
  BEFORE UPDATE ON checklist_templates FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Now add FK from service_types to checklist_templates
ALTER TABLE service_types
  ADD CONSTRAINT fk_service_type_checklist
  FOREIGN KEY (checklist_template_id) REFERENCES checklist_templates(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════
-- G. VISITS (individual service occurrences)
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS visits (
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
    -- copied from template, tracks per-item completion
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visits_job ON visits(job_id);
CREATE INDEX IF NOT EXISTS idx_visits_client ON visits(client_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_visits_status ON visits(status);
CREATE INDEX IF NOT EXISTS idx_visits_employee ON visits(assigned_employee_id);

CREATE TRIGGER visits_updated_at
  BEFORE UPDATE ON visits FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ══════════════════════════════════════════
-- H. ALTER JOBS — link to service_types and employees
-- ══════════════════════════════════════════
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_type_id UUID REFERENCES service_types(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assigned_team_id UUID REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS frequency_discount_pct DECIMAL(5,2) DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS extras JSONB DEFAULT '[]';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS checklist_template_id UUID REFERENCES checklist_templates(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS instructions TEXT;

-- ══════════════════════════════════════════
-- I. ALTER PROPERTIES — absorb rental_calendars fields, add cleaning-specific fields
-- ══════════════════════════════════════════
ALTER TABLE properties ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,7);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS longitude DECIMAL(10,7);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS has_pets BOOLEAN DEFAULT FALSE;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS pet_details TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS parking_instructions TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS access_type TEXT
  CHECK (access_type IN ('client_home', 'lockbox', 'key_under_mat', 'doorman', 'garage_code', 'other'));
ALTER TABLE properties ADD COLUMN IF NOT EXISTS do_not_areas TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS cleaning_notes TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS photos TEXT[] DEFAULT '{}';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS stories INTEGER DEFAULT 1;
-- Absorb rental_calendars fields into properties
ALTER TABLE properties ADD COLUMN IF NOT EXISTS google_calendar_id TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS auto_schedule_turnovers BOOLEAN DEFAULT FALSE;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS last_ical_sync_at TIMESTAMPTZ;

-- ══════════════════════════════════════════
-- J. ALTER MESSAGES — enrich for unified timeline
-- ══════════════════════════════════════════
ALTER TABLE messages ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES visits(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS from_address TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS to_address TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS body_html TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_automated BOOLEAN DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS automation_trigger TEXT;
  -- e.g. "post_job_followup", "review_request", "reminder"
ALTER TABLE messages ADD COLUMN IF NOT EXISTS call_duration_seconds INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS call_outcome TEXT;
  -- e.g. "answered", "voicemail", "no_answer"

-- Also allow 'system' channel on conversations
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('email', 'text', 'phone', 'in-person', 'system', 'other'));

-- ══════════════════════════════════════════
-- K. ALTER BOOKING_REQUESTS — add property_id, keep legacy fields
-- ══════════════════════════════════════════
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS property_id UUID REFERENCES properties(id) ON DELETE SET NULL;

-- ══════════════════════════════════════════
-- L. ALTER CLIENTS — add referral tracking
-- ══════════════════════════════════════════
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referral_source TEXT;
  -- e.g. "google", "yelp", "referral", "nextdoor", "facebook", "website"
ALTER TABLE clients ADD COLUMN IF NOT EXISTS referred_by_client_id UUID REFERENCES clients(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_name TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_payment_terms INTEGER DEFAULT 30;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_stage TEXT
  CHECK (lead_stage IN ('new', 'contacted', 'quoted', 'won', 'lost'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- ══════════════════════════════════════════
-- M. SEED DEFAULT SERVICE TYPES
-- ══════════════════════════════════════════
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

-- ══════════════════════════════════════════
-- N. SEED DEFAULT CHECKLIST TEMPLATES
-- ══════════════════════════════════════════
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

-- ══════════════════════════════════════════
-- O. SEED DEFAULT EXTRAS
-- ══════════════════════════════════════════
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

-- ══════════════════════════════════════════
-- P. ROW LEVEL SECURITY (service role full access)
-- ══════════════════════════════════════════
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;

-- Allow authenticated + service role access
CREATE POLICY "Full access to employees" ON employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to teams" ON teams FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to service_types" ON service_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to pricing_rules" ON pricing_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to extras" ON extras FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to checklist_templates" ON checklist_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access to visits" ON visits FOR ALL USING (true) WITH CHECK (true);
