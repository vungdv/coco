-- Run after `supabase db reset`:  supabase test db
begin;
select plan(3);
insert into public.orders (customer_name, quantity, delivery_date) values ('t', 1, current_date);
set local role anon;
select is((select count(*) from public.orders)::int, 0, 'anon sees zero orders');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"other"}}', true);
select is((select count(*) from public.orders)::int, 0, 'non-staff sees zero orders (S16)');
select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"staff"}}', true);
select is((select count(*) from public.orders)::int, 1, 'staff sees orders');
select * from finish();
rollback;
