insert into public.orders (source, external_id, customer_name, quantity, message, delivery_date) values
  ('manual', 'seed-1', 'Honey', 5, 'Em 5 suất nhé 🍲', (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  ('manual', 'seed-2', 'Chị Lan', 2, 'Ít cay, giao trước 11h', (now() at time zone 'Asia/Ho_Chi_Minh')::date)
on conflict do nothing;
