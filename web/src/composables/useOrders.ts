import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { MessageKey } from '../i18n'
import { retry, sortOrders, summarize, normalize, type Order, type OrderRepo } from '../lib/orders'

const cacheKey = (d: string) => `bpb:orders:${d}`

function readCache(d: string): Order[] | null {
  try { const r = localStorage.getItem(cacheKey(d)); return r ? JSON.parse(r).map(normalize) : null } catch { return null }
}
function writeCache(d: string, o: Order[]) {
  try { localStorage.setItem(cacheKey(d), JSON.stringify(o)) } catch { /* ignore */ }
}

export function useOrders(repo: OrderRepo, date: Ref<string>, onToast: (key: MessageKey) => void) {
  const orders = ref<Order[]>([])
  const loading = ref(true)
  const error = ref<MessageKey | null>(null) // a message key, so it re-renders on language change
  const online = ref(navigator.onLine)
  const versions = new Map<string, number>() // last tap wins (S12)
  let unsub: (() => void) | null = null
  let loadSeq = 0

  const sorted = computed(() => sortOrders(orders.value))
  const summary = computed(() => summarize(orders.value))

  async function load(showSkeleton = true) {
    const seq = ++loadSeq
    const d = date.value
    const cached = readCache(d)
    if (cached) { orders.value = cached; loading.value = false } // stale-while-revalidate (M6)
    else if (showSkeleton) { orders.value = []; loading.value = true }
    error.value = null
    try {
      const fresh = await retry(() => repo.list(d), 3)
      if (seq !== loadSeq) return
      // keep optimistic pending toggles that haven't synced
      const pending = new Map(orders.value.filter(o => o.pending).map(o => [o.id, o]))
      orders.value = fresh.map(o => pending.get(o.id) ?? o)
      writeCache(d, fresh)
    } catch {
      if (seq === loadSeq && !cached) error.value = 'orders.loadFailed'
    } finally {
      if (seq === loadSeq) loading.value = false
    }
  }

  function subscribe() {
    unsub?.()
    unsub = repo.subscribe(date.value, () => load(false))
  }
  function unsubscribe() { unsub?.(); unsub = null }

  async function toggle(id: string) {
    const o = orders.value.find(x => x.id === id)
    if (!o || !online.value) return
    const next = !o.delivered
    const v = (versions.get(id) ?? 0) + 1
    versions.set(id, v)
    const prev = { delivered: o.delivered, delivered_at: o.delivered_at }
    o.delivered = next
    o.delivered_at = next ? new Date().toISOString() : null
    o.pending = true
    try {
      await retry(() => repo.setDelivered(id, next), 2, 300)
      if (versions.get(id) === v) o.pending = false
      writeCache(date.value, orders.value)
    } catch {
      if (versions.get(id) !== v) return
      o.delivered = prev.delivered
      o.delivered_at = prev.delivered_at
      o.pending = false
      onToast('orders.updateFailed')
    }
  }

  const goOnline = () => { online.value = true; load(false) }
  const goOffline = () => { online.value = false }
  const onVisibility = () => {
    if (document.hidden) unsubscribe()
    else { load(false); subscribe() } // iOS suspends background sockets (M9)
  }

  onMounted(() => {
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    unsubscribe()
    window.removeEventListener('online', goOnline)
    window.removeEventListener('offline', goOffline)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  watch(date, () => { load(); subscribe() }, { immediate: true })

  return { orders: sorted, summary, loading, error, online, reload: () => load(), toggle }
}
