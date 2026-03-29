-- PixelFront account stats + global leaderboard
-- Run this in Supabase SQL Editor.

create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Player',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_game_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Player',
  outcome text not null default 'abandon',
  did_win boolean not null default false,
  playtime_seconds integer not null default 0,
  match_mode text not null default 'singleplayer',
  played_at timestamptz not null default now()
);

create index if not exists idx_player_game_sessions_user_id
  on public.player_game_sessions(user_id);

create index if not exists idx_player_game_sessions_played_at
  on public.player_game_sessions(played_at desc);

-- Clamp legacy outliers caused by stale local sessions being recovered with wall-clock time.
update public.player_game_sessions
set playtime_seconds = least(greatest(playtime_seconds, 0), 43200)
where playtime_seconds < 0
   or playtime_seconds > 43200;

alter table public.player_game_sessions
  drop constraint if exists player_game_sessions_playtime_seconds_reasonable;

alter table public.player_game_sessions
  add constraint player_game_sessions_playtime_seconds_reasonable
  check (playtime_seconds >= 0 and playtime_seconds <= 43200);

alter table public.player_profiles enable row level security;
alter table public.player_game_sessions enable row level security;

drop policy if exists "profile_select_authenticated" on public.player_profiles;
create policy "profile_select_authenticated"
on public.player_profiles
for select
to authenticated
using (true);

drop policy if exists "profile_insert_own" on public.player_profiles;
create policy "profile_insert_own"
on public.player_profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "profile_update_own" on public.player_profiles;
create policy "profile_update_own"
on public.player_profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "sessions_select_authenticated" on public.player_game_sessions;
create policy "sessions_select_authenticated"
on public.player_game_sessions
for select
to authenticated
using (true);

drop policy if exists "sessions_insert_own" on public.player_game_sessions;
create policy "sessions_insert_own"
on public.player_game_sessions
for insert
to authenticated
with check (auth.uid() = user_id);

drop view if exists public.player_leaderboard;
create view public.player_leaderboard as
with session_totals as (
  select
    s.user_id,
    count(*)::integer as games_played,
    count(*) filter (where s.did_win)::integer as wins,
    coalesce(sum(least(greatest(s.playtime_seconds, 0), 43200)), 0)::integer as playtime_seconds
  from public.player_game_sessions s
  group by s.user_id
)
select
  t.user_id,
  coalesce(
    nullif(trim(p.display_name), ''),
    nullif(trim(latest.display_name), ''),
    'Player'
  ) as display_name,
  t.games_played,
  t.wins,
  t.playtime_seconds
from session_totals t
left join public.player_profiles p
  on p.user_id = t.user_id
left join lateral (
  select s.display_name
  from public.player_game_sessions s
  where s.user_id = t.user_id
  order by s.played_at desc, s.id desc
  limit 1
) latest on true
where t.games_played > 0;

grant select on public.player_leaderboard to anon, authenticated;
