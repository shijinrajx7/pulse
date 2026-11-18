-- PULSE story poster quota. Run once in Supabase > SQL Editor.
-- One account receives up to 10 successful poster generations per UTC day.
create table if not exists public.poster_generations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation_count integer not null default 0 check (generation_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.poster_generations enable row level security;
revoke all on public.poster_generations from anon, authenticated;
grant all on public.poster_generations to service_role;

create or replace function public.get_pulse_poster_usage(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  utc_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  insert into public.poster_generations(user_id, generation_count, updated_at)
  values (p_user_id, 0, utc_day)
  on conflict (user_id) do nothing;

  update public.poster_generations
  set generation_count = 0, updated_at = now()
  where user_id = p_user_id and updated_at < utc_day;

  select generation_count into current_count
  from public.poster_generations where user_id = p_user_id;
  return coalesce(current_count, 0);
end;
$$;

create or replace function public.reserve_pulse_poster_generation(p_user_id uuid, p_limit integer default 10)
returns table(allowed boolean, generation_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_count integer;
  utc_day timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  insert into public.poster_generations(user_id, generation_count, updated_at)
  values (p_user_id, 0, utc_day)
  on conflict (user_id) do nothing;

  update public.poster_generations as pg
  set generation_count = case
        when pg.updated_at < utc_day then 1
        else pg.generation_count + 1
      end,
      updated_at = now()
  where pg.user_id = p_user_id
    and (pg.updated_at < utc_day or pg.generation_count < greatest(1, least(p_limit, 10)))
  returning pg.generation_count into next_count;

  if next_count is not null then
    return query select true, next_count;
  else
    return query
      select false, pg.generation_count
      from public.poster_generations as pg
      where pg.user_id = p_user_id;
  end if;
end;
$$;

create or replace function public.release_pulse_poster_generation(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.poster_generations
  set generation_count = greatest(generation_count - 1, 0), updated_at = now()
  where user_id = p_user_id;
$$;

revoke all on function public.get_pulse_poster_usage(uuid) from public, anon, authenticated;
revoke all on function public.reserve_pulse_poster_generation(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_pulse_poster_generation(uuid) from public, anon, authenticated;
grant execute on function public.get_pulse_poster_usage(uuid) to service_role;
grant execute on function public.reserve_pulse_poster_generation(uuid, integer) to service_role;
grant execute on function public.release_pulse_poster_generation(uuid) to service_role;
