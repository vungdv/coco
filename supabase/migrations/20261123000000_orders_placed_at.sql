-- When the customer placed the order (e.g. the Zalo message time), as opposed to created_at (row insert time).
-- Callers that backfill or retry insert rows late, so created_at alone misstates the order time.
alter table public.orders add column placed_at timestamptz;
update public.orders set placed_at = created_at where placed_at is null;
alter table public.orders alter column placed_at set default now(), alter column placed_at set not null;

drop index public.orders_day_idx;
create index orders_day_idx on public.orders (delivery_date, delivered, placed_at);
