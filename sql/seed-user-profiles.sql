-- User Profile Seeding Script
-- Run this in Supabase SQL Editor AFTER migration v9
--
-- STEP 1: Make sure your admin users exist in Supabase Auth
--   Go to Supabase Dashboard → Authentication → Users
--   Create users for each person who needs access
--   Copy their auth.users UUID (the "id" column)
--
-- STEP 2: Run the appropriate INSERT statements below,
--   replacing 'YOUR-AUTH-UUID-HERE' with real UUIDs
--
-- STEP 3: Optionally link employees to their user profiles

-- ══════════════════════════════════════════════════════════════
-- OWNER / ADMIN PROFILES
-- These get full access to everything
-- ══════════════════════════════════════════════════════════════

-- Matt Small (owner) — replace UUID after creating auth user
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name)
-- VALUES ('REPLACE-WITH-AUTH-UUID', 'msmall2691@gmail.com', 'owner', 'Matt Small');

-- Office account (admin) — replace UUID after creating auth user
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name)
-- VALUES ('REPLACE-WITH-AUTH-UUID', 'office@mainecleaningco.com', 'admin', 'Office Admin');

-- ══════════════════════════════════════════════════════════════
-- HELPER: Auto-seed profiles from existing auth users
-- Run this query to see your current Supabase auth users and their UUIDs:
-- ══════════════════════════════════════════════════════════════

-- SELECT id, email, created_at FROM auth.users ORDER BY created_at;

-- ══════════════════════════════════════════════════════════════
-- AUTOMATED SEEDING FUNCTION
-- Call this after creating auth users to auto-generate profiles
-- Maps known emails to roles and links to employees
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION seed_user_profiles()
RETURNS TABLE(email TEXT, role TEXT, status TEXT) AS $$
DECLARE
  v_user RECORD;
  v_role TEXT;
  v_employee_id UUID;
  v_display TEXT;
BEGIN
  FOR v_user IN SELECT id, au.email FROM auth.users au LOOP
    -- Skip if profile already exists
    IF EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = v_user.id) THEN
      email := v_user.email;
      role := (SELECT up.role FROM user_profiles up WHERE up.auth_user_id = v_user.id);
      status := 'already_exists';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Determine role based on email
    v_role := CASE
      WHEN v_user.email IN ('msmall2691@gmail.com') THEN 'owner'
      WHEN v_user.email IN ('office@mainecleaningco.com') THEN 'admin'
      WHEN v_user.email ILIKE '%manager%' THEN 'manager'
      WHEN v_user.email ILIKE '%dispatch%' THEN 'dispatcher'
      ELSE 'technician'  -- default: field tech
    END;

    -- Try to match to an existing employee by email
    SELECT e.id INTO v_employee_id
    FROM employees e
    WHERE lower(e.email) = lower(v_user.email)
    LIMIT 1;

    -- Generate display name from email
    v_display := split_part(v_user.email, '@', 1);
    v_display := replace(v_display, '.', ' ');
    v_display := initcap(v_display);

    -- Create the profile
    INSERT INTO user_profiles (auth_user_id, email, role, employee_id, display_name)
    VALUES (v_user.id, v_user.email, v_role, v_employee_id, v_display);

    email := v_user.email;
    role := v_role;
    status := 'created';
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════
-- RUN THE SEEDER:
-- After creating your auth users, just call:
-- SELECT * FROM seed_user_profiles();
-- ══════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════
-- EMPLOYEE → USER PROFILE LINKER
-- If you add employee auth users later, run this to link them:
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION link_employees_to_profiles()
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_emp RECORD;
BEGIN
  FOR v_emp IN
    SELECT e.id AS emp_id, e.email AS emp_email, up.id AS profile_id
    FROM employees e
    JOIN user_profiles up ON lower(up.email) = lower(e.email)
    WHERE up.employee_id IS NULL
      AND e.email IS NOT NULL
  LOOP
    UPDATE user_profiles SET employee_id = v_emp.emp_id WHERE id = v_emp.profile_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════════════════════════════════
-- MANUAL SEED: Known employees with roles
-- Uncomment and adjust as needed
-- ══════════════════════════════════════════════════════════════

-- Enid Laganas — technician (janitorial, $93/shift Naples Marina)
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name, employee_id)
-- SELECT 'REPLACE-UUID', 'enid@example.com', 'technician', 'Enid Laganas', id
-- FROM employees WHERE first_name = 'Enid' AND last_name = 'Laganas';

-- Charnette — technician ($25/hr cleaning)
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name, employee_id)
-- SELECT 'REPLACE-UUID', 'charnette@example.com', 'technician', 'Charnette', id
-- FROM employees WHERE first_name = 'Charnette';

-- Laila — technician ($25/hr cleaning)
-- INSERT INTO user_profiles (auth_user_id, email, role, display_name, employee_id)
-- SELECT 'REPLACE-UUID', 'laila@example.com', 'technician', 'Laila', id
-- FROM employees WHERE first_name = 'Laila';

-- ══════════════════════════════════════════════════════════════
-- VERIFY: Check all profiles after seeding
-- ══════════════════════════════════════════════════════════════

-- SELECT
--   up.email,
--   up.role,
--   up.display_name,
--   up.is_active,
--   e.first_name || ' ' || e.last_name AS employee_name,
--   c.name AS linked_client
-- FROM user_profiles up
-- LEFT JOIN employees e ON e.id = up.employee_id
-- LEFT JOIN clients c ON c.id = up.client_id
-- ORDER BY
--   CASE up.role
--     WHEN 'owner' THEN 1
--     WHEN 'admin' THEN 2
--     WHEN 'manager' THEN 3
--     WHEN 'dispatcher' THEN 4
--     WHEN 'technician' THEN 5
--     WHEN 'viewer' THEN 6
--     WHEN 'client' THEN 7
--   END;
