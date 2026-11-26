select public.place_order_line(p_delivery_date => (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_customer_name => 'Honey',
  p_quantity => 5, p_source => 'manual', p_external_id => 'seed-1', p_message => 'Em 5 suất nhé 🍲');
select public.place_order_line(p_delivery_date => (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_customer_name => 'Chị Lan',
  p_quantity => 2, p_source => 'manual', p_external_id => 'seed-2', p_message => 'Ít cay, giao trước 11h');
select public.place_order_line(p_delivery_date => (now() at time zone 'Asia/Ho_Chi_Minh')::date, p_customer_name => 'Chị Lan',
  p_op => 'reduce', p_quantity => 1, p_source => 'manual', p_external_id => 'seed-3', p_message => 'Bớt 1 suất nha');
