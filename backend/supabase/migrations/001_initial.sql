-- CueSport Cloud schema (Supabase-compatible)

create extension if not exists "pgcrypto";

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null,
  stripe_customer_id text,
  subscription_status text not null default 'active',
  subscription_tier text not null default 'pro',
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  key_hash text not null,
  label text not null default 'Default',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_api_keys_account on api_keys(account_id);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  label text not null default 'Default Room',
  created_at timestamptz not null default now()
);

create index if not exists idx_rooms_account on rooms(account_id);

create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  session_id uuid,
  event_type text not null,
  payload jsonb not null default '{}',
  source_client text,
  created_at timestamptz not null default now()
);

create index if not exists idx_match_events_room on match_events(room_id, created_at desc);
create index if not exists idx_match_events_session on match_events(session_id);

create table if not exists live_streams (
  room_id uuid primary key references rooms(id) on delete cascade,
  stream_url text,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists room_sessions (
  room_id uuid primary key references rooms(id) on delete cascade,
  session_id uuid,
  state jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Trigger: create account profile on Supabase auth signup (run in Supabase SQL editor)
-- create or replace function public.handle_new_user()
-- returns trigger as $$
-- begin
--   insert into public.accounts (auth_user_id, email)
--   values (new.id, new.email);
--   return new;
-- end;
-- $$ language plpgsql security definer;
