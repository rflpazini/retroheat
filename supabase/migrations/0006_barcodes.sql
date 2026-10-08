-- RetroHeat: which box a copy came from, and barcodes taught by hand.
--
-- Apply after 0005, and before deploying the site version that scans: until
-- then the new site still adds scanned copies, just without their edition and
-- barcode, and a barcode paired by hand is not remembered. Limits mirror
-- web/src/lib/shelf.ts and web/src/lib/barcode.ts.

-- The edition is the catalog's variant (internal/catalog/catalog.go) without
-- "none", which is null here. The barcode is the one scanned off the box,
-- always as 13 digits: a 12-digit UPC-A gains a leading zero, as EAN-13 reads
-- it. Neither is shown on a shared shelf: the shelves view in 0005 names its
-- columns, and these are not among them.
alter table public.collection_items
  add column edition text check (edition in ('black-label', 'greatest-hits', 'players-choice', 'platinum')),
  add column barcode text check (barcode ~ '^[0-9]{13}$');

-- A barcode the site did not know, paired with a game by the person holding
-- the box. Each person sees only their own pairings, so their next scan of
-- the same box works on any device; nobody else's scan trusts them until the
-- catalog's owner has checked them (cmd/barcodes -reports, with the service
-- role) and written them into the catalog.
create table public.barcode_reports (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  code       text        not null check (code ~ '^[0-9]{13}$'),
  game_id    text        not null check (game_id ~ '^[a-z0-9][a-z0-9-]*$' and length(game_id) <= 120),
  created_at timestamptz not null default now(),
  -- One answer per person per barcode; pairing it again replaces the answer.
  primary key (user_id, code)
);

alter table public.barcode_reports enable row level security;

create policy "barcodes: select own" on public.barcode_reports
  for select using (auth.uid() = user_id);
create policy "barcodes: insert own" on public.barcode_reports
  for insert with check (auth.uid() = user_id);
create policy "barcodes: update own" on public.barcode_reports
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "barcodes: delete own" on public.barcode_reports
  for delete using (auth.uid() = user_id);

-- A ceiling per person, as on the shelf (0001), so a script cannot fill the
-- table. Far above what one collection needs: a pairing is only made for a
-- barcode the catalog does not know yet.
create function public.enforce_barcode_report_cap() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  select count(*) into n from public.barcode_reports where user_id = new.user_id;
  if n >= 2000 then
    raise exception 'barcode limit reached (2000 pairings)';
  end if;
  return new;
end;
$$;

create trigger barcode_report_cap before insert on public.barcode_reports
  for each row execute function public.enforce_barcode_report_cap();
