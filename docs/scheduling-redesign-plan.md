# Scheduling Redesign Plan (v6)

## The Problem

The current scheduling system has 3 disconnected sources of truth (Google Calendar, Connecteam Scheduler, Supabase `jobs` table), and the `jobs` table is doing triple duty as:
1. A **service agreement** (what service, for whom, recurring rules, pricing)
2. A **one-off job record** (date, time, status for a single cleaning)
3. An **individual occurrence** (when turnovers are detected from iCal)

The `visits` table was added in v5 but **nothing uses it** — Schedule.jsx, auto-turnovers.js, and reminders.js all query `jobs` directly.

Additionally:
- STR turnovers (iCal/Turno) are a completely separate workflow from recurring client scheduling
- New leads all default to "residential" regardless of what they actually need
- There's no client-facing schedule portal
- Service types on jobs are free-text strings, not linked to the `service_types` table

## The Solution: Visits as Single Source of Truth

**Think of it like Jobber:**
- **Job** = the service agreement ("Clean Jane's house every Tuesday for $200")
- **Visit** = each individual occurrence ("Tuesday April 8th, 9am-12pm, assigned to Charnette")

Everything on the schedule is a **visit**. Period.

### Data Flow (New)

```
                    ┌─────────────────────┐
                    │   VISIT (canonical)  │
                    │   = what's on the    │
                    │     schedule today   │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
     Google Calendar    Connecteam      Client Portal
     (sync outbound)   (sync outbound)  (read-only view)
```

### How Visits Get Created

| Source | Flow |
|--------|------|
| **Recurring client** | Job (agreement) → `generate_recurring_visits()` → visits 8 weeks ahead |
| **One-time job** | Quote accepted or manual → Job created → single visit created |
| **STR turnover** | iCal scan → visit with `source='ical_sync'`, linked to turnover job for that property |
| **Turno import** | Turno webhook/sync → visit with `source='turno'`, `turno_task_id` set |
| **Booking request** | Client books online → visit with `source='booking'`, pending approval |
| **Manual** | Admin creates directly → visit with `source='manual'` |

### Then What?

Once a visit exists:
1. **Calendar sync** pushes it to Google Calendar → `calendar_sync_log` tracks the google_event_id
2. **Connecteam sync** pushes it as a shift → `calendar_sync_log` tracks the connecteam_shift_id
3. **Reminders** query upcoming visits → send email/SMS → `visit_reminders` tracks delivery
4. **Client portal** shows visits where `client_visible = true` via `client_schedule_tokens`
5. **Dashboard/reports** query visits for attendance, hours, job history

---

## Schema Changes (v6 Migration)

### Jobs Table (Service Agreement)

**Added columns:**
| Column | Purpose |
|--------|---------|
| `recurrence_start_date` | When the recurring service begins |
| `recurrence_end_date` | When it ends (null = ongoing) |
| `preferred_start_time` | Default start time for visits |
| `preferred_end_time` | Default end time for visits |
| `visit_generation_horizon_weeks` | How far ahead to generate (default 8) |
| `last_visit_generated_date` | Tracks generation progress |
| `source` | How this job was created (manual, quote, booking_request, ical_sync, turno) |
| `is_active` | Soft toggle to pause without deleting |

**Existing columns kept (still useful on the agreement):**
- `client_id`, `property_id`, `quote_id`, `title`, `service_type_id`
- `price`, `price_type`, `is_recurring`, `recurrence_rule`, `recurrence_day`
- `assigned_employee_id`, `assigned_team_id`, `instructions`, `extras`

**Columns to eventually deprecate** (after code migration):
- `date`, `start_time`, `end_time` — these are per-visit, not per-agreement
- `status` — agreement is active/inactive, individual status lives on visits
- `google_event_id`, `connecteam_shift_id` — these belong on visits/calendar_sync_log

### Visits Table (The Schedule)

**Added columns:**
| Column | Purpose |
|--------|---------|
| `source` | How this visit was created |
| `service_type_id` | Denormalized from job for fast queries |
| `client_visible` | Show in client portal? |
| `reminder_sent_at` | Last reminder timestamp |
| `confirmed_at` | When client confirmed |
| `ical_event_uid` | Links to source iCal event (STR turnovers) |
| `turno_task_id` | Links to Turno task |
| `instructions` | Per-visit overrides |
| `address` | Denormalized for quick views |

### New Tables

| Table | Purpose |
|-------|---------|
| `visit_reminders` | Track every reminder sent (channel, status, external message ID) |
| `calendar_sync_log` | Track what's synced to Google Cal / Connecteam (visit_id, provider, external_id, direction, status) |
| `client_schedule_tokens` | Client portal access tokens (token, client_id, expiry) |

### Database Functions

| Function | Purpose |
|----------|---------|
| `generate_recurring_visits(job_id, horizon)` | Generate visits for one job |
| `generate_all_recurring_visits(horizon)` | Generate visits for all active recurring jobs |

---

## Code Changes Required

### Phase 1: Make Visits Work (Core)

#### `api/auto-turnovers.js`
**Current:** Creates rows in `jobs` table for each detected turnover.
**New:** 
1. Find or create a standing "Turnover Service" job for each rental property
2. Create **visits** (not jobs) for each detected checkout date
3. Set `source='ical_sync'`, `ical_event_uid` = iCal UID
4. Dedup against existing visits by `ical_event_uid`
5. After creating visits, sync to Google Cal / Connecteam via `calendar_sync_log`

#### `api/reminders.js`
**Current:** Queries `jobs` table for tomorrow's jobs.
**New:**
1. Query `visits` table for tomorrow's visits where `status = 'scheduled'` and `reminder_sent_at IS NULL`
2. Join with `clients` for contact info
3. After sending, insert into `visit_reminders` and update `visits.reminder_sent_at`

#### `api/quote-approve.js`
**Current:** Creates a `jobs` row with date/time when quote is accepted.
**New:**
1. Create `jobs` row as service agreement (recurrence fields, no single date)
2. Create first `visit` from the job
3. If recurring, call `generate_recurring_visits()` for 8 weeks ahead
4. Sync first visit to Google Calendar

#### `src/lib/store.js`
**Current:** `generateVisitsForJob()` exists but generates from localStorage.
**New:** Call the Supabase function `generate_recurring_visits()` or implement the same logic client-side against Supabase.

#### `src/pages/Schedule.jsx`
**Current:** 11,500 lines merging Google Calendar events, scanned turnovers, and Connecteam shifts.
**New:**
1. Primary data source: `visits` table (with joins to jobs, clients, properties, employees)
2. Calendar view renders visits directly
3. Google Calendar events shown as overlay (dimmed) for reference only
4. "Push to Connecteam" becomes "Sync to Connecteam" operating on visits
5. Turnover scanning creates visits, not jobs

#### `api/connecteam.js`
**Current:** Manual push from Schedule page creates shifts.
**New:**
1. Accept visit_id instead of raw data
2. Look up visit details, create Connecteam shift
3. Write to `calendar_sync_log` with provider='connecteam'
4. Webhook handler updates visit status from clock in/out events

### Phase 2: Client Portal

#### New: `api/portal.js` (or enhance existing)
- `GET /api/portal?token=ABC123&action=schedule` → returns upcoming visits for this client
- `POST /api/portal?token=ABC123&action=confirm&visit_id=XYZ` → client confirms a visit
- Token looked up in `client_schedule_tokens`

#### New: Client Schedule View
Simple page (could be a standalone HTML page or React route):
- Shows upcoming visits: date, time, service type, assigned cleaner
- "Confirm" button for each visit
- Past visits with rating option
- No login required — token-based access

### Phase 3: Service Type Fix

#### `api/leads.js`
**Current:** Creates client with `type` from form, but service_type on resulting job is free text.
**New:**
1. Map form `service_type` to `service_types.id` via lookup
2. Store `service_type_id` on the job (not free text)
3. Map `propertyType` correctly: if "rental" → client.type = 'rental', if "commercial" → 'commercial', etc.
4. Don't default everything to 'residential' — respect what the lead selected

#### `api/quote-approve.js`
**Current:** Job title determines service type.
**New:** Quote stores `service_type_id` → flows through to job → flows to visits.

### Phase 4: Turno Integration

#### New: `api/turno.js`
If you want to pull from Turno instead of (or in addition to) raw iCal:
1. Turno has a webhook for new tasks → creates visits with `source='turno'`
2. Or poll Turno API periodically → create visits, dedup by `turno_task_id`
3. Turno tasks map to visits with service_type = 'Turnover'

Alternatively, Turno already syncs to iCal feeds. The current iCal approach works — just point `auto-turnovers.js` at the Turno-generated iCal URL. The key change is that it creates **visits** not **jobs**.

---

## STR Turnover Scheduling (Turno-like Workflow)

### How It Should Work

1. **Property setup:** Rental property has `ical_url` (from Airbnb/VRBO/Turno) and `auto_schedule_turnovers = true`
2. **Daily cron** (`/api/auto-turnovers`):
   - Fetch iCal feed for each rental property
   - Parse checkout dates
   - For each checkout, find/create a standing "Turnover" job for this property
   - Create a visit: `source='ical_sync'`, `ical_event_uid = iCal UID`, scheduled for `cleaning_time` on checkout day
   - Dedup: skip if `ical_event_uid` already has a visit
3. **Visit appears on Schedule.jsx** alongside all other visits
4. **Employee assignment:** Admin assigns from the schedule view
5. **Sync to Connecteam:** Push as shift so cleaner sees it in their app
6. **Client notification:** If property owner wants updates, send via `visit_reminders`

### iCal vs Google Calendar vs Turno

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Direct iCal URL** | Simple, works with any platform | One-way, have to poll, no push notifications | Good for Airbnb/VRBO |
| **Google Calendar** | Real-time updates if using push notifications, familiar UI | Adds Google as dependency, OAuth complexity | Keep as optional overlay |
| **Turno** | Purpose-built for STR turnovers, handles scheduling rules, cleaner assignment | Another subscription, another API | Use Turno's iCal export as the feed URL |

**Recommendation:** Keep using iCal feeds as the input mechanism. Whether the feed comes from Airbnb directly or from Turno doesn't matter — `auto-turnovers.js` just reads the iCal. Turno is great for managing the STR relationship (auto-assign cleaners, track quality, host communication) but the scheduling data flows through visits in your system.

---

## Cron Schedule (Updated vercel.json)

```json
{
  "crons": [
    {
      "path": "/api/auto-turnovers?action=scan&days=30",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/visits?action=generate-recurring",
      "schedule": "0 7 * * 1"
    },
    {
      "path": "/api/reminders?action=send",
      "schedule": "0 18 * * *"
    },
    {
      "path": "/api/calendar-sync?action=sync-pending",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

| Cron | Purpose |
|------|---------|
| 8 AM daily | Scan iCal feeds → create turnover visits |
| 7 AM Monday | Generate recurring visits 8 weeks ahead |
| 6 PM daily | Send tomorrow's reminders |
| Every 30 min | Push pending visits to Google Cal / Connecteam |

---

## Migration Order

1. **Run v6 SQL migration** — adds new columns/tables, backfills existing jobs → visits
2. **Update `auto-turnovers.js`** — create visits instead of jobs
3. **Update `reminders.js`** — query visits instead of jobs  
4. **Update `quote-approve.js`** — create job + first visit, use service_type_id
5. **Update `leads.js`** — proper service type mapping
6. **Update `Schedule.jsx`** — render from visits table
7. **Update `store.js`** — visit CRUD operations
8. **Add client portal** — token-based schedule view
9. **Add calendar sync cron** — push visits to Google Cal / Connecteam
10. **Deprecate old fields** — remove date/time/google_event_id from jobs table

---

## What This Gives You (Jobber-like Experience)

1. **One schedule view** — all visits (recurring, one-off, turnovers) in one place
2. **Client portal** — clients see their upcoming cleanings and confirm
3. **Automatic reminders** — sent from visits, tracked properly
4. **STR turnovers integrated** — show up as visits alongside everything else
5. **Proper service types** — every job has a real service_type_id, not free text
6. **Calendar sync is outbound** — visits are the source of truth, pushed to Google/Connecteam
7. **Turno compatibility** — Turno's iCal feed flows into visits seamlessly
8. **Recurring visit generation** — database function handles the math, runs weekly via cron
