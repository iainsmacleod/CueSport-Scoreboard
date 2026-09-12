-- Admin support trial end timestamp on accounts (Stripe trials use subscription_status=trialing).

alter table accounts
  add column if not exists trial_ends_at timestamptz;
