export interface Order {
  id: string
  customer_name: string
  quantity: number
  message: string
  delivery_date: string
  delivered: boolean
  delivered_at: string | null
  created_at: string
  placed_at: string // when the customer placed it (e.g. Zalo message time)
  pending?: boolean
}

export const ORDER_COLUMNS = 'id,customer_name,quantity,message,delivery_date,delivered,delivered_at,created_at,placed_at'

/** Orders stored locally before placed_at existed (offline cache, demo data) fall back to created_at. */
export function withPlacedAt(list: Array<Omit<Order, 'placed_at'> & { placed_at?: string }>): Order[] {
  return list.map(o => ({ ...o, placed_at: o.placed_at ?? o.created_at }))
}

/** Undelivered first, then placed_at ascending (§5.1). */
export function sortOrders(list: Order[]): Order[] {
  return [...list].sort((a, b) =>
    Number(a.delivered) - Number(b.delivered) || a.placed_at.localeCompare(b.placed_at))
}

/** Totals for the day, plus what is still left to deliver (undelivered orders only). */
export function summarize(list: Order[]) {
  const left = list.filter(o => !o.delivered)
  return {
    orders: list.length,
    ordersLeft: left.length,
    portions: list.reduce((n, o) => n + o.quantity, 0),
    portionsLeft: left.reduce((n, o) => n + o.quantity, 0),
  }
}

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
