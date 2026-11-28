-- spec v3 W11: if the Assistant stops after deleting but before reporting, the next claim must still list that order.
create or replace function public.claim_voice_command() returns jsonb
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
      from orders o where o.delivery_date = v.delivery_date
        and (o.deleted_at is null
          -- a re-claimed delete must still find its customer, so the replay is reported as done (W11)
          or exists (select 1 from order_lines l
                     where l.order_id = o.id and l.source = 'voice' and l.external_id = v.id::text))), '[]'::jsonb));
end $$;
