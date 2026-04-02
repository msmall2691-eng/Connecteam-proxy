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

### Schema Migrations
- `sql/supabase-schema.sql` — Initial schema (v1)
- `sql/supabase-migration-v2.sql` — Properties, quotes, rental calendars, payment transactions
- `sql/supabase-migration-v3.sql` — Notifications table
- `sql/supabase-migration-v4-bookings.sql` — Booking requests
- `sql/supabase-migration-v5-schema-cleanup.sql` — Employees, visits, service types, checklists, extras, enriched messages

## Notes
- Connecteam API rate limits to ~5 requests per 10 seconds
- Time clock ID: 15248536
- Scheduler ID: 15248539
- Task board ID: 15248544
- Mileage is stored in `shiftAttachments[].attachment.number` on time activities
- Pay rates come from timesheet payItems
- Enid Laganas gets $93/shift rate pay for janitorial (Naples Marina) — stored in employees.custom_rates
- Cleaning techs (Charnette, Laila) are $25/hr
