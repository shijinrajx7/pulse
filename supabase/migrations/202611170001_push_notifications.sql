-- PULSE zero-cost Web Push storage. No paid provider and no browser-readable secrets.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint_hash text unique,
  endpoint text not null,
  subscription jsonb not null,
  owner_token_hash text,
  preferences jsonb not null default '{"priorities":{"breaking":true,"important":true,"general":true,"low":false},"categories":[],"silentLow":true,"sounds":{"breaking":true,"important":true,"general":true}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled_at timestamptz
);

alter table public.push_subscriptions
  add column if not exists endpoint_hash text,
  add column if not exists endpoint text,
  add column if not exists subscription jsonb,
  add column if not exists owner_token_hash text,
  add column if not exists preferences jsonb not null default '{"priorities":{"breaking":true,"important":true,"general":true,"low":false},"categories":[],"silentLow":true,"sounds":{"breaking":true,"important":true,"general":true}}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz,
  add column if not exists disabled_at timestamptz;

-- Backfill hashes for any legacy rows without changing their subscription payload.
update public.push_subscriptions
set endpoint_hash = encode(extensions.digest(convert_to(endpoint, 'UTF8'), 'sha256'), 'hex')
where endpoint_hash is null and endpoint is not null;

-- Legacy rows from the earlier prototype had no ownership token. Keep their
-- records for auditability but do not send to them until the browser re-registers.
update public.push_subscriptions
set disabled_at = now()
where owner_token_hash is null and disabled_at is null;

create unique index if not exists push_subscriptions_endpoint_hash_uidx on public.push_subscriptions(endpoint_hash);
create index if not exists push_subscriptions_active_idx on public.push_subscriptions(disabled_at) where disabled_at is null;

create table if not exists public.push_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  subscription_id bigint not null references public.push_subscriptions(id) on delete cascade,
  priority text not null check (priority in ('breaking','important','general','low')),
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  clicked_at timestamptz,
  unique(event_id, subscription_id)
);

create index if not exists push_deliveries_sub_created_idx on public.push_deliveries(subscription_id, created_at desc);
create index if not exists push_deliveries_status_idx on public.push_deliveries(status, created_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.push_deliveries from anon, authenticated;
grant all on public.push_subscriptions to service_role;
grant all on public.push_deliveries to service_role;
