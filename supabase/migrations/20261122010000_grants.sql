-- Newer Supabase projects don't auto-grant on public tables; RLS still decides which rows are visible.
grant select on public.orders to anon;                       -- RLS returns zero rows for anon
grant select, insert, delete on public.orders to authenticated; -- updates only via set_delivered()
grant all on public.orders, public.api_keys to service_role;    -- Edge Function
