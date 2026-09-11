-- Dock key roles + match authorship (keep in sync with backend/src/db/sqlite.js).

alter table api_keys
  add column if not exists role text not null default 'trusted_operator';

alter table match_events
  add column if not exists api_key_id text;

create index if not exists idx_match_events_api_key on match_events(api_key_id);
