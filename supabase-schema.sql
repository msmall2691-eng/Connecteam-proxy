-- Workflow HQ Database Schema for Supabase
-- Run this in Supabase SQL editor to set up your database

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ══════════════════════════════════════════
-- CLIENTS
-- ══════════════════════════════════════════
create table clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text,
  phone text,
  address text,
  status text not null default 'lead' check (status in ('lead', 'prospect', 'active', 'inactive')),
  type text not null default 'residential' check (type in ('residential', 'commercial', 'rental', 'marina')),
  source text,
  notes text,
  tags text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_clients_status on clients(status);
create index idx_clients_name on clients(name);

-- ══════════════════════════════════════════
-- CONVERSATIONS
-- ══════════════════════════════════════════
create table conversations (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  subject text,
  channel text not null default 'email' check (channel in ('email', 'text', 'phone', 'in-person', 'other')),
  last_message text,
  gmail_thread_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_conversations_client on conversations(client_id);
create index idx_conversations_updated on conversations(updated_at desc);
create index idx_conversations_gmail on conversations(gmail_thread_id);

-- ══════════════════════════════════════════
-- MESSAGES
-- ══════════════════════════════════════════
create table messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references conversations(id) on delete cascade,
  content text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text,
  channel text,
  gmail_message_id text,
  twilio_sid text,
  metadata jsonb default '{}',
  timestamp timestamptz default now()
);

create index idx_messages_conversation on messages(conversation_id);
create index idx_messages_timestamp on messages(timestamp);

-- ══════════════════════════════════════════
-- JOBS
-- ══════════════════════════════════════════
create table jobs (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade,
  client_name text,
  title text not null,
  description text,
  date date not null,
  start_time time,
  end_time time,
  status text not null default 'scheduled' check (status in ('scheduled', 'in-progress', 'completed', 'cancelled')),
  assignee text,
  notes text,
  -- Recurrence fields
  is_recurring boolean default false,
  recurrence_rule text, -- 'weekly', 'biweekly', 'monthly'
  recurrence_day integer, -- 0=Sun, 1=Mon, etc.
  recurrence_parent_id uuid references jobs(id) on delete set null,
  -- Pricing
  price decimal(10,2),
  price_type text check (price_type in ('flat', 'hourly', 'per_sqft')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_jobs_client on jobs(client_id);
create index idx_jobs_date on jobs(date);
create index idx_jobs_status on jobs(status);
create index idx_jobs_recurring on jobs(is_recurring) where is_recurring = true;

-- ══════════════════════════════════════════
-- INVOICES
-- ══════════════════════════════════════════
create table invoices (
  id uuid primary key default uuid_generate_v4(),
  invoice_number text unique not null,
  client_id uuid references clients(id) on delete cascade,
  client_name text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
  issue_date date not null default current_date,
  due_date date,
  subtotal decimal(10,2) default 0,
  tax_rate decimal(5,4) default 0,
  tax_amount decimal(10,2) default 0,
  total decimal(10,2) default 0,
  notes text,
  payment_method text,
  paid_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_invoices_client on invoices(client_id);
create index idx_invoices_status on invoices(status);
create index idx_invoices_number on invoices(invoice_number);

-- ══════════════════════════════════════════
-- INVOICE LINE ITEMS
-- ══════════════════════════════════════════
create table invoice_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid references invoices(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  description text not null,
  quantity decimal(10,2) default 1,
  unit_price decimal(10,2) not null,
  total decimal(10,2) not null,
  created_at timestamptz default now()
);

create index idx_invoice_items_invoice on invoice_items(invoice_id);

-- ══════════════════════════════════════════
-- PAYROLL EXPORTS
-- ══════════════════════════════════════════
create table payroll_exports (
  id uuid primary key default uuid_generate_v4(),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'exported', 'submitted')),
  data jsonb not null default '{}',
  total_hours decimal(10,2),
  total_pay decimal(10,2),
  total_mileage_reimbursement decimal(10,2),
  exported_at timestamptz,
  created_at timestamptz default now()
);

-- ══════════════════════════════════════════
-- AUTO-UPDATE timestamps
-- ══════════════════════════════════════════
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger clients_updated_at before update on clients for each row execute function update_updated_at();
create trigger conversations_updated_at before update on conversations for each row execute function update_updated_at();
create trigger jobs_updated_at before update on jobs for each row execute function update_updated_at();
create trigger invoices_updated_at before update on invoices for each row execute function update_updated_at();

-- ══════════════════════════════════════════
-- ROW LEVEL SECURITY (optional, enable if you add auth)
-- ══════════════════════════════════════════
-- alter table clients enable row level security;
-- alter table conversations enable row level security;
-- alter table messages enable row level security;
-- alter table jobs enable row level security;
-- alter table invoices enable row level security;
-- alter table invoice_items enable row level security;
-- alter table payroll_exports enable row level security;
