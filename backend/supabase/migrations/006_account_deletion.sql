-- Account deletion lifecycle and privacy-safe identity retention.
-- Runtime currently uses SQLite; keep this schema aligned for future Postgres use.

alter table if exists accounts
  add column if not exists deletion_status text not null default 'active',
  add column if not exists deletion_started_at timestamptz,
  add column if not exists deletion_error text;

create table if not exists account_identity_records (
  email_fingerprint text primary key,
  auth_user_fingerprint text,
  trial_used_at timestamptz,
  deleted_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists account_identity_records
  add column if not exists auth_user_fingerprint text;

create index if not exists idx_account_identity_auth_user
  on account_identity_records(auth_user_fingerprint);
