-- Migration v4: Customer info forms (property guides for Airbnb/rental turnovers)
-- Run this in Supabase SQL Editor

create table if not exists customer_info (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete set null,
  property_id uuid references properties(id) on delete set null,

  -- Property basics
  property_name text not null,
  address_line1 text,
  address_city text,
  address_state text default 'ME',
  address_zip text,
  property_type text default 'rental',
  bedrooms integer,
  bathrooms integer,
  sqft integer,
  max_guests integer,
  views text,

  -- Access & details
  door_code text,
  wifi_name text,
  wifi_password text,
  trash_pickup text,
  parking text,
  bed_configuration text,
  wash_linens_onsite text,
  supplies_stored text,
  linen_closet text,

  -- Linen standard (JSON array of {item, quantity})
  linen_standard jsonb default '[
    {"item": "Bed Sheets", "quantity": "2 full sets per bed"},
    {"item": "Bath Towels", "quantity": "2 per guest"},
    {"item": "Hand Towels", "quantity": "1 per bathroom"},
    {"item": "Face Cloths", "quantity": "1 per guest"},
    {"item": "Beach Towels", "quantity": "1 per guest"}
  ]'::jsonb,

  -- Scope of work (JSON object with room categories)
  scope_of_work jsonb default '{}'::jsonb,

  -- Supplies list
  supplies_list jsonb default '["Dish soap, trash bags, paper towels", "Toilet paper (2+ rolls per bath)", "Hand soap, cleaning supplies"]'::jsonb,

  -- Notes & special instructions
  special_notes text,

  -- Contact info
  client_name text,
  client_email text,
  client_phone text,
  client_alt_phone text,
  client_address text,
  preferred_contact text,

  -- Policies (JSON array of strings)
  policies jsonb default '[]'::jsonb,

  -- Seasonal info
  active_season text,

  -- Status
  status text default 'draft',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_customer_info_client on customer_info(client_id);
create index if not exists idx_customer_info_property on customer_info(property_id);
create index if not exists idx_customer_info_status on customer_info(status);
