-- RetroHeat: several copies of one game, and what each copy went through.
--
-- Apply after 0003, and before deploying the site version that reads `id`:
-- until then the new site shows the shelf read-only with a notice, and the
-- old site's "own" upsert (on user_id, game_id) fails for a few minutes.
-- A shelf row becomes one physical copy with its own key: a loose cart and a
-- sealed box of the same game are two rows. Existing rows keep their user,
-- game, condition, added_at and paid price. Limits mirror web/src/lib/shelf.ts.

alter table public.collection_items
  add column id uuid not null default gen_random_uuid();
alter table public.collection_items drop constraint collection_items_pkey;
alter table public.collection_items add primary key (id);
-- Every read is still "this person's shelf", so the old key stays as an index.
create index collection_items_by_game on public.collection_items (user_id, game_id);

alter table public.collection_items
  add column acquired_on date,
  add column notes      text    check (notes is null or char_length(notes) <= 500),
  add column sold_cents integer check (sold_cents is null or (sold_cents >= 0 and sold_cents <= 100000000)),
  add column sold_on    date,
  -- A sale has a day; the price may be forgotten.
  add constraint collection_items_sale_has_day check (sold_cents is null or sold_on is not null);

-- What a saved game would be worth buying at. Compared with the asking median
-- on each visit; nothing is sent to anyone.
alter table public.saved_games
  add column target_cents integer check (target_cents is null or (target_cents > 0 and target_cents <= 100000000));
