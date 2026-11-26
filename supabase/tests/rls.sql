-- Run after `supabase db reset`:  supabase test db
begin;
select plan(7);
create temp table n as select count(*)::int as orders, (select count(*)::int from public.order_lines) as lines from public.orders;
grant select on n to anon, authenticated;
select public.place_order_line(current_date, p_customer_name => 't', p_quantity => 1);
set local role anon;
select is((select count(*) from public.orders)::int, 0, 'anon sees zero orders');
select is((select count(*) from public.order_lines)::int, 0, 'anon sees zero order lines');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"other"}}', true);
select is((select count(*) from public.orders)::int, 0, 'non-staff sees zero orders (S16)');
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"staff"}}', true);
select is((select count(*) from public.orders)::int, (select orders + 1 from n), 'staff sees orders');
select is((select count(*) from public.order_lines)::int, (select lines + 1 from n), 'staff sees order lines');
-- v1 web clients (deployed before spec v2) still read quantity/message/placed_at as computed fields
select is((select public.quantity(o) from public.orders o where customer_name = 't'), 1, 'v1 compat: quantity = order total');
select is((select public.placed_at(o) is not null from public.orders o where customer_name = 't'), true, 'v1 compat: placed_at');
select * from finish();
rollback;
