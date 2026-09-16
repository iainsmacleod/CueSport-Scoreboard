-- Preserve when each roster identity was first added.
alter table if exists account_players
  add column if not exists created_at timestamptz;

update account_players p
set created_at = coalesce(
  (
    select min(e.created_at)
    from match_events e
    where e.account_id = p.account_id
      and e.event_type = 'session:start'
      and (
        e.payload->>'player1Id' = p.id::text
        or e.payload->>'player2Id' = p.id::text
      )
  ),
  p.last_seen_at,
  now()
)
where p.created_at is null;

alter table if exists account_players
  alter column created_at set default now();

alter table if exists account_players
  alter column created_at set not null;
