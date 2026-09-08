-- Session invalidation + starter tier defaults (Supabase)
-- Idempotent for DBs that already applied an older 001 without these columns.

alter table accounts
  add column if not exists sessions_invalid_after timestamptz;

alter table accounts
  add column if not exists session_epoch integer not null default 1;

alter table accounts
  alter column subscription_tier set default 'starter';

-- Older 001 lacked account-scoped match_events. Prefer re-running fixed 001 on
-- empty/dev projects. If match_events exists without account_id, drop and recreate
-- (no production data expected yet).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'match_events'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'match_events' and column_name = 'account_id'
  ) then
    drop table if exists match_events cascade;
    create table match_events (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts(id) on delete cascade,
      room_id uuid references rooms(id) on delete set null,
      session_id uuid,
      event_type text not null,
      payload jsonb not null default '{}',
      source_client text,
      created_at timestamptz not null default now()
    );
    create index if not exists idx_match_events_account on match_events(account_id, created_at desc);
    create index if not exists idx_match_events_room on match_events(room_id, created_at desc);
    create index if not exists idx_match_events_session on match_events(session_id);
  end if;
end $$;
