-- Session invalidation + default starter tier (Supabase)

alter table accounts
  add column if not exists sessions_invalid_after timestamptz;

alter table accounts
  add column if not exists session_epoch integer not null default 1;

alter table accounts
  alter column subscription_tier set default 'starter';
