import { createClient } from '@supabase/supabase-js'
import { ORDER_COLUMNS, type Order, type OrderRepo, withTimeout } from './orders'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasBackend = !!(url && key)
export const supabase = hasBackend ? createClient(url!, key!) : null

export const supabaseRepo: OrderRepo = {
  mode: 'supabase',
  async list(date) {
    const { data, error } = await withTimeout(
      supabase!.from('orders').select(ORDER_COLUMNS).eq('delivery_date', date).order('created_at').limit(500))
    if (error) throw error
    return data as Order[]
  },
  async setDelivered(id, delivered) {
    const { error } = await withTimeout(supabase!.rpc('set_delivered', { p_id: id, p_delivered: delivered }))
    if (error) throw error
  },
  subscribe(date, onChange) {
    const ch = supabase!.channel(`orders:${date}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `delivery_date=eq.${date}` }, onChange)
      .subscribe()
    return () => { supabase!.removeChannel(ch) }
  },
}

export async function checkHealth(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await withTimeout(supabase.from('orders').select('id').limit(1))
    return !error
  } catch { return false }
}
