create extension if not exists pgcrypto;

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  player_name text not null check (char_length(trim(player_name)) between 1 and 32),
  contact text not null default '' check (char_length(contact) <= 120),
  category text not null default 'general' check (category in ('general', 'bug', 'balance', 'idea', 'ui', 'other')),
  message text not null check (char_length(trim(message)) between 8 and 1200),
  build text not null default '',
  page_path text not null default '/',
  source text not null default 'main-menu',
  created_at timestamptz not null default now()
);

create index if not exists feedbacks_created_at_idx on public.feedbacks (created_at desc);

alter table public.feedbacks enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'feedbacks'
      and policyname = 'feedbacks_select_public'
  ) then
    create policy feedbacks_select_public
      on public.feedbacks
      for select
      using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'feedbacks'
      and policyname = 'feedbacks_insert_public'
  ) then
    create policy feedbacks_insert_public
      on public.feedbacks
      for insert
      with check (true);
  end if;
end
$$;
