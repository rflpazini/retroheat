-- RetroHeat: what a copy cost, so a shelf can be read against it.
--
-- Optional, in cents of the same currency the boards quote (US dollars).
-- Nothing else changes: the row policies already scope every row to its
-- owner, and an upsert of the condition alone leaves this column as it was.

alter table public.collection_items
  add column paid_cents integer
    check (paid_cents is null or (paid_cents >= 0 and paid_cents <= 100000000));
