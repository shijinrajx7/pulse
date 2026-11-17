-- PULSE zero-cost Web Push storage. Existing push_subscriptions rows are retained.
alter table public.push_subscriptions
  add column if not exists owner_token_hash text,
  add column if not exists preferences jsonb not null default '{"priorities":{"breaking":true,"important":true,"general":true,"low":false},"categories":[],"silentLow":true}'::jsonb,
  add column if not exists last_seen_at timestamptz,
  add column if not exists disabled_at timestamptz;

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
