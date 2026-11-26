import { todayVN } from './date'
import { normalize, type Order, type OrderLine, type OrderRepo } from './orders'

const KEY = 'bpb:demo-orders-v2' // v2: orders with lines (adjusted + cancelled examples)

function seed(): Order[] {
  const d = todayVN()
  const at = (hhmm: string) => new Date(`${d}T${hhmm}:00+07:00`).toISOString()
  const ln = (op: OrderLine['op'], quantity: number, requested: number | null, message: string, hhmm: string) =>
    ({ op, quantity, requested_quantity: requested, message, placed_at: at(hhmm) })
  const mk = (i: number, n: string, lines: Omit<OrderLine, 'id'>[]): Order => normalize({
    id: `demo-${i}`, customer_name: n, delivery_date: d,
    delivered: false, delivered_at: null, created_at: new Date(Date.now() + i * 1000).toISOString(),
    lines: lines.map((l, j) => ({ ...l, id: `demo-${i}-${j}` })),
  })
  return [
    mk(1, 'Honey', [ln('add', 5, 5, 'Em 5 suất nhé 🍲', '07:15')]),
    mk(2, 'Chị Lan', [ln('add', 2, 2, 'Ít cay, giao trước 11h', '08:40')]),
    mk(3, 'Anh Minh', [ln('add', 10, 10, 'Giao tới công ty, gọi khi tới tầng 3. Cảm ơn bếp!', '09:05'),
      ln('reduce', -2, 2, 'Bớt 2 suất nha bếp', '09:40')]),
    mk(4, 'Cô Hạnh', [ln('add', 3, 3, '3 suất', '08:10'), ln('cancel', -3, null, 'Hủy giúp cô nhé', '10:02')]),
  ]
}

function read(): Order[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw).map(normalize)
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
