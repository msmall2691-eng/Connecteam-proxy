-- Migration v3: Notifications table for dashboard widget
-- Run this in Supabase SQL Editor

create table if not exists notifications (
  id uuid primary key default uuid_generate_v4(),
  type text not null default 'general',
  title text not null,
  message text,
  client_id uuid references clients(id) on delete set null,
  data jsonb default '{}',
  read boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_notifications_read on notifications(read) where read = false;
create index if not exists idx_notifications_created on notifications(created_at desc);
