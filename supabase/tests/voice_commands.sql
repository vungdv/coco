-- spec v3 step 1: delete op (E8) and voice commands (W5, W11, W13–W15). Run: supabase test db
begin;
select plan(34);

create function pg_temp.line(op text, q int, k text default null, n text default 'Hương') returns jsonb language sql as
  $$ select public.place_order_line('2030-02-01', op, q, n, null, 'voice', k) $$;
create function pg_temp.rows(n text default 'Hương') returns int language sql as
  $$ select count(*)::int from public.orders where delivery_date = '2030-02-01' and customer_id = lower(n) $$;

-- Main scenario W5: delete hides the order, keeps its lines, and a new add starts a new order
select is((pg_temp.line('add', 4, 'v1'))->>'status', 'created', 'Given an open order of 4');
select is((pg_temp.line('delete', null, 'v2'))->'line'->>'quantity', '-4', 'W5: delete stores a -total line');
select isnt((select deleted_at from public.orders where customer_id = 'hương' and delivery_date = '2030-02-01'), null,
  'W5: the order is marked deleted');
select is((select deleted_by from public.orders where customer_id = 'hương' and delivery_date = '2030-02-01'), 'voice',
  'W5: deleted_by records the source');
select is((select count(*)::int from public.order_lines l join public.orders o on o.id = l.order_id
  where o.customer_id = 'hương' and o.delivery_date = '2030-02-01'), 2, 'W5: both lines are kept (D3)');
select is((pg_temp.line('add', 2, 'v3'))->'order'->>'quantity', '2', 'W5: an add after delete starts a new order of 2');
select is(pg_temp.rows(), 2, 'W5: the deleted order and the new one both exist (unique index ignores deleted)');

-- Delete edge cases
select is((pg_temp.line('delete', null, 'v2'))->>'status', 'replayed', 'W11: the same delete again is a replay');
select is((pg_temp.line('delete', null, 'x1', 'Nobody'))->>'status', 'no_open_order', 'D6: delete with nothing open');
select throws_ok($$ select pg_temp.line('delete', 1) $$, '22023', null, 'delete with a quantity is rejected');
update public.orders set delivered = true where customer_id = 'hương' and deleted_at is null and delivery_date = '2030-02-01';
select is((pg_temp.line('delete', null, 'v4'))->>'status', 'no_open_order', 'D2: a delivered order cannot be deleted');

-- Claim and finish (service role). Commands are created as a staff user, as the web does.
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'chef@test'), ('00000000-0000-0000-0000-0000000000a2', 'other@test');
update public.voice_commands set status = 'done' where status in ('queued', 'processing'); -- isolate from local data

set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","app_metadata":{"role":"staff"}}', true);
insert into public.voice_commands (transcript, delivery_date) values ('Hương 3 suất', '2030-02-01');
insert into ids select 'first', id from public.voice_commands where transcript = 'Hương 3 suất';
insert into public.voice_commands (transcript, delivery_date) values ('Lan huỷ đơn', '2030-02-01');
insert into ids select 'second', id from public.voice_commands where transcript = 'Lan huỷ đơn';

reset role;
update public.voice_commands set created_at = now() + interval '1 second' where transcript = 'Lan huỷ đơn'; -- oldest first
set local role authenticated;

-- W15: RLS for the browser
select is((select status from public.voice_commands where id = (select id from ids where name = 'first')), 'queued',
  'W15: a staff insert is queued and owned by the chef');
select throws_ok($$ update public.voice_commands set result = '{}' where transcript = 'Lan huỷ đơn' $$, '42501', null,
  'W15: staff cannot write result');
select throws_ok($$ update public.voice_commands set status = 'done' where transcript = 'Lan huỷ đơn' $$, '42501', null,
  'W15: staff cannot mark a command done');
select throws_ok($$ insert into public.voice_commands (transcript, delivery_date, status) values ('x', '2030-02-01', 'done') $$,
  '42501', null, 'W15: staff cannot insert with a status');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a2","app_metadata":{"role":"staff"}}', true);
select is((select count(*)::int from public.voice_commands), 0, 'W15: another staff user sees none of the chef''s commands');
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","app_metadata":{"role":"other"}}', true);
select throws_ok($$ insert into public.voice_commands (transcript, delivery_date) values ('x', '2030-02-01') $$,
  '42501', null, 'W15: a non-staff user cannot insert');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.voice_commands $$, '42501', null, 'W15: anon cannot read commands');
reset role;

-- Main scenario: claim the oldest, finish it
select is((public.claim_voice_command())->'command'->>'id', (select id::text from ids where name = 'first'),
  'claim returns the oldest queued command');
select is((select status from public.voice_commands where id = (select id from ids where name = 'first')), 'processing',
  'claim marks it processing');
select is((select jsonb_array_length(public.claim_voice_command() -> 'orders')), 1,
  'W13: a second claim gets the next command, with that day''s non-deleted orders');
select is(public.claim_voice_command(), null, 'claim with nothing left returns null (204)');
select is((public.finish_voice_command((select id from ids where name = 'first'), 'done',
  '{"op":"set","quantity":3}'))->>'status', 'done', 'finish stores done');
select is((select result->>'op' from public.voice_commands where id = (select id from ids where name = 'first')), 'set',
  'finish stores the result');
select is(public.finish_voice_command((select id from ids where name = 'first'), 'failed', '{}'), null,
  'V9: finishing a command that is no longer processing returns null (409)');
select throws_ok($$ select public.finish_voice_command(gen_random_uuid(), 'queued', '{}') $$, '22023', null,
  'finish only accepts done or failed');

-- W14: a stale claim is handed out again; a fresh one is not
update public.voice_commands set claimed_at = now() - interval '3 minutes' where id = (select id from ids where name = 'second');
select is((public.claim_voice_command())->'command'->>'id', (select id::text from ids where name = 'second'),
  'W14: a command processing for more than 2 min is claimed again');
select is(public.claim_voice_command(), null, 'W14: a fresh claim is not handed out twice');

-- E10: the chef dismisses a queued command, and it is never claimed
set local role authenticated;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1","app_metadata":{"role":"staff"}}', true);
insert into public.voice_commands (transcript, delivery_date) values ('Mai bớt 1', '2030-02-01');
update public.voice_commands set status = 'dismissed' where transcript = 'Mai bớt 1';
select is((select status from public.voice_commands where transcript = 'Mai bớt 1'), 'dismissed', 'E10: a queued command can be dismissed');
update public.voice_commands set status = 'dismissed' where transcript = 'Lan huỷ đơn';
select is((select status from public.voice_commands where transcript = 'Lan huỷ đơn'), 'processing',
  'E10: a processing command cannot be dismissed (RLS filters it out)');
reset role;
select is(public.claim_voice_command(), null, 'E10: a dismissed command is never claimed');

-- Grants: the browser cannot call the Assistant's functions
set local role authenticated;
select throws_ok($$ select public.claim_voice_command() $$, '42501', null, 'W15: staff cannot claim');
reset role;

-- W11: a re-claimed command still sees the order it deleted itself; other commands do not
select pg_temp.line('add', 2, 'z0', 'Zed');
set local role authenticated;
insert into public.voice_commands (transcript, delivery_date) values ('Zed xoá đơn', '2030-02-01');
reset role;
select public.place_order_line('2030-02-01', 'delete', null, 'Zed', null, 'voice',
  (select id::text from public.voice_commands where transcript = 'Zed xoá đơn'));
select ok((public.claim_voice_command() -> 'orders') @> '[{"customer_id":"zed"}]',
  'W11: the claim lists the order this command deleted');
set local role authenticated;
insert into public.voice_commands (transcript, delivery_date) values ('Zed 1 suất', '2030-02-01');
reset role;
select ok(not (public.claim_voice_command() -> 'orders') @> '[{"customer_id":"zed"}]',
  'a different command does not see the deleted order');

select * from finish();
rollback;
