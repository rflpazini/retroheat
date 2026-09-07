-- RetroHeat: saved games and collections.
--
-- Apply once in the Supabase SQL editor (or with `supabase db push`). The
-- browser talks to these tables directly with the public anon key; row-level
-- security below is what keeps one person's shelf invisible to another.
-- game_id follows the catalog's id rule (internal/catalog/catalog.go), so the
-- database cannot hold an id the site would never resolve.

create table public.saved_games (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    text        not null check (game_id ~ '^[a-z0-9][a-z0-9-]*$' and length(game_id) <= 120),
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

create table public.collection_items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  game_id    text        not null check (game_id ~ '^[a-z0-9][a-z0-9-]*$' and length(game_id) <= 120),
  -- One copy per game, in one condition; the site's Condition type.
  condition  text        not null check (condition in ('loose', 'cib', 'new')),
  added_at   timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.saved_games      enable row level security;
alter table public.collection_items enable row level security;

create policy "saved: select own" on public.saved_games
  for select using (auth.uid() = user_id);
create policy "saved: insert own" on public.saved_games
  for insert with check (auth.uid() = user_id);
create policy "saved: update own" on public.saved_games
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saved: delete own" on public.saved_games
  for delete using (auth.uid() = user_id);

create policy "collection: select own" on public.collection_items
  for select using (auth.uid() = user_id);
create policy "collection: insert own" on public.collection_items
  for insert with check (auth.uid() = user_id);
create policy "collection: update own" on public.collection_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "collection: delete own" on public.collection_items
  for delete using (auth.uid() = user_id);

-- A ceiling per person, so a script cannot fill the free tier. Expressed as a
-- trigger rather than a policy subquery: a policy that reads its own table
-- recurses.
create function public.enforce_shelf_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into n using new.user_id;
  if n >= 5000 then
    raise exception 'shelf limit reached (5000 games)';
  end if;
  return new;
end;
$$;

create trigger saved_cap before insert on public.saved_games
  for each row execute function public.enforce_shelf_cap();
create trigger collection_cap before insert on public.collection_items
  for each row execute function public.enforce_shelf_cap();

-- Account deletion without server code: runs as the function owner, scoped to
-- the caller, and the foreign keys cascade to both tables.
create function public.delete_my_account() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
