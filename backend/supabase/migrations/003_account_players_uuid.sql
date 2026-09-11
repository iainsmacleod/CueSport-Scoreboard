-- UUID-keyed account_players (duplicate display names allowed).
-- Dev / greenfield: drops legacy name-keyed table (no backfill).

drop table if exists account_players;

create table account_players (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  name_normalized text not null,
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_account_players_account on account_players(account_id);
create index if not exists idx_account_players_name on account_players(account_id, name_normalized);
