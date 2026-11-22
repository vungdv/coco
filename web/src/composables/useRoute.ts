import { onBeforeUnmount, ref } from 'vue'
import { isValidDate, todayVN } from '../lib/date'

/** Selected date lives in the hash: #/?date=2026-11-21 (S28, bookmarkable). */
function parse(): string {
  const q = location.hash.split('?')[1] ?? ''
  const d = new URLSearchParams(q).get('date')
  return isValidDate(d) ? d : todayVN()
}

export function useDateRoute() {
  const date = ref(parse())
  const sync = () => { date.value = parse() }
  window.addEventListener('hashchange', sync)
  onBeforeUnmount(() => window.removeEventListener('hashchange', sync))
  function setDate(d: string) {
    if (isValidDate(d)) location.hash = `#/?date=${d}`
  }
  return { date, setDate }
}
