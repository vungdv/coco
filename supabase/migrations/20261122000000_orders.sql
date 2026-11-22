-- orders, api_keys, RLS, triggers (spec §4)
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  source text not null default 'manual',
  customer_name text not null check (length(customer_name) between 1 and 200),
  quantity int not null check (quantity > 0),
  message text not null default '' check (length(message) <= 2000),
  delivery_date date not null,
  delivered boolean not null default false,
  delivered_at timestamptz,
  delivered_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULL external_id values are distinct, so orders without one never collide (S20)
  unique (source, external_id)
);
create index orders_day_idx on public.orders (delivery_date, delivered, created_at);

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique, -- hex SHA-256, never plaintext
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
alter table public.api_keys enable row level security; -- no policies: service role only

create function public.is_staff() returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'staff'
$$;

alter table public.orders enable row level security;
create policy staff_select on public.orders for select to authenticated using (public.is_staff());
create policy staff_insert on public.orders for insert to authenticated with check (public.is_staff());
create policy staff_delete on public.orders for delete to authenticated using (public.is_staff());
-- No UPDATE policy: the UI can only change delivery state through set_delivered().
-- No policies for anon.

create function public.set_delivered(p_id uuid, p_delivered boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.orders set
    delivered = p_delivered,
    delivered_at = case when p_delivered then now() else null end,
    delivered_by = case when p_delivered then auth.uid() else null end
  where id = p_id;
end $$;
revoke all on function public.set_delivered(uuid, boolean) from public, anon;
grant execute on function public.set_delivered(uuid, boolean) to authenticated;

alter publication supabase_realtime add table public.orders;
