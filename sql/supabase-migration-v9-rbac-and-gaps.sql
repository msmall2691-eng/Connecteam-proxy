-- Migration v9: RBAC, Data Isolation, and CRM Feature Gaps
-- Adds: user_profiles, employee_availability, time_off_requests, audit_log, documents, supply tracking
-- Fixes: RLS policies on ALL tables — scoped by user role
-- Run this in Supabase SQL Editor AFTER all previous migrations (v1-v8)

-- ══════════════════════════════════════════════════════════════
-- A. USER PROFILES — links Supabase auth.users to app roles
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE NOT NULL,
    -- references auth.users(id) — Supabase manages this table
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer'
    CHECK (role IN ('owner', 'admin', 'manager', 'dispatcher', 'technician', 'viewer', 'client')),
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    -- links to employees table for technician/manager roles
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    -- links to clients table for client portal users
  display_name TEXT,
  avatar_url TEXT,
  permissions JSONB DEFAULT '{}',
    -- granular overrides: {"can_view_payroll": true, "can_edit_pricing": false}
  is_active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_auth ON user_profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_employee ON user_profiles(employee_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_client ON user_profiles(client_id);

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════════════
-- B. HELPER FUNCTIONS — used by RLS policies
-- ══════════════════════════════════════════════════════════════

-- Get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT role FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE),
    'viewer'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is admin+ (owner, admin)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is manager+ (owner, admin, manager)
CREATE OR REPLACE FUNCTION is_manager()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin', 'manager');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if current user is staff (owner, admin, manager, dispatcher, technician)
CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN AS $$
  SELECT current_user_role() IN ('owner', 'admin', 'manager', 'dispatcher', 'technician');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get current user's employee_id
CREATE OR REPLACE FUNCTION current_employee_id()
RETURNS UUID AS $$
  SELECT employee_id FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get current user's client_id
CREATE OR REPLACE FUNCTION current_client_id()
RETURNS UUID AS $$
  SELECT client_id FROM user_profiles WHERE auth_user_id = auth.uid() AND is_active = TRUE;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ══════════════════════════════════════════════════════════════
-- C. FIX RLS POLICIES — drop open policies, add role-scoped ones
-- ══════════════════════════════════════════════════════════════

-- Note: Service role (used by API routes) always bypasses RLS.
-- These policies govern browser-side access via the anon/authenticated key.

-- ── user_profiles ──
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  USING (is_admin());

CREATE POLICY "Admins can manage profiles"
  ON user_profiles FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── clients ──
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Full access to clients" ON clients;

CREATE POLICY "Staff can view all clients"
  ON clients FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage clients"
  ON clients FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Clients see own record"
  ON clients FOR SELECT
  USING (id = current_client_id());

-- ── properties ──
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view all properties"
  ON properties FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage properties"
  ON properties FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Clients see own properties"
  ON properties FOR SELECT
  USING (client_id = current_client_id());

-- ── conversations ──
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view conversations"
  ON conversations FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage conversations"
  ON conversations FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Clients see own conversations"
  ON conversations FOR SELECT
  USING (client_id = current_client_id());

-- ── messages ──
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view messages"
  ON messages FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage messages"
  ON messages FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── jobs ──
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view jobs"
  ON jobs FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage jobs"
  ON jobs FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Clients see own jobs"
  ON jobs FOR SELECT
  USING (client_id = current_client_id());

-- ── visits ──
DROP POLICY IF EXISTS "Full access to visits" ON visits;

CREATE POLICY "Managers can manage visits"
  ON visits FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Dispatchers can view and update visits"
  ON visits FOR SELECT
  USING (is_staff());

CREATE POLICY "Technicians see assigned visits"
  ON visits FOR SELECT
  USING (assigned_employee_id = current_employee_id());

CREATE POLICY "Technicians can update assigned visits"
  ON visits FOR UPDATE
  USING (assigned_employee_id = current_employee_id())
  WITH CHECK (assigned_employee_id = current_employee_id());

CREATE POLICY "Clients see own visits"
  ON visits FOR SELECT
  USING (client_id = current_client_id());

-- ── invoices ──
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage invoices"
  ON invoices FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Staff can view invoices"
  ON invoices FOR SELECT
  USING (is_staff());

CREATE POLICY "Clients see own invoices"
  ON invoices FOR SELECT
  USING (client_id = (SELECT client_id FROM user_profiles WHERE auth_user_id = auth.uid()));

-- ── invoice_items ──
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view invoice items"
  ON invoice_items FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage invoice items"
  ON invoice_items FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── employees ──
DROP POLICY IF EXISTS "Full access to employees" ON employees;

CREATE POLICY "Admins can manage employees"
  ON employees FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Staff can view employees"
  ON employees FOR SELECT
  USING (is_staff());

CREATE POLICY "Employees see own record"
  ON employees FOR SELECT
  USING (id = current_employee_id());

-- ── teams ──
DROP POLICY IF EXISTS "Full access to teams" ON teams;

CREATE POLICY "Staff can view teams"
  ON teams FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage teams"
  ON teams FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── service_types ──
DROP POLICY IF EXISTS "Full access to service_types" ON service_types;

CREATE POLICY "Anyone authenticated can view service types"
  ON service_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage service types"
  ON service_types FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── pricing_rules ──
DROP POLICY IF EXISTS "Full access to pricing_rules" ON pricing_rules;

CREATE POLICY "Staff can view pricing"
  ON pricing_rules FOR SELECT
  USING (is_staff());

CREATE POLICY "Admins can manage pricing"
  ON pricing_rules FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── extras ──
DROP POLICY IF EXISTS "Full access to extras" ON extras;

CREATE POLICY "Anyone authenticated can view extras"
  ON extras FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage extras"
  ON extras FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── checklist_templates ──
DROP POLICY IF EXISTS "Full access to checklist_templates" ON checklist_templates;

CREATE POLICY "Staff can view checklists"
  ON checklist_templates FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage checklists"
  ON checklist_templates FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── quotes ──
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view quotes"
  ON quotes FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage quotes"
  ON quotes FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── payroll_exports ──
ALTER TABLE payroll_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can access payroll"
  ON payroll_exports FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ── campaigns ──
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage campaigns"
  ON campaigns FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── campaign_steps ──
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage campaign steps"
  ON campaign_steps FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── campaign_enrollments ──
ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage enrollments"
  ON campaign_enrollments FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── sequence_triggers ──
ALTER TABLE sequence_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage triggers"
  ON sequence_triggers FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── booking_requests ──
DROP POLICY IF EXISTS "Service role has full access to booking_requests" ON booking_requests;

CREATE POLICY "Staff can view booking requests"
  ON booking_requests FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage booking requests"
  ON booking_requests FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── visit_reminders ──
DROP POLICY IF EXISTS "Full access to visit_reminders" ON visit_reminders;

CREATE POLICY "Staff can view reminders"
  ON visit_reminders FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage reminders"
  ON visit_reminders FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── calendar_sync_log ──
DROP POLICY IF EXISTS "Full access to calendar_sync_log" ON calendar_sync_log;

CREATE POLICY "Staff can view sync log"
  ON calendar_sync_log FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage sync log"
  ON calendar_sync_log FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ── client_schedule_tokens ──
DROP POLICY IF EXISTS "Full access to client_schedule_tokens" ON client_schedule_tokens;

CREATE POLICY "Managers can manage tokens"
  ON client_schedule_tokens FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Clients see own tokens"
  ON client_schedule_tokens FOR SELECT
  USING (client_id = current_client_id());

-- ── visit_status_history ──
DROP POLICY IF EXISTS "Full access to visit_status_history" ON visit_status_history;

CREATE POLICY "Staff can view status history"
  ON visit_status_history FOR SELECT
  USING (is_staff());

CREATE POLICY "System can insert status history"
  ON visit_status_history FOR INSERT
  WITH CHECK (true);
  -- Trigger-based inserts use SECURITY DEFINER, but allow manual inserts too

-- ── payment_transactions ──
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage payments"
  ON payment_transactions FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Staff can view payments"
  ON payment_transactions FOR SELECT
  USING (is_staff());

-- ── rental_calendars ──
ALTER TABLE rental_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view rental calendars"
  ON rental_calendars FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage rental calendars"
  ON rental_calendars FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ══════════════════════════════════════════════════════════════
-- D. EMPLOYEE AVAILABILITY (weekly recurring windows)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    -- 0=Sunday, 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
    -- false = blocked time (e.g., school pickup)
  notes TEXT,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_until DATE,
    -- null = ongoing
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_avail_employee ON employee_availability(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_avail_day ON employee_availability(day_of_week);

ALTER TABLE employee_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage availability"
  ON employee_availability FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Employees see own availability"
  ON employee_availability FOR SELECT
  USING (employee_id = current_employee_id());

CREATE POLICY "Employees can update own availability"
  ON employee_availability FOR INSERT
  WITH CHECK (employee_id = current_employee_id());

-- ══════════════════════════════════════════════════════════════
-- E. TIME-OFF REQUESTS (PTO, sick, personal)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS time_off_requests (
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
    -- admin/manager name who approved/denied
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_off_employee ON time_off_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_off_dates ON time_off_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_time_off_status ON time_off_requests(status);

CREATE TRIGGER time_off_requests_updated_at
  BEFORE UPDATE ON time_off_requests FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE time_off_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage time-off"
  ON time_off_requests FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Employees see own time-off"
  ON time_off_requests FOR SELECT
  USING (employee_id = current_employee_id());

CREATE POLICY "Employees can request time-off"
  ON time_off_requests FOR INSERT
  WITH CHECK (employee_id = current_employee_id());

-- ══════════════════════════════════════════════════════════════
-- F. AUDIT LOG — comprehensive change tracking
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  changed_by UUID,
    -- auth.uid() of the user who made the change
  changed_by_role TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_date ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(changed_by);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view audit log"
  ON audit_log FOR SELECT
  USING (is_admin());

CREATE POLICY "System can insert audit entries"
  ON audit_log FOR INSERT
  WITH CHECK (true);

-- Generic audit trigger function
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

-- Apply audit triggers to critical tables
CREATE TRIGGER audit_clients AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_jobs AFTER INSERT OR UPDATE OR DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_employees AFTER INSERT OR UPDATE OR DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_visits AFTER INSERT OR UPDATE OR DELETE ON visits
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ══════════════════════════════════════════════════════════════
-- G. DOCUMENTS — contracts, certs, property docs
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other'
    CHECK (type IN ('contract', 'insurance', 'certification', 'property_doc', 'hoa_rules', 'photo', 'receipt', 'other')),
  -- Polymorphic linkage: attach to any entity
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  storage_url TEXT NOT NULL,
    -- Supabase Storage URL or external URL
  file_size_bytes INTEGER,
  mime_type TEXT,
  expires_at TIMESTAMPTZ,
    -- for insurance certs, contracts with end dates
  uploaded_by UUID,
    -- auth.uid()
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_property ON documents(property_id);
CREATE INDEX IF NOT EXISTS idx_documents_employee ON documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view documents"
  ON documents FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage documents"
  ON documents FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Employees see own documents"
  ON documents FOR SELECT
  USING (employee_id = current_employee_id());

-- ══════════════════════════════════════════════════════════════
-- H. SUPPLY ITEMS — inventory tracking
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supply_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT DEFAULT 'cleaning'
    CHECK (category IN ('cleaning', 'equipment', 'consumable', 'safety', 'other')),
  unit TEXT DEFAULT 'each',
    -- 'each', 'oz', 'gallon', 'roll', 'pack'
  current_stock DECIMAL(10,2) DEFAULT 0,
  reorder_threshold DECIMAL(10,2) DEFAULT 5,
  unit_cost DECIMAL(10,2),
  preferred_vendor TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER supply_items_updated_at
  BEFORE UPDATE ON supply_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

ALTER TABLE supply_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view supplies"
  ON supply_items FOR SELECT
  USING (is_staff());

CREATE POLICY "Managers can manage supplies"
  ON supply_items FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- ══════════════════════════════════════════════════════════════
-- I. SUPPLY USAGE — per-visit consumption tracking
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supply_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supply_item_id UUID REFERENCES supply_items(id) ON DELETE CASCADE NOT NULL,
  visit_id UUID REFERENCES visits(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  quantity_used DECIMAL(10,2) NOT NULL DEFAULT 1,
  notes TEXT,
  used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supply_usage_item ON supply_usage(supply_item_id);
CREATE INDEX IF NOT EXISTS idx_supply_usage_visit ON supply_usage(visit_id);
CREATE INDEX IF NOT EXISTS idx_supply_usage_date ON supply_usage(used_at);

ALTER TABLE supply_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view supply usage"
  ON supply_usage FOR SELECT
  USING (is_staff());

CREATE POLICY "Technicians can log supply usage"
  ON supply_usage FOR INSERT
  WITH CHECK (is_staff());

CREATE POLICY "Managers can manage supply usage"
  ON supply_usage FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

-- Auto-decrement stock when usage is logged
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

-- ══════════════════════════════════════════════════════════════
-- J. CLIENT HEALTH SCORING — add fields to clients
-- ══════════════════════════════════════════════════════════════
ALTER TABLE clients ADD COLUMN IF NOT EXISTS health_score INTEGER;
  -- 0-100, calculated periodically
ALTER TABLE clients ADD COLUMN IF NOT EXISTS nps_score INTEGER;
  -- -100 to 100
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lifetime_value DECIMAL(10,2) DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS churn_risk TEXT
  CHECK (churn_risk IN ('low', 'medium', 'high'));
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_service_date DATE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS total_visits INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2);

-- ══════════════════════════════════════════════════════════════
-- K. SHIFT OFFERS — offer open shifts to employees
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS shift_offers (
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

CREATE INDEX IF NOT EXISTS idx_shift_offers_visit ON shift_offers(visit_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_employee ON shift_offers(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_offers_status ON shift_offers(status);

ALTER TABLE shift_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers can manage shift offers"
  ON shift_offers FOR ALL
  USING (is_manager())
  WITH CHECK (is_manager());

CREATE POLICY "Employees see own shift offers"
  ON shift_offers FOR SELECT
  USING (employee_id = current_employee_id());

CREATE POLICY "Employees can respond to offers"
  ON shift_offers FOR UPDATE
  USING (employee_id = current_employee_id())
  WITH CHECK (employee_id = current_employee_id());

-- ══════════════════════════════════════════════════════════════
-- L. WEBHOOKS — outbound event notifications
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{}',
    -- e.g. {"visit.completed", "invoice.paid", "client.created"}
  secret TEXT,
    -- shared secret for HMAC signature verification
  is_active BOOLEAN DEFAULT TRUE,
  last_triggered_at TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE NOT NULL,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  response_status INTEGER,
  response_body TEXT,
  attempt INTEGER DEFAULT 1,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can manage webhooks"
  ON webhooks FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Only admins can view webhook deliveries"
  ON webhook_deliveries FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ══════════════════════════════════════════════════════════════
-- M. NOTIFICATIONS — in-app alerts per user
-- ══════════════════════════════════════════════════════════════
-- Enhance existing notifications table if it exists, otherwise create
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
    -- auth.uid() of recipient, null = broadcast
  role_target TEXT,
    -- if set, shows to all users with this role (e.g., 'admin', 'technician')
  title TEXT NOT NULL,
  body TEXT,
  type TEXT DEFAULT 'info'
    CHECK (type IN ('info', 'warning', 'error', 'success', 'action_required')),
  action_url TEXT,
    -- deep link into the app
  entity_type TEXT,
    -- 'visit', 'invoice', 'client', etc.
  entity_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_role ON notifications(role_target);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own notifications"
  ON notifications FOR SELECT
  USING (
    user_id = auth.uid()
    OR role_target = current_user_role()
    OR (user_id IS NULL AND role_target IS NULL)
  );

CREATE POLICY "Users can mark own notifications read"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON notifications FOR INSERT
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════
-- N. SEED DEFAULT ADMIN PROFILE
-- Run this manually with your actual auth user ID after deploying
-- ══════════════════════════════════════════════════════════════
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name)
-- VALUES ('YOUR-AUTH-USER-UUID', 'office@mainecleaningco.com', 'owner', 'Office Admin');
--
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name)
-- VALUES ('YOUR-AUTH-USER-UUID', 'msmall2691@gmail.com', 'owner', 'Matt Small');

-- ══════════════════════════════════════════════════════════════
-- O. HELPER: Calculate client health score
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION calculate_client_health(p_client_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 50; -- baseline
  v_avg_rating DECIMAL;
  v_days_since_service INTEGER;
  v_payment_reliability DECIMAL;
  v_total_visits INTEGER;
BEGIN
  -- Rating component (0-25 points)
  SELECT AVG(client_rating), COUNT(*) INTO v_avg_rating, v_total_visits
  FROM visits WHERE client_id = p_client_id AND client_rating IS NOT NULL;

  IF v_avg_rating IS NOT NULL THEN
    v_score := v_score + ((v_avg_rating / 5.0) * 25)::INTEGER;
  END IF;

  -- Recency component (0-25 points, decays over 90 days)
  SELECT EXTRACT(DAY FROM NOW() - MAX(scheduled_date))::INTEGER INTO v_days_since_service
  FROM visits WHERE client_id = p_client_id AND status = 'completed';

  IF v_days_since_service IS NOT NULL THEN
    v_score := v_score + GREATEST(0, 25 - (v_days_since_service / 4))::INTEGER;
  END IF;

  -- Payment reliability (0-25 points)
  SELECT
    CASE WHEN COUNT(*) = 0 THEN 1.0
    ELSE COUNT(*) FILTER (WHERE status = 'paid')::DECIMAL / COUNT(*)
    END INTO v_payment_reliability
  FROM invoices WHERE client_id = p_client_id;

  v_score := v_score + (v_payment_reliability * 25)::INTEGER;

  -- Loyalty bonus (visits > 10 = +5, > 25 = +10)
  IF v_total_visits > 25 THEN v_score := v_score + 10;
  ELSIF v_total_visits > 10 THEN v_score := v_score + 5;
  END IF;

  -- Cap at 100
  v_score := LEAST(100, GREATEST(0, v_score));

  -- Update client record
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

-- Batch update all client health scores (run via cron)
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
