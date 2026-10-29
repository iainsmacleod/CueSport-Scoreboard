-- Opaque public event-leaderboard share tokens (view definition only; standings stay live).

create table if not exists leaderboard_shares (
  token text primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  event_query text not null default '',
  date_from text,
  date_to text,
  created_at timestamptz not null default now()
);

create index if not exists idx_leaderboard_shares_account on leaderboard_shares(account_id);

create unique index if not exists idx_leaderboard_shares_scope
  on leaderboard_shares (account_id, event_query, coalesce(date_from, ''), coalesce(date_to, ''));
