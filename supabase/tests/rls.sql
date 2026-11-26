-- Run after `supabase db reset`:  supabase test db
begin;
select plan(5);
create temp table n as select count(*)::int as orders, (select count(*)::int from public.order_lines) as lines from public.orders;
grant select on n to anon, authenticated;
select public.place_order_line('t', 1, current_date);
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
select * from finish();
rollback;
