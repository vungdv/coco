-- spec v2 step 2: one open order per customer per day (D2), adjustments as signed lines (reduce/set/cancel).

-- Merge a customer's open orders for a day into the oldest one, so the unique index below can hold.
-- Lines keep their quantities, so each customer's total is unchanged.
create temp table merge_map on commit drop as
select id, first_value(id) over (partition by delivery_date, customer_id order by created_at, id) as keep_id
from public.orders where not delivered;
delete from merge_map where id = keep_id;

alter table public.order_lines disable trigger order_lines_no_update; -- one-off re-parenting, not a content change
update public.order_lines l set order_id = m.keep_id from merge_map m where l.order_id = m.id;
alter table public.order_lines enable trigger order_lines_no_update;
delete from public.orders o using merge_map m where o.id = m.id;

-- D2: at most one open order per customer per day. Un-ticking an older order while a newer one is open fails (V14).
create unique index orders_one_open_idx on public.orders (delivery_date, customer_id) where not delivered;

drop function public.place_order_line(text, int, date, text, text, text, timestamptz);

-- Returns {status, order, line}; status = created | replayed | conflict | no_open_order.
create function public.place_order_line(
  p_delivery_date date,
  p_op text default 'add',
  p_quantity int default null,       -- add/reduce: > 0, set: >= 0, cancel: null
  p_customer_name text default null, -- required for add
  p_customer_id text default null,   -- D1: caller's id (e.g. Zalo user id); defaults to the normalised name
  p_source text default 'api',
  p_external_id text default null,
  p_message text default '',
  p_placed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_customer_id text := coalesce(nullif(trim(p_customer_id), ''), lower(nullif(trim(p_customer_name), '')));
  v_line order_lines;
  v_order orders;
  v_sum int;
  v_delta int;
begin
  if v_customer_id is null then raise exception 'customer_id or customer_name is required' using errcode = '22023'; end if;
  if p_op = 'add' and nullif(trim(p_customer_name), '') is null then
    raise exception 'customer_name is required for add' using errcode = '22023'; end if;
  if not coalesce(p_op in ('add', 'reduce') and p_quantity > 0 or p_op = 'set' and p_quantity >= 0
          or p_op = 'cancel' and p_quantity is null, false) then
    raise exception 'invalid op/quantity: % %', p_op, p_quantity using errcode = '22023'; end if;

  -- Serialise one customer-day (V12) and one idempotency key.
  perform pg_advisory_xact_lock(hashtext(v_customer_id || '|' || p_delivery_date));
  if p_external_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_source || '|' || p_external_id));
    select * into v_line from order_lines where source = p_source and external_id = p_external_id;
    if found then -- D4
      select * into v_order from orders where id = v_line.order_id;
      return jsonb_build_object(
        'status', case when v_line.op = p_op and v_line.requested_quantity is not distinct from p_quantity
          and v_line.message = coalesce(p_message, '') and v_order.delivery_date = p_delivery_date
          and v_order.customer_id = v_customer_id and (p_placed_at is null or v_line.placed_at = p_placed_at)
          then 'replayed' else 'conflict' end,
        'order', order_json(v_order.id), 'line', to_jsonb(v_line));
    end if;
  end if;

  select * into v_order from orders
  where customer_id = v_customer_id and delivery_date = p_delivery_date and not delivered;
  if not found then
    if p_op <> 'add' then -- D6: nothing open to adjust
      return jsonb_build_object('status', 'no_open_order', 'order', null, 'line', null);
    end if;
    insert into orders (customer_id, customer_name, delivery_date) -- D2: also after a delivered order (V8)
    values (v_customer_id, trim(p_customer_name), p_delivery_date) returning * into v_order;
  elsif nullif(trim(p_customer_name), '') is not null and v_order.customer_name <> trim(p_customer_name) then
    update orders set customer_name = trim(p_customer_name) where id = v_order.id; -- latest name seen
  end if;

  select coalesce(sum(quantity), 0) into v_sum from order_lines where order_id = v_order.id;
  v_delta := case p_op
    when 'add' then p_quantity
    when 'reduce' then -least(p_quantity, v_sum) -- D5: clamp at 0
    when 'set' then p_quantity - v_sum
    when 'cancel' then -v_sum
  end;

  insert into order_lines (order_id, source, external_id, op, requested_quantity, quantity, message, placed_at)
  values (v_order.id, p_source, p_external_id, p_op, p_quantity, v_delta, coalesce(p_message, ''),
          coalesce(p_placed_at, now()))
  returning * into v_line;
  return jsonb_build_object('status', 'created', 'order', order_json(v_order.id), 'line', to_jsonb(v_line));
end $$;
revoke all on function public.place_order_line(date, text, int, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.place_order_line(date, text, int, text, text, text, text, text, timestamptz) to service_role;
