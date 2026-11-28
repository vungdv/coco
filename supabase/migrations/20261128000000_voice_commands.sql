-- spec v3 step 1: the delete op (E8) and voice commands (E2, E3). Additive: the v2 web and API callers keep working.

-- E8: a deleted order is hidden, its lines are kept. The v2 web (no deleted_at filter yet) shows it as cancelled,
-- because the delete line brings its total to 0.
alter table public.orders add column deleted_at timestamptz, add column deleted_by text;

-- D2 now ignores deleted orders, so a customer can get a new order after a delete (W5).
drop index public.orders_one_open_idx;
create unique index orders_one_open_idx on public.orders (delivery_date, customer_id)
  where not delivered and deleted_at is null;

alter table public.order_lines drop constraint order_lines_op_check;
alter table public.order_lines add constraint order_lines_op_check
  check (op in ('add', 'reduce', 'set', 'cancel', 'delete'));

-- Same signature as v2, so the grants stay. Changes: 'delete', and deleted orders are never "open".
create or replace function public.place_order_line(
  p_delivery_date date,
  p_op text default 'add',
  p_quantity int default null,       -- add/reduce: > 0, set: >= 0, cancel/delete: null
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
          or p_op in ('cancel', 'delete') and p_quantity is null, false) then
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
  where customer_id = v_customer_id and delivery_date = p_delivery_date and not delivered and deleted_at is null;
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
    else -v_sum                                  -- cancel, delete
  end;

  insert into order_lines (order_id, source, external_id, op, requested_quantity, quantity, message, placed_at)
  values (v_order.id, p_source, p_external_id, p_op, p_quantity, v_delta, coalesce(p_message, ''),
          coalesce(p_placed_at, now()))
  returning * into v_line;
  if p_op = 'delete' then -- E8: hidden from the list and counts; the lines stay (D3)
    update orders set deleted_at = now(), deleted_by = p_source where id = v_order.id;
  end if;
  return jsonb_build_object('status', 'created', 'order', order_json(v_order.id), 'line', to_jsonb(v_line));
end $$;

-- E2: a chef's spoken command, waiting for the Assistant.
create table public.voice_commands (
  id uuid primary key default gen_random_uuid(),                  -- also the order line's external_id (E5)
  transcript text not null check (length(trim(transcript)) between 1 and 500),
  delivery_date date not null,                                    -- E4: the date on screen
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'failed', 'dismissed')),
  claimed_at timestamptz,
  result jsonb,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index voice_commands_claim_idx on public.voice_commands (created_at) where status in ('queued', 'processing');
create trigger voice_commands_updated_at before update on public.voice_commands
  for each row execute function public.set_updated_at();

-- W15: staff insert commands and read their own; the only change they can make is dismissing a queued one (E10).
-- Column grants keep status, result and claimed_at out of reach of the browser.
alter table public.voice_commands enable row level security;
create policy staff_insert on public.voice_commands for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy staff_select_own on public.voice_commands for select to authenticated
  using (public.is_staff() and created_by = auth.uid());
create policy staff_dismiss on public.voice_commands for update to authenticated
  using (public.is_staff() and created_by = auth.uid() and status = 'queued')
  with check (status = 'dismissed');
revoke all on public.voice_commands from anon, authenticated; -- default privileges would grant every column
grant select on public.voice_commands to authenticated;
grant insert (transcript, delivery_date) on public.voice_commands to authenticated;
grant update (status) on public.voice_commands to authenticated;
grant all on public.voice_commands to service_role;
alter publication supabase_realtime add table public.voice_commands;

-- Voice Command API (Edge Function, service role). Claim the oldest queued command, or one whose claim is
-- older than 2 minutes (W14). `skip locked` hands each command to one caller only (W13).
-- Returns {command, orders} or null when there is nothing to do.
create function public.claim_voice_command() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v voice_commands;
begin
  update voice_commands set status = 'processing', claimed_at = now()
  where id = (
    select id from voice_commands
    where status = 'queued' or (status = 'processing' and claimed_at < now() - interval '2 minutes')
    order by created_at, id limit 1 for update skip locked)
  returning * into v;
  if not found then return null; end if;
  return jsonb_build_object(
    'command', jsonb_build_object('id', v.id, 'transcript', v.transcript, 'delivery_date', v.delivery_date,
      'created_at', v.created_at),
    -- the context for name matching (E7): that day's orders that are not deleted
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('customer_id', o.customer_id, 'customer_name', o.customer_name,
        'quantity', (select coalesce(sum(l.quantity), 0) from order_lines l where l.order_id = o.id),
        'delivered', o.delivered) order by o.created_at)
      from orders o where o.delivery_date = v.delivery_date and o.deleted_at is null), '[]'::jsonb));
end $$;

-- Record the outcome of a claimed command. Returns the command, or null when it is not processing (→ 409).
create function public.finish_voice_command(p_id uuid, p_status text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v voice_commands;
begin
  if p_status not in ('done', 'failed') then
    raise exception 'status must be done or failed' using errcode = '22023'; end if;
  update voice_commands set status = p_status, result = p_result
  where id = p_id and status = 'processing' returning * into v;
  if not found then return null; end if;
  return to_jsonb(v) - 'created_by';
end $$;

revoke all on function public.claim_voice_command() from public, anon, authenticated;
revoke all on function public.finish_voice_command(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.claim_voice_command() to service_role;
grant execute on function public.finish_voice_command(uuid, text, jsonb) to service_role;
