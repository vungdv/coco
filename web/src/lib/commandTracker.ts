// The commands sent from this screen: send, follow, dismiss. Framework-free so it can be tested with a fake repo.
import { applyUpdate, isPending, MAX_TRANSCRIPT, viewOf, type Tracked, type VoiceCommand, type VoiceRepo } from './voice'

export function createCommandTracker(repo: VoiceRepo, onChange: (list: Tracked[]) => void, now = () => Date.now()) {
  let list: Tracked[] = [] // newest first
  let seq = 0
  const early = new Map<string, VoiceCommand>() // events that beat the insert response

  const set = (next: Tracked[]) => { list = next; onChange(list) }
  const patch = (id: string, p: Partial<Tracked>) => set(list.map(c => (c.id === id ? { ...c, ...p } : c)))

  function receive(row: VoiceCommand) {
    if (!list.some(c => c.commandId === row.id)) { early.set(row.id, row); return }
    set(list.map(c => applyUpdate(c, row, now())))
  }
  const unsubscribe = repo.subscribe(receive)

  async function deliver(local: Tracked) {
    try {
      const row = await repo.send(local.transcript, local.date)
      patch(local.id, { commandId: row.id, status: 'queued' })
      receive(row)
      const seen = early.get(row.id)
      if (seen) { early.delete(row.id); receive(seen) }
    } catch {
      patch(local.id, { status: 'send_failed' }) // not retried by itself: an insert is not idempotent
    }
  }

  function send(transcript: string, date: string) {
    const t = now()
    const local: Tracked = {
      id: `local-${++seq}`, commandId: null, transcript: transcript.trim().slice(0, MAX_TRANSCRIPT), date,
      sentAt: t, status: 'sending', result: null, finishedAt: null, shownAt: new Date(t).toISOString(),
    }
    set([local, ...list])
    return deliver(local)
  }

  function remove(id: string) { set(list.filter(c => c.id !== id)) }

  /** "Bỏ" on an unclaimed command, or the close button on a finished one. */
  async function dismiss(id: string) {
    const c = list.find(x => x.id === id)
    if (!c) return
    if (!isPending(c) || !c.commandId) { remove(id); return }
    try {
      if (await repo.dismiss(c.commandId)) remove(id)
      else await refresh() // the Assistant got there first
    } catch { /* keep it on screen: it may still run */ }
  }

  /** Catch up on anything Realtime missed. */
  async function refresh() {
    const ids = list.filter(c => isPending(c) && c.commandId).map(c => c.commandId!)
    if (!ids.length) return
    try { (await repo.get(ids)).forEach(receive) } catch { /* next tick */ }
  }

  /** Drop what has faded out. */
  function prune() {
    const next = list.filter(c => viewOf(c, now()) !== null)
    if (next.length !== list.length) set(next)
  }

  return { send, dismiss, refresh, prune, stop: unsubscribe }
}
