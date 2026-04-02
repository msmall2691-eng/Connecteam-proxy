-- Workflow HQ Schema Migration v2
-- Run this in Supabase SQL Editor AFTER the initial schema
-- Adds: properties, quotes, rental_calendars, payment_transactions
-- Alters: jobs, invoices, clients

-- ══════════════════════════════════════════
-- PROPERTIES (clients can have multiple)
-- ══════════════════════════════════════════
create table if not exists properties (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  name text,
  address_line1 text not null,
  address_line2 text,
  city text,
  state text,
  zip text,
  type text not null default 'residential' check (type in ('residential', 'commercial', 'rental', 'marina')),
  sqft integer,
  bedrooms integer,
  bathrooms integer,
  pet_hair text default 'none' check (pet_hair in ('none', 'some', 'heavy')),
  condition text default 'maintenance' check (condition in ('maintenance', 'moderate', 'heavy')),
  access_notes text,
  is_primary boolean default false,
  ical_url text,
  checkout_time time default '10:00',
  cleaning_time time default '11:00',
  rental_platform text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_properties_client on properties(client_id);
create index if not exists idx_properties_type on properties(type);

-- ══════════════════════════════════════════
-- QUOTES (separate from invoices)
-- ══════════════════════════════════════════
create table if not exists quotes (
  id uuid primary key default uuid_generate_v4(),
  quote_number text unique not null,
  client_id uuid references clients(id) on delete cascade not null,
  property_id uuid references properties(id) on delete set null,
  service_type text not null,
  frequency text not null default 'one-time' check (frequency in ('one-time', 'weekly', 'biweekly', 'monthly')),
  estimate_min decimal(10,2),
  estimate_max decimal(10,2),
  final_price decimal(10,2),
  calc_inputs jsonb default '{}',
  calc_breakdown jsonb default '{}',
  status text not null default 'draft' check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired')),
  sent_via text,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  expires_at timestamptz,
  signature_data jsonb,
  items jsonb default '[]',
  notes text,
  preferred_day integer,
  preferred_time text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_quotes_client on quotes(client_id);
create index if not exists idx_quotes_property on quotes(property_id);
create index if not exists idx_quotes_status on quotes(status);

-- ══════════════════════════════════════════
-- RENTAL CALENDARS (per property, replaces localStorage)
-- ══════════════════════════════════════════
create table if not exists rental_calendars (
  id uuid primary key default uuid_generate_v4(),
  property_id uuid references properties(id) on delete cascade not null,
  ical_url text not null,
  google_calendar_id text,
  platform text default 'airbnb',
  checkout_time time default '10:00',
  cleaning_time time default '11:00',
  auto_schedule boolean default false,
  last_synced_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_rental_calendars_property on rental_calendars(property_id);

-- ══════════════════════════════════════════
-- PAYMENT TRANSACTIONS
-- ══════════════════════════════════════════
create table if not exists payment_transactions (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid references invoices(id) on delete cascade not null,
  provider text not null check (provider in ('square', 'stripe', 'cash', 'check', 'other')),
  provider_txn_id text,
  amount decimal(10,2) not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'refunded')),
  provider_data jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists idx_payment_txns_invoice on payment_transactions(invoice_id);

-- ══════════════════════════════════════════
-- ALTER EXISTING TABLES
-- ══════════════════════════════════════════

-- Clients: add payment IDs and preferences
alter table clients add column if not exists square_customer_id text;
alter table clients add column if not exists stripe_customer_id text;
alter table clients add column if not exists preferred_contact text default 'email';

-- Jobs: link to properties and quotes
alter table jobs add column if not exists property_id uuid references properties(id) on delete set null;
alter table jobs add column if not exists quote_id uuid references quotes(id) on delete set null;
alter table jobs add column if not exists google_event_id text;
alter table jobs add column if not exists service_type text;
alter table jobs add column if not exists address text;

-- Invoices: link to properties, quotes, and payment providers
alter table invoices add column if not exists property_id uuid references properties(id) on delete set null;
alter table invoices add column if not exists quote_id uuid references quotes(id) on delete set null;
alter table invoices add column if not exists square_invoice_id text;
alter table invoices add column if not exists square_public_url text;
alter table invoices add column if not exists stripe_invoice_id text;
alter table invoices add column if not exists stripe_payment_url text;
alter table invoices add column if not exists sent_at timestamptz;
alter table invoices add column if not exists email_sent boolean default false;

-- Invoice items: link to properties
alter table invoice_items add column if not exists property_id uuid references properties(id) on delete set null;

-- ══════════════════════════════════════════
-- TRIGGERS for new tables
-- ══════════════════════════════════════════
create trigger properties_updated_at before update on properties for each row execute function update_updated_at();
create trigger quotes_updated_at before update on quotes for each row execute function update_updated_at();
