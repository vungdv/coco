-- spec v2 ledger (step 1). Run: supabase test db
begin;
select plan(11);

-- V1: add creates one order with one line
select is((public.place_order_line('Lan', 5, '2030-01-01', 'zalo', 'm1', 'Em 5 suất'))->>'status', 'created', 'V1: add → created');
select is((select count(*)::int from public.orders where delivery_date = '2030-01-01'), 1, 'V1: one order');
select is((select (public.order_json(id))->>'quantity' from public.orders where delivery_date = '2030-01-01'), '5', 'V1: order total = 5');
select is((select customer_key from public.orders where delivery_date = '2030-01-01'), 'name:lan', 'D1: name key is trimmed and lower-cased');

-- V5: replay with the same content is a no-op, different content is a conflict
select is((public.place_order_line('Lan', 5, '2030-01-01', 'zalo', 'm1', 'Em 5 suất'))->>'status', 'replayed', 'V5: same key, same content → replayed');
select is((public.place_order_line('Lan', 6, '2030-01-01', 'zalo', 'm1', 'Em 5 suất'))->>'status', 'conflict', 'V5: same key, new quantity → conflict');
select is((select count(*)::int from public.order_lines l join public.orders o on o.id = l.order_id where o.delivery_date = '2030-01-01'), 1, 'V5: still one line');

-- S20: no external_id → always a new line
select public.place_order_line('Minh', 1, '2030-01-01');
select public.place_order_line('Minh', 1, '2030-01-01');
select is((select count(*)::int from public.orders where customer_key = 'name:minh'), 2, 'S20: no key → new line every time');

-- V13: lines are immutable, even for the service role
select throws_ok($$update public.order_lines set quantity = 99$$, '55000', 'order_lines are immutable', 'V13: update rejected');

-- Line insert bumps the order (Realtime, V17)
update public.orders set updated_at = '2000-01-01' where customer_key = 'name:lan';
insert into public.order_lines (order_id, op, quantity) select id, 'reduce', -1 from public.orders where customer_key = 'name:lan';
select isnt((select updated_at from public.orders where customer_key = 'name:lan'), '2000-01-01'::timestamptz, 'new line touches its order');

-- Only the service role may call the write path
set local role authenticated;
select throws_ok($$select public.place_order_line('x', 1, '2030-01-01')$$, '42501', null, 'clients cannot call place_order_line');
reset role;

select * from finish();
rollback;
