-- RetroHeat: a second copy of the price history.
--
-- Git holds the first copy of every point the collector writes; this table
-- holds the same points so the history survives anything that happens to the
-- repository, and so a timeline can be queried per game. The collector writes
-- it with the service role key after each run (cmd/collector), cmd/mirror
-- backfills or restores it, and the anon key may only read.

create table public.price_points (
  game_id    text        not null check (game_id ~ '^[a-z0-9][a-z0-9-]*$' and length(game_id) <= 120),
  d          date        not null,
  r          text        not null check (r in ('d', 'w')),
  loose_cents integer,
  cib_cents   integer,
  new_cents   integer,
  nl         integer     not null default 0,
  nc         integer     not null default 0,
  nn         integer     not null default 0,
  -- classify.SeriesVersion that produced the point; 0 = before versioning.
  v          integer     not null default 0,
  -- When the row first appeared in the copy. Upserts do not touch it.
  created_at timestamptz not null default now(),
  primary key (game_id, d)
);
create index price_points_by_day on public.price_points (d);

create table public.collector_runs (
  generated_at   timestamptz not null primary key,
  source         text        not null,
  series_version integer     not null,
  tracked        integer     not null,
  ok             integer     not null,
  stale          integer     not null,
  failed         integer     not null,
  api_calls      integer     not null
);

alter table public.price_points   enable row level security;
alter table public.collector_runs enable row level security;

-- Anyone may read; nobody but the service role (which bypasses RLS) may write.
-- The revokes are belt and braces: without a write policy RLS already refuses,
-- but a future policy added by mistake should still find no grant to lean on.
create policy "prices: public read" on public.price_points   for select using (true);
create policy "runs: public read"   on public.collector_runs for select using (true);
revoke insert, update, delete on public.price_points   from anon, authenticated;
revoke insert, update, delete on public.collector_runs from anon, authenticated;
