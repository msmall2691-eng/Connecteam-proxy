# CRM Platform Audit — April 2026

**Compared against**: Autopilot (app.io), Maidily, Jobber, GoHighLevel, MaidCentral, ServiceTitan
**Focus**: Service industry cleaning company CRM — scheduling, automation, omnichannel, RBAC, data isolation

---

## Executive Summary

Your platform has strong bones — visit-based scheduling (v6/v7), automated campaigns (v8), omnichannel communications, Turno/iCal integrations, quote-to-job pipeline, and checklist-driven QA. That puts you ahead of many early-stage cleaning CRMs.

However, there are **critical gaps** that must be addressed before this is production-ready for multiple users, employees, or customers interacting with the system simultaneously. The biggest risks are around **security/data isolation** and **role-based access control**.

---

## CRITICAL ISSUES (Fix Before Launch)

### 1. Row-Level Security is Wide Open

**Current state**: Every RLS policy is `USING (true) WITH CHECK (true)` — meaning ANY authenticated user (or anyone with the anon key) can read/write ALL data across ALL tables.

**Tables with NO RLS at all** (commented out in v1):
- `clients`, `conversations`, `messages`, `jobs`, `invoices`, `invoice_items`, `payroll_exports`

**Tables with RLS enabled but open policies**:
- `employees`, `teams`, `service_types`, `pricing_rules`, `extras`, `checklist_templates`, `visits`, `visit_reminders`, `calendar_sync_log`, `client_schedule_tokens`, `visit_status_history`, `booking_requests`

**Risk**: Anyone with the Supabase anon key (which is in the browser JS) can query/modify any record. A tech could see payroll data. A client could see other clients' data.

**Fix**: See migration v9 below — proper role-based RLS policies.

### 2. No Role-Based Access Control (RBAC)

**Current state**: Only two auth modes:
- Supabase auth with a hardcoded allowlist of 2 emails (`auth.jsx:8-10`)
- Local auth with a single shared password stored as SHA-256 in localStorage

**What's missing**:
- No `user_roles` or `user_profiles` table
- No concept of admin vs manager vs dispatcher vs technician vs client
- No per-user data scoping (technicians see only their visits, clients see only their data)
- No permission matrix (who can create/edit/delete what)

**What competitors offer**:
- **Autopilot**: Admin, Manager, Dispatcher, Field Tech roles with granular permissions
- **Maidily**: Owner, Manager, Cleaner roles with different dashboard views
- **Jobber**: Full custom role builder with field-level permissions

### 3. API Endpoints Have No Authentication

**Current state**: Every `/api/*` serverless function is publicly accessible. No middleware checks for auth tokens, API keys, or session verification.

- `/api/sms?action=send` — anyone can send SMS through your Twilio account
- `/api/campaigns?action=send-blast` — anyone can blast your entire client list
- `/api/visits?action=complete` — anyone can mark visits complete and auto-generate invoices
- `/api/client` has `Access-Control-Allow-Origin: *` — any website can call it

**Fix**: See `api/_middleware.js` pattern below. Separate public endpoints (webhooks, client portal) from admin endpoints that require auth.

### 4. Supabase Anon Key Exposed in Browser

**Current state**: `src/lib/supabase.js` loads the anon key from `VITE_SUPABASE_ANON_KEY` or localStorage. This key is in the client bundle and grants full access due to the open RLS policies.

**Fix**: Use the anon key only for auth operations. Use the service role key ONLY on the server side (API routes). Implement proper RLS so the anon key can only access what the authenticated user should see.

---

## HIGH PRIORITY GAPS (Needed for Competitive Parity)

### 5. No Employee Self-Service Portal / Mobile App

**Competitors**: Maidily, Jobber, ServiceTitan all have mobile apps for field techs.

**What you need**:
- Employee login (separate from admin)
- View assigned schedule (today/week)
- Clock in/out with GPS
- Complete checklists with photo upload
- Submit mileage
- View pay history (own only)
- Accept/decline shift offers

**Current state**: Employees exist in the DB (`employees` table) but have no login, no portal, no mobile view. All interactions go through the single admin dashboard.

### 6. No Time-Off / Availability Management

**Competitors**: All major platforms have this.

**What you need**:
- `employee_availability` table — recurring weekly availability windows
- `time_off_requests` table — PTO/sick day requests with approval workflow
- Scheduling engine respects availability when assigning visits
- Employee can set "unavailable" blocks

### 7. No Route Optimization

**Competitors**: Maidily has AI-powered routing. Jobber has route optimization. ServiceTitan has full dispatch boards.

**What you need**:
- Properties already have lat/lng fields — good foundation
- Zone-based grouping exists (v7) — good foundation
- Missing: actual route calculation, travel time estimates, daily route optimization
- Consider integrating Google Maps Directions API or OSRM
- `route_plans` table to store daily optimized routes per employee/team

### 8. No Recurring Invoice Automation

**Current state**: Invoices are created manually or auto-created on visit completion. No support for:
- Recurring billing (monthly flat-rate clients)
- Auto-charge on file (Square/Stripe)
- Payment plans
- Late fee automation
- Aging reports

**Competitors**: Jobber auto-invoices recurring clients. Autopilot integrates with QuickBooks for recurring billing.

### 9. No Inventory / Supply Tracking

**What you need**:
- `supplies` table — cleaning products, equipment
- `supply_usage` table — per-visit consumption tracking
- Low-stock alerts
- Reorder automation
- Per-property supply requirements (e.g., "client provides own products")

### 10. No Customer Satisfaction / NPS Tracking

**Current state**: `visits.client_rating` (1-5) and `client_feedback` exist but are not aggregated.

**What you need**:
- NPS score calculation and trending
- Automated post-service surveys (beyond just review requests)
- Client health scoring (based on rating trends, payment history, communication frequency)
- Churn risk alerts
- Service recovery workflows (auto-escalate low ratings)

---

## MEDIUM PRIORITY GAPS

### 11. No Audit Trail Beyond Visit Status

**Current state**: Only `visit_status_history` tracks changes.

**What you need**:
- `audit_log` table — track ALL changes to critical entities (clients, jobs, invoices, employees)
- Who changed what, when, old value → new value
- Required for compliance, dispute resolution, and debugging

### 12. No Geofencing

**Competitors**: Maidily has geofencing for service area management.

**What you need**:
- Define service areas as polygons/radius zones
- Auto-reject booking requests outside service area
- Auto-assign zone to new properties based on coordinates
- Travel surcharge for distant properties

### 13. No Document Management

**What you need**:
- Client contracts/agreements (signed PDFs)
- Insurance certificates
- Employee certifications/training records
- Property-specific documents (HOA rules, gate codes, etc.)
- `documents` table with type, entity linkage, storage URL, expiration tracking

### 14. No Estimate/Quote Analytics

**Current state**: Quotes exist with full lifecycle (draft → sent → viewed → accepted/declined).

**What's missing**:
- Conversion rate tracking (quotes sent → accepted)
- Average time to accept
- Win/loss analysis by service type, property type, price range
- Follow-up automation for viewed-but-not-accepted quotes
- A/B testing on pricing

### 15. No Webhook System for Third-Party Integrations

**Current state**: You consume webhooks (Turno, Facebook) but don't emit them.

**What you need**:
- `webhooks` table — subscriber URLs + event filters
- Emit events: visit.completed, invoice.paid, client.created, booking.received
- Retry logic with exponential backoff
- Webhook logs for debugging

### 16. No Multi-Location / Franchise Support

**Current state**: Single-company assumption throughout.

**For future growth**:
- `organizations` table (tenant)
- All tables get `organization_id` FK
- RLS policies scope all queries to current user's org
- Per-org settings, branding, pricing
- Org-level reporting vs company-wide rollups

---

## WHAT YOU HAVE THAT'S STRONG

| Feature | Status | Notes |
|---------|--------|-------|
| Visit-based scheduling | Done (v6/v7) | Best practice — visits as source of truth |
| Recurring visit generation | Done | Postgres function + cron |
| Service catalog + pricing rules | Done (v5) | With frequency discounts |
| Checklist templates | Done (v5) | Per-service-type, with photo/completion tracking |
| Quote builder + approval | Done (v2) | With signature capture, email delivery |
| Drip campaigns + sequences | Done (v8) | Auto-enrollment triggers |
| Omnichannel messaging | Done | Email (Gmail), SMS (Twilio), ManyChat |
| iCal/Turno integration | Done (v6/v7) | Auto-turnover scheduling |
| Google Calendar sync | Done | Bi-directional |
| Client portal | Done (v6) | Token-based, visit confirmation |
| PM portal | Done | Property manager view with photos |
| Visit status audit trail | Done (v7) | Auto-logged by trigger |
| Zone-based assignment | Done (v7) | On employees, properties, visits |
| Booking requests | Done (v4) | Website self-booking |
| Square + Stripe payments | Done | Invoice creation + payment links |
| Property enrichment | Done | Google Places API integration |
| Review request automation | Done (v8) | Post-visit with delay |
| Payroll reporting | Done | Scripts with mileage reimbursement |
| AI chat assistant | Done | OpenAI/Anthropic integration |

---

## RECOMMENDED IMPLEMENTATION ORDER

### Phase 1: Security Foundation (Week 1-2)
1. **RBAC tables** — `user_profiles`, `user_roles` with Supabase auth integration
2. **RLS policies** — proper per-role data scoping on ALL tables
3. **API middleware** — auth verification on all admin endpoints
4. **Separate public vs admin routes** — client portal stays public, everything else requires auth

### Phase 2: Employee Experience (Week 3-4)
5. **Employee portal** — mobile-friendly schedule view, checklist completion, clock in/out
6. **Availability management** — weekly hours, time-off requests
7. **Shift acceptance** — offer shifts to employees, track accept/decline

### Phase 3: Operations (Week 5-6)
8. **Route optimization** — zone-based daily route planning
9. **Recurring billing** — auto-invoice for monthly clients
10. **Supply tracking** — basic inventory per visit
11. **Audit log** — comprehensive change tracking

### Phase 4: Growth (Week 7-8)
12. **Customer health scoring** — NPS, churn risk, payment reliability
13. **Quote analytics** — conversion tracking, follow-up automation
14. **Geofencing** — service area management
15. **Document management** — contracts, certs, property docs
16. **Webhook system** — outbound event notifications

---

## SCHEMA CHANGES PROVIDED

The following files implement Phase 1 (security) plus key tables from Phases 2-4:

- `sql/supabase-migration-v9-rbac-and-gaps.sql` — Full migration with:
  - `user_profiles` — links Supabase auth to roles
  - `employee_availability` — weekly availability windows
  - `time_off_requests` — PTO with approval workflow
  - `audit_log` — comprehensive change tracking
  - `documents` — file/contract management
  - `supply_items` + `supply_usage` — inventory tracking
  - Proper RLS policies for ALL tables scoped by role
  - Helper functions for role checking

- `api/_auth.js` — Shared auth middleware for API routes
