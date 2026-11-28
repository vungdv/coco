import { createClient, type RealtimeChannel } from '@supabase/supabase-js'
import { ORDER_COLUMNS, normalize, type OrderRepo, withTimeout } from './orders'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasBackend = !!(url && key)
export const supabase = hasBackend ? createClient(url!, key!) : null

/**
 * A Realtime channel that joins only once a session exists. Joined earlier, it carries the anon key and row level
 * security silently drops every event. `onJoined` catches up on what changed before the join (or before sign-in).
 */
export function liveChannel(name: string, setup: (ch: RealtimeChannel) => RealtimeChannel, onJoined?: () => void) {
  let channel: RealtimeChannel | null = null
  let closed = false
  const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
    if (!session) return
    setTimeout(async () => { // outside the auth callback: supabase-js deadlocks on calls made inside it
      if (closed || channel) return
      channel = setup(supabase!.channel(name))
      await supabase!.realtime.setAuth(session.access_token)
      if (!closed) channel.subscribe(status => { if (status === 'SUBSCRIBED') onJoined?.() })
    })
  })
  return () => {
    closed = true
    data.subscription.unsubscribe()
    if (channel) supabase!.removeChannel(channel)
  }
}

export const supabaseRepo: OrderRepo = {
  mode: 'supabase',
  async list(date) {
    const { data, error } = await withTimeout(
      supabase!.from('orders').select(ORDER_COLUMNS).eq('delivery_date', date).is('deleted_at', null).order('created_at').limit(500))
    if (error) throw error
    return (data as unknown as Parameters<typeof normalize>[0][]).map(normalize)
  },
  async setDelivered(id, delivered) {
    const { error } = await withTimeout(supabase!.rpc('set_delivered', { p_id: id, p_delivered: delivered }))
    if (error) throw error
  },
  subscribe(date, onChange) {
    return liveChannel(`orders:${date}`, ch => ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `delivery_date=eq.${date}` }, onChange), onChange)
  },
}

export async function checkHealth(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { error } = await withTimeout(supabase.from('orders').select('id').limit(1))
    return !error
  } catch { return false }
}
