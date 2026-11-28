export type LineOp = 'add' | 'reduce' | 'set' | 'cancel' | 'delete'

/** One immutable customer message (spec v2 §3). `quantity` is the signed delta it applied. */
export interface OrderLine {
  id: string
  op: LineOp
  quantity: number
  requested_quantity: number | null
  message: string
  placed_at: string // when the customer sent it (e.g. Zalo message time)
  source?: string   // 'voice' for the chef's commands; absent in older caches
}

/** One customer's order for a day; `quantity` and `placed_at` are derived from its lines. */
export interface Order {
  id: string
  customer_name: string
  delivery_date: string
  delivered: boolean
  delivered_at: string | null
  created_at: string
  lines: OrderLine[]   // placed_at ascending
  quantity: number     // order total = sum of line deltas
  placed_at: string    // first line's time
  pending?: boolean
}

export const ORDER_COLUMNS =
  'id,customer_name,delivery_date,delivered,delivered_at,created_at,order_lines(id,op,quantity,requested_quantity,message,placed_at,source)'

type RawOrder = Omit<Order, 'lines' | 'quantity' | 'placed_at'> & {
  lines?: OrderLine[]; order_lines?: OrderLine[]
  quantity?: number; message?: string; placed_at?: string // v1 shape (offline cache, old demo data)
}

/** Accepts a Supabase row, a cached Order, or a v1 order (read as one 'add' line) and derives totals. */
export function normalize(raw: RawOrder): Order {
  const { order_lines, lines: own, message, ...o } = raw
  const lines = [...(own ?? order_lines ?? [{
    id: `${o.id}:v1`, op: 'add' as const, quantity: o.quantity ?? 0, requested_quantity: o.quantity ?? 0,
    message: message ?? '', placed_at: o.placed_at ?? o.created_at,
  }])].sort((a, b) => a.placed_at.localeCompare(b.placed_at))
  return {
    ...o, lines,
    quantity: lines.reduce((n, l) => n + l.quantity, 0),
    placed_at: lines[0]?.placed_at ?? o.created_at,
  }
}

/** D7: an undelivered order whose lines sum to 0 was cancelled by the customer. */
export const isCancelled = (o: Order) => !o.delivered && o.quantity <= 0

const rank = (o: Order) => (isCancelled(o) ? 2 : o.delivered ? 1 : 0)

/** Open first, then delivered, then cancelled; each group by placed_at ascending (§5.1, spec v2 §5). */
export function sortOrders(list: Order[]): Order[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || a.placed_at.localeCompare(b.placed_at))
}

/** Counts customer orders, not lines; cancelled orders count for nothing (spec v2 §5, V16). */
export function summarize(list: Order[]) {
  const active = list.filter(o => o.quantity > 0)
  const left = active.filter(o => !o.delivered)
  return {
    orders: active.length,
    ordersLeft: left.length,
    portions: active.reduce((n, o) => n + o.quantity, 0),
    portionsLeft: left.reduce((n, o) => n + o.quantity, 0),
  }
}

/** Short delta shown before a line's message: +5, −2, =3, ✕. */
export function lineLabel(l: OrderLine): string {
  switch (l.op) {
    case 'add': return `+${l.quantity}`
    case 'reduce': return `−${-l.quantity}`
    case 'set': return `=${l.requested_quantity}`
    case 'cancel':
    case 'delete': return '✕'
  }
}

/** A lone add line reads like a v1 order: just the message, no delta. */
export const showLines = (o: Order) => !(o.lines.length === 1 && o.lines[0].op === 'add' && o.lines[0].source !== 'voice')

/** Data-access seam: Supabase in production, localStorage demo when no backend is configured. */
export interface OrderRepo {
  mode: 'supabase' | 'demo'
  list(date: string): Promise<Order[]>
  setDelivered(id: string, delivered: boolean): Promise<void>
  subscribe(date: string, onChange: () => void): () => void
}

export function withTimeout<T>(p: PromiseLike<T>, ms = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    Promise.resolve(p).then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

/** Retry with exponential backoff (M7). */
export async function retry<T>(fn: () => Promise<T>, tries = 3, base = 400): Promise<T> {
  let err: unknown
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) {
      err = e
      if (i < tries - 1) await new Promise(r => setTimeout(r, base * 2 ** i))
    }
  }
  throw err
}
