import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { createCommandTracker } from '../lib/commandTracker'
import { isPending, MAX_RESULTS, viewOf, type Tracked, type VoiceRepo } from '../lib/voice'

const TICK_MS = 500
const REFRESH_EVERY_TICKS = 10 // every 5 s while something is pending, in case a Realtime event was missed

export function useVoiceCommands(source: VoiceRepo, enabled: boolean) {
  const repo = enabled ? source : { ...source, subscribe: () => () => {} }
  const list = shallowRef<Tracked[]>([])
  const now = ref(Date.now())
  const tracker = createCommandTracker(repo, (l) => { list.value = l; now.value = Date.now() })
  let ticks = 0
  let timer: ReturnType<typeof setInterval>

  const results = computed(() => list.value
    .flatMap(c => { const view = viewOf(c, now.value); return view ? [{ ...c, view }] : [] })
    .slice(0, MAX_RESULTS))

  const onVisibility = () => { if (!document.hidden) tracker.refresh() }
  onMounted(() => {
    timer = setInterval(() => {
      if (!list.value.length) return
      now.value = Date.now()
      tracker.prune()
      if (++ticks % REFRESH_EVERY_TICKS === 0 && list.value.some(isPending)) tracker.refresh()
    }, TICK_MS)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    tracker.stop()
  })

  return { results, send: tracker.send, dismiss: tracker.dismiss }
}
