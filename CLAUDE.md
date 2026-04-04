# Connecteam Proxy & Reports

## Quick Commands

### Weekly Employee Report (hours, mileage, pay per employee per week)
```bash
python3 scripts/report.py                                    # Last 4 weeks
python3 scripts/report.py --weeks 2                          # Last 2 weeks
python3 scripts/report.py --start 2026-03-01 --end 2026-03-31
```

### Payroll Prep + Mileage Reimbursement (ready for Square Payroll)
```bash
python3 scripts/payroll.py                                   # Last 2 weeks (current pay period)
python3 scripts/payroll.py --weeks 1                         # Last week only
python3 scripts/payroll.py --start 2026-03-16 --end 2026-03-29
python3 scripts/payroll.py --rate 0.70 --threshold 35        # Custom IRS rate / threshold
```
Mileage rules: reimburse miles over 35 to first job of day + all between-job miles at $0.70/mi (IRS rate).

### Operations Dashboard (schedule coverage, attendance, client job history)
```bash
python3 scripts/dashboard.py                                 # All reports, last 2 weeks
python3 scripts/dashboard.py --report schedule               # Schedule coverage only
python3 scripts/dashboard.py --report attendance             # Attendance tracker only
python3 scripts/dashboard.py --report jobs                   # Client job history only
python3 scripts/dashboard.py --weeks 4                       # Last 4 weeks
```

### All scripts support:
- `--output filename.md` — custom output file
- `--api-key KEY` — override API key
- `--start YYYY-MM-DD --end YYYY-MM-DD` — custom date range

## What each report includes

### report.py (Weekly Report)
- Hours + pay per employee per week
- Mileage per shift with GPS locations
- Employee notes from clock-in/out
- Flags: data entry errors, unapproved timesheets, short clock-ins

### payroll.py (Payroll Prep)
- Hours and hourly pay breakdown
- Miles reported vs reimbursable miles (over 35mi threshold)
- Mileage reimbursement at IRS rate
- Total compensation (pay + reimbursement)
- Payroll summary table ready for Square Payroll
- Issues to resolve before processing

### dashboard.py (Operations Dashboard)
- **Schedule Coverage**: open/unfilled shifts, rejected shifts with reasons, no-response shifts
- **Attendance**: late clock-ins (>10min), early leaves (>15min), missed shifts (no clock-in), scheduled vs actual hours
- **Client Job History**: every location serviced, times cleaned, who cleaned, employee notes

## Campaigns & Automation

### Blast Campaigns (one-time bulk SMS/email)
Create and send via `/campaigns` page or API:
```
POST /api/campaigns?action=create   — create blast or sequence
POST /api/campaigns?action=send-blast — send blast to audience
GET  /api/campaigns?action=list     — list all campaigns
```
Audience filtering: by client status (lead/prospect/active), type (residential/commercial/rental), tags.
Personalization: `{first_name}`, `{name}` in message body/subject.

### Drip Sequences (automated multi-step campaigns)
- Define multi-step sequences with delay_days between steps
- Auto-enroll clients via database trigger on status changes (e.g., lead → prospect)
- Cron runs daily at 12 PM UTC: `/api/campaigns?action=run-sequences`
- Manual enrollment: `POST /api/campaigns?action=trigger-sequence`

### Review Requests (automated post-visit)
- Cron runs daily at 2 PM UTC: `/api/visits?action=review-request`
- Sends SMS + email with Google review link 2 days after visit completion
- Only sends if follow-up was already sent (ensures thank-you goes first)
- Set `GOOGLE_REVIEW_URL` env var for your business review link

### Schema: `sql/supabase-migration-v8-campaigns.sql`
- `campaigns` — blast or sequence definitions with audience targeting
- `campaign_steps` — individual steps in a drip sequence
- `campaign_enrollments` — tracks which clients are in which sequences
- `sequence_triggers` — auto-enroll rules (on status change, tag add, etc.)
- `visits.review_request_sent_at` — tracks review request delivery

## API Proxy
The Vercel proxy is at: `https://connecteam-proxy.vercel.app/api/connecteam`

Example endpoints (pass as `?path=`):
- `users/v1/users` — all employees
- `me` — company info
- `time-clock/v1/time-clocks/15248536/timesheet?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — timesheets
- `time-clock/v1/time-clocks/15248536/time-activities?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` — clock in/out with mileage
- `scheduler/v1/schedulers/15248539/shifts?startTime=UNIX&endTime=UNIX` — schedule
- `jobs/v1/jobs` — job locations
- `forms/v1/forms` — forms
- `tasks/v1/taskboards/15248544/tasks` — tasks

## API Key
Set via environment variable: `CONNECTEAM_API_KEY`
Or pass directly: `python3 scripts/report.py --api-key YOUR_KEY`

## Database Schema (Supabase)

### Core Tables
- `clients` — CRM contacts (leads → prospects → active). Has referral tracking, lead stage, payment terms
- `properties` — Service locations per client. Includes pet info, access codes, parking, cleaning notes, photos, iCal sync
- `employees` — Local mirror of Connecteam users. Stores hourly rates, custom rates (JSON), skills, zones, calendar colors
- `teams` — Crew grouping with lead + members, zone assignment, colors

### Service Catalog
- `service_types` — Standardized services (Standard Clean, Deep Clean, Move-Out, Turnover, etc.) with duration estimates
- `pricing_rules` — Per service type + property size pricing with frequency discounts (weekly=15%, biweekly=10%)
- `extras` — Add-on services (Inside Oven $35, Interior Windows $5/ea, Laundry $25/load, etc.)
- `checklist_templates` — Per-room cleaning checklists (sections → items with required flag)

### Scheduling (Job → Visit pattern)
- `jobs` — Master service record (recurring or one-time). Links to client, property, service type, employee/team
- `visits` — Individual occurrences of a job. Tracks actual times, GPS, checklist completion, photos, mileage, client rating

### Communications
- `conversations` — Thread grouping by client + channel (email, text, phone, system)
- `messages` — Individual messages with v5 enrichments: job/visit linking, automation tracking, call logging

### Billing
- `invoices` — With Square/Stripe integration, linked to properties and quotes
- `invoice_items` — Line items linked to jobs
- `payment_transactions` — Payment records across providers (Square, Stripe, cash, check)
- `quotes` — Estimates with approval workflow, signature capture, frequency pricing

### Other
- `booking_requests` — Website self-booking with property_id linking and approval workflow
- `rental_calendars` — iCal sync config per property (legacy — fields absorbed into properties in v5)
- `notifications` — Dashboard alerts
- `payroll_exports` — Payroll period snapshots

### RBAC & Security (v9)
- `user_profiles` — Links Supabase auth to roles (owner/admin/manager/dispatcher/technician/client)
- `employee_availability` — Weekly availability windows per employee
- `time_off_requests` — PTO/sick day requests with approval workflow
- `audit_log` — Comprehensive change tracking on clients, jobs, invoices, employees, visits
- `documents` — File/contract management (contracts, insurance certs, property docs)
- `supply_items` + `supply_usage` — Inventory tracking with auto-decrement
- `shift_offers` — Offer open shifts to employees, track accept/decline
- `webhooks` + `webhook_deliveries` — Outbound event notifications to third parties
- `notifications` — Enhanced per-user/per-role in-app alerts with action URLs
- RLS policies on ALL tables scoped by user role

### Schema Migrations
- `sql/supabase-schema.sql` — Initial schema (v1)
- `sql/supabase-migration-v2.sql` — Properties, quotes, rental calendars, payment transactions
- `sql/supabase-migration-v3.sql` — Notifications table
- `sql/supabase-migration-v4-bookings.sql` — Booking requests
- `sql/supabase-migration-v5-schema-cleanup.sql` — Employees, visits, service types, checklists, extras, enriched messages
- `sql/supabase-migration-v6-scheduling-redesign.sql` — Visits as single source of truth, calendar sync log, client portal tokens, visit reminders, recurring visit generation functions
- `sql/supabase-migration-v7-workflow-enhancements.sql` — Visit status history, zone fields, Turno integration, confirmation tokens, deprecation comments on jobs
- `sql/supabase-migration-v8-campaigns.sql` — Campaigns (blast + sequence), campaign steps, enrollments, sequence triggers, review request tracking
- `sql/supabase-migration-v9-rbac-and-gaps.sql` — RBAC, RLS policies, audit log, employee availability, time-off, supplies, documents, shift offers, webhooks, notifications, client health scoring

### Scheduling Architecture (v6+v7)
- **Jobs** = service agreements (what, who, how often, price). NOT individual occurrences.
- **Visits** = the canonical schedule. Every individual cleaning is a visit.
- **calendar_sync_log** = tracks what's been pushed to Google Calendar / Connecteam
- **visit_reminders** = tracks reminders sent per visit
- **client_schedule_tokens** = token-based client portal access
- **visit_status_history** = audit trail of status changes (auto-logged by trigger)
- **Turno integration** = webhook endpoint at `/api/turno`, links via `properties.turno_listing_id`
- **Recurring visit generation** = `/api/visits?action=generate-recurring` cron (Monday 7am)
- **Client confirmation** = visits have `confirm_token` for SMS/email one-click confirm
- See `docs/scheduling-redesign-plan.md` for full implementation plan

### Employee Portal API (`/api/employee-portal`)
```
GET  ?action=my-schedule&days=7            — upcoming visits for logged-in employee
GET  ?action=my-visits&date=YYYY-MM-DD     — visits for a specific date
POST ?action=clock-in&visitId=xxx          — clock in with GPS (body: {latitude, longitude})
POST ?action=clock-out&visitId=xxx         — clock out with GPS + mileage
POST ?action=update-checklist              — update checklist items from mobile
GET  ?action=my-shift-offers               — pending shift offers
POST ?action=respond-offer                 — accept/decline (body: {offerId, response, reason})
GET  ?action=my-pay-history                — own pay history (last 90 days)
POST ?action=log-supply                    — log supply usage (body: {visitId, supplyItemId, quantity})
```

### Staff Management API (`/api/staff`)
```
# Availability
GET  ?action=availability&employeeId=xxx   — weekly availability
POST ?action=set-availability              — set weekly slots (body: {employeeId, slots[]})

# Time-Off
GET  ?action=time-off-requests             — list requests (filtered by role)
POST ?action=request-time-off              — submit request (body: {type, start_date, end_date, reason})
POST ?action=review-time-off               — approve/deny (body: {requestId, decision, notes})

# Shift Offers
POST ?action=create-shift-offer            — offer visit to employees (body: {visitId, employeeIds[], expiresInHours})
GET  ?action=shift-offers&visitId=xxx      — list offers for a visit

# Supplies
GET  ?action=supplies                      — list all supply items
POST ?action=add-supply                    — add new item (body: {name, category, unit, ...})
POST ?action=restock                       — add stock (body: {supplyItemId, quantity})
GET  ?action=low-stock                     — items below reorder threshold

# Documents
GET  ?action=documents&clientId=xxx        — list documents (filter by entity)
POST ?action=upload-document               — add document record (body: {name, type, storage_url, ...})
POST ?action=delete-document               — remove document

# Notifications
GET  ?action=notifications&unread=true     — in-app notifications for current user
POST ?action=mark-read                     — mark notifications read (body: {notificationIds[]})
POST ?action=create-notification           — create notification (body: {title, body, type, ...})

# Webhooks (admin only)
GET  ?action=webhooks                      — list webhook subscriptions
POST ?action=create-webhook                — subscribe (body: {url, events[], secret})
POST ?action=delete-webhook                — unsubscribe

# Health Scoring
GET  ?action=refresh-health                — recalculate all client health scores (cron: Monday 6am)
GET  ?action=churn-risk                    — active clients with high churn risk
GET  ?action=expiring-documents            — documents expiring within 30 days
```

### Authentication
- All admin API routes now require auth via `Authorization: Bearer <supabase_jwt>`
- Public endpoints (webhooks, client portal, crons) bypass auth
- Role hierarchy: owner > admin > manager > dispatcher > technician > viewer > client
- API key auth: set `ADMIN_API_KEY` env var, pass via `X-API-Key` header
- Auth middleware: `api/_auth.js` — import `requireAuth`, `requireRole`, `setAdminCors`
- Webhook dispatch: `api/_webhooks.js` — import `dispatchWebhook`, `createNotification`

## Notes
- Connecteam API rate limits to ~5 requests per 10 seconds
- Time clock ID: 15248536
- Scheduler ID: 15248539
- Task board ID: 15248544
- Mileage is stored in `shiftAttachments[].attachment.number` on time activities
- Pay rates come from timesheet payItems
- Enid Laganas gets $93/shift rate pay for janitorial (Naples Marina) — stored in employees.custom_rates
- Cleaning techs (Charnette, Laila) are $25/hr
