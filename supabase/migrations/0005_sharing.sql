-- RetroHeat: a shelf shared by link, and how many shelves a game sits on.
--
-- Apply after 0004. Sharing is off for everyone until they turn it on; the
-- collector's counts name no one and are published only from three people up.

create table public.profiles (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  -- The name in the link: lowercase, digits and hyphens, 3 to 32 characters,
  -- never a word the site's own routes use.
  slug       text not null unique
             check (slug ~ '^[a-z0-9][a-z0-9-]{2,31}$'
                    and slug not in ('about', 'saved', 'collection', 'p', 'g', 'u', 'r', 'data', 'assets', 'icons')),
  is_public  boolean not null default false,
  share_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles: select own" on public.profiles for select using (auth.uid() = user_id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = user_id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profiles: delete own" on public.profiles for delete using (auth.uid() = user_id);

-- Runs with the view owner's rights on purpose (security_invoker off): an
-- anonymous reader gets exactly these columns for people who chose to be
-- public. Notes never leave, sold copies never show, the paid price only
-- when its owner ticked "Include what I paid". Supabase's linter flags a
-- security-definer view in public; here that is the point of the view.
create view public.shelves with (security_invoker = false, security_barrier = true) as
  select p.slug, c.game_id, c.condition, c.added_at,
         case when p.share_paid then c.paid_cents end as paid_cents
    from public.collection_items c
    join public.profiles p on p.user_id = c.user_id
   where p.is_public and c.sold_on is null;

-- So a link can tell an empty shelf from one that does not exist or went private.
create view public.public_profiles with (security_invoker = false, security_barrier = true) as
  select slug from public.profiles where is_public;

grant select on public.shelves, public.public_profiles to anon, authenticated;

-- The demand signal for the collector: distinct people per game, private
-- shelves included, no one named. Only the service role reads it, and the
-- collector publishes a figure only from three people up
-- (internal/snapshot MinShelfCount), so a count never points at one person.
create view public.shelf_counts with (security_invoker = false) as
  select game_id,
         count(distinct user_id) filter (where kind = 'owned') as owned,
         count(distinct user_id) filter (where kind = 'saved') as saved
    from (select user_id, game_id, 'owned' as kind from public.collection_items where sold_on is null
          union all
          select user_id, game_id, 'saved' from public.saved_games) s
   group by game_id;
revoke all on public.shelf_counts from anon, authenticated;
