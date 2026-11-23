import { todayVN } from './date'
import { withPlacedAt, type Order, type OrderRepo } from './orders'

const KEY = 'bpb:demo-orders'

function seed(): Order[] {
  const d = todayVN()
  const mk = (i: number, n: string, q: number, m: string, placedVN: string): Order => ({
    id: `demo-${i}`, customer_name: n, quantity: q, message: m, delivery_date: d,
    delivered: false, delivered_at: null, created_at: new Date(Date.now() + i * 1000).toISOString(),
    placed_at: new Date(`${d}T${placedVN}:00+07:00`).toISOString(),
  })
  return [
    mk(1, 'Honey', 5, 'Em 5 suất nhé 🍲', '07:15'),
    mk(2, 'Chị Lan', 2, 'Ít cay, giao trước 11h', '08:40'),
    mk(3, 'Anh Minh', 10, 'Giao tới công ty, gọi khi tới tầng 3. Cảm ơn bếp!', '09:05'),
  ]
}

function read(): Order[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return withPlacedAt(JSON.parse(raw))
  } catch { /* ignore */ }
  const s = seed()
  write(s)
  return s
}
function write(o: Order[]) { try { localStorage.setItem(KEY, JSON.stringify(o)) } catch { /* ignore */ } }

export const demoRepo: OrderRepo = {
  mode: 'demo',
  async list(date) { return read().filter(o => o.delivery_date === date) },
  async setDelivered(id, delivered) {
    write(read().map(o => o.id === id
      ? { ...o, delivered, delivered_at: delivered ? new Date().toISOString() : null } : o))
  },
  subscribe() { return () => {} },
}
