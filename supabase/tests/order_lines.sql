-- spec v2 ledger. Run: supabase test db
begin;
select plan(33);

create function pg_temp.add(n text, q int, k text default null, msg text default '', cid text default null) returns jsonb language sql as
  $$ select public.place_order_line('2030-01-01', 'add', q, n, cid, 'zalo', k, msg) $$;
create function pg_temp.adj(op text, q int, k text default null, n text default 'Lan', cid text default null) returns jsonb language sql as
  $$ select public.place_order_line('2030-01-01', op, q, n, cid, 'zalo', k) $$;
create function pg_temp.total(n text default 'Lan') returns int language sql as
  $$ select coalesce(sum(l.quantity), 0)::int from public.order_lines l join public.orders o on o.id = l.order_id
     where o.delivery_date = '2030-01-01' and o.customer_key = 'name:' || lower(n) and not o.delivered $$;
create function pg_temp.orders(n text default 'Lan') returns int language sql as
  $$ select count(*)::int from public.orders where delivery_date = '2030-01-01' and customer_key = 'name:' || lower(n) $$;

-- V1
select is((pg_temp.add('Lan', 5, 'm1', 'Em 5 suất'))->>'status', 'created', 'V1: add → created');
select is(pg_temp.orders(), 1, 'V1: one order');
select is(pg_temp.total(), 5, 'V1: total 5');
select is((select customer_key from public.orders where delivery_date = '2030-01-01'), 'name:lan', 'D1: name key is trimmed and lower-cased');

-- V5
select is((pg_temp.add('Lan', 5, 'm1', 'Em 5 suất'))->>'status', 'replayed', 'V5: same key, same content → replayed');
select is((pg_temp.add('Lan', 6, 'm1', 'Em 5 suất'))->>'status', 'conflict', 'V5: same key, new quantity → conflict');
select is(pg_temp.total(), 5, 'V5: replay and conflict change nothing');

-- V2
select is((pg_temp.add(' lan ', 2, 'm2'))->'order'->>'quantity', '7', 'V2: second add → same order, response total 7');
select is(pg_temp.orders(), 1, 'V2: still one order');

-- V3, V6, V4
select is((pg_temp.adj('reduce', 3, 'm3'))->'line'->>'quantity', '-3', 'V3: reduce 3 → -3 line');
select is(pg_temp.total(), 4, 'V3: total 4');
select is((pg_temp.adj('set', 10))->'line'->>'quantity', '6', 'V6: set 10 at 4 → +6');
select is((pg_temp.adj('set', 3))->'line'->>'quantity', '-7', 'V6: set 3 at 10 → -7');
select is((pg_temp.adj('set', 3))->'line'->>'quantity', '0', 'V6: set 3 at 3 → recorded 0 line');
select is((pg_temp.adj('reduce', 10))->'line'->>'quantity', '-3', 'V4: reduce 10 at 3 → clamped to -3');
select is((select quantity from public.order_lines where op = 'reduce' and requested_quantity = 10), -3, 'V4: requested 10 kept beside the effective -3');
select is(pg_temp.total(), 0, 'V4: total 0 (cancelled)');

-- V10
select is((pg_temp.add('Lan', 3))->'order'->>'quantity', '3', 'V10: add after cancel → same order total 3');
select is(pg_temp.orders(), 1, 'V10: still one order');

-- V7
select is((pg_temp.adj('cancel', null))->'line'->>'quantity', '-3', 'V7: cancel → -total line');
select is(pg_temp.total(), 0, 'V7: total 0');

-- V8: add after delivery starts a new order
update public.orders set delivered = true where customer_key = 'name:lan';
select is((pg_temp.add('Lan', 2))->'order'->>'quantity', '2', 'V8: add after delivery → new order of 2');
select is(pg_temp.orders(), 2, 'V8: two orders, delivered one kept');

-- V14: un-ticking the older order while a newer one is open fails
select throws_ok($$update public.orders set delivered = false where customer_key = 'name:lan' and delivered$$, '23505', null,
  'V14: only one open order per customer-day');

-- V9: adjust with no open order
select is((public.place_order_line('2030-01-01', 'reduce', 1, 'Nobody'))->>'status', 'no_open_order', 'V9: reduce with nothing open → no_open_order');
update public.orders set delivered = true where customer_key = 'name:lan' and not delivered;
select is((pg_temp.adj('cancel', null, 'm9'))->>'status', 'no_open_order', 'V9: cancel after delivery → no_open_order');
select is((select count(*)::int from public.order_lines where external_id = 'm9'), 0, 'V9: nothing stored');

-- V11: customer_id separates same-named customers
select pg_temp.add('Hoa', 1, null, '', 'zalo:1');
select pg_temp.add('Hoa', 1, null, '', 'zalo:2');
select is((select count(*)::int from public.orders where customer_name = 'Hoa'), 2, 'V11: same name, different customer_id → two orders');
select is((public.place_order_line('2030-01-01', 'reduce', 1, null, 'zalo:1'))->'order'->>'quantity', '0', 'V11: adjust by customer_id alone');

-- Validation, V13, access
select throws_ok($$select public.place_order_line('2030-01-01', 'reduce', null, 'Lan')$$, '22023', null, 'reduce needs a quantity');
select throws_ok($$update public.order_lines set quantity = 99$$, '55000', 'order_lines are immutable', 'V13: update rejected');
alter table public.orders disable trigger orders_updated_at; -- let the test plant an old timestamp
update public.orders set updated_at = '2000-01-01' where customer_name = 'Hoa';
alter table public.orders enable trigger orders_updated_at;
select pg_temp.add('Hoa', 1, null, '', 'zalo:2');
select is((select count(*)::int from public.orders where customer_name = 'Hoa' and updated_at > '2000-01-01'), 1, 'V17: new line touches only its order');
set local role authenticated;
select throws_ok($$select public.place_order_line('2030-01-01', 'add', 1, 'x')$$, '42501', null, 'clients cannot call place_order_line');
reset role;

select * from finish();
rollback;
