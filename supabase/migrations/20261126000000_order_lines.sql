-- spec v2 step 1: move quantity/message/timing into an immutable ledger of order lines.
-- No feature change: every v1 order becomes one order with exactly one 'add' line (V18).

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  source text not null default 'manual',
  external_id text,
  op text not null default 'add' check (op in ('add', 'reduce', 'set', 'cancel')),
  requested_quantity int check (requested_quantity >= 0), -- what the caller asked for; null for cancel
  quantity int not null,                                   -- signed effective delta; order total = sum
  message text not null default '' check (length(message) <= 2000),
  placed_at timestamptz not null default now(),            -- message time
  created_at timestamptz not null default now(),
  unique (source, external_id),                            -- idempotency key (D4); NULLs never collide
  check (op <> 'add' or quantity > 0)
);
create index order_lines_order_idx on public.order_lines (order_id, placed_at);

insert into public.order_lines (order_id, source, external_id, op, requested_quantity, quantity, message, placed_at, created_at)
select id, source, external_id, 'add', quantity, quantity, message, placed_at, created_at from public.orders;

-- D1: customer identity. v1 rows only have a name, so it becomes their id.
alter table public.orders add column customer_id text;
update public.orders set customer_id = lower(trim(customer_name));
alter table public.orders alter column customer_id set not null;

alter table public.orders
  drop column source, drop column external_id, drop column quantity, drop column message, drop column placed_at;
create index orders_day_idx on public.orders (delivery_date, delivered);

-- Expand/contract: web clients deployed before spec v2 still select quantity, message and placed_at on
-- orders (and order by placed_at). PostgREST serves these functions as computed fields, so those clients
-- keep working during and after the rollout. Drop them in a later migration once no v1 client remains.
create function public.quantity(public.orders) returns int language sql stable as $$
  select coalesce(sum(l.quantity), 0)::int from public.order_lines l where l.order_id = $1.id
$$;
create function public.message(public.orders) returns text language sql stable as $$
  select coalesce(string_agg(l.message, E'\n' order by l.placed_at) filter (where l.message <> ''), '')
  from public.order_lines l where l.order_id = $1.id
$$;
create function public.placed_at(public.orders) returns timestamptz language sql stable as $$
  select coalesce(min(l.placed_at), $1.created_at) from public.order_lines l where l.order_id = $1.id
$$;

-- D3: lines are append-only, for every role (V13).
create function public.order_lines_immutable() returns trigger language plpgsql as $$
begin raise exception 'order_lines are immutable' using errcode = '55000'; end $$;
create trigger order_lines_no_update before update on public.order_lines
  for each row execute function public.order_lines_immutable();

-- A new line bumps its order, so Realtime on orders (filtered by delivery_date) fires (V17).
create function public.touch_order() returns trigger language plpgsql as $$
begin update public.orders set updated_at = now() where id = new.order_id; return new; end $$;
create trigger order_lines_touch_order after insert on public.order_lines
  for each row execute function public.touch_order();

alter table public.order_lines enable row level security;
create policy staff_select on public.order_lines for select to authenticated using (public.is_staff());
grant select on public.order_lines to anon, authenticated; -- RLS: anon/non-staff see zero rows
grant select, insert, delete on public.order_lines to service_role;

-- Order JSON as the API returns it: v1 order fields, quantity = order total.
create function public.order_json(p_id uuid) returns jsonb language sql stable set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object('quantity',
    (select coalesce(sum(l.quantity), 0) from order_lines l where l.order_id = o.id))
  from orders o where o.id = p_id
$$;
revoke all on function public.order_json(uuid) from public, anon, authenticated;

-- The only write path for orders from integrations (Edge Function, service role).
-- Step 1: 'add' only, one new order per line (v1 behaviour). Returns {status, order, line}
-- with status created | replayed | conflict (D4).
create function public.place_order_line(
  p_customer_name text,
  p_quantity int,
  p_delivery_date date,
  p_source text default 'api',
  p_external_id text default null,
  p_message text default '',
  p_placed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer_id text := lower(trim(p_customer_name));
  v_line order_lines;
  v_order orders;
  v_status text := 'created';
begin
  -- Serialise writes for one customer-day and one idempotency key.
  perform pg_advisory_xact_lock(hashtext(v_customer_id || '|' || p_delivery_date));
  if p_external_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_source || '|' || p_external_id));
    select * into v_line from order_lines where source = p_source and external_id = p_external_id;
    if found then
      select * into v_order from orders where id = v_line.order_id;
      v_status := case when v_line.op = 'add' and v_line.requested_quantity = p_quantity
        and v_line.message = coalesce(p_message, '') and v_order.delivery_date = p_delivery_date
        and v_order.customer_id = v_customer_id and (p_placed_at is null or v_line.placed_at = p_placed_at)
        then 'replayed' else 'conflict' end;
      return jsonb_build_object('status', v_status, 'order', order_json(v_order.id), 'line', to_jsonb(v_line));
    end if;
  end if;

  insert into orders (customer_id, customer_name, delivery_date)
  values (v_customer_id, trim(p_customer_name), p_delivery_date) returning * into v_order;
  insert into order_lines (order_id, source, external_id, op, requested_quantity, quantity, message, placed_at)
  values (v_order.id, p_source, p_external_id, 'add', p_quantity, p_quantity, coalesce(p_message, ''),
          coalesce(p_placed_at, now()))
  returning * into v_line;
  return jsonb_build_object('status', v_status, 'order', order_json(v_order.id), 'line', to_jsonb(v_line));
end $$;
revoke all on function public.place_order_line(text, int, date, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.place_order_line(text, int, date, text, text, text, timestamptz) to service_role;
