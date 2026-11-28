// Voice commands: types, the hold-to-talk decision and the command state shown to the chef (spec v3 §7). Pure.

export type CommandStatus = 'queued' | 'processing' | 'done' | 'failed' | 'dismissed'

export interface CommandResult {
  // done
  op?: 'add' | 'reduce' | 'set' | 'cancel' | 'delete'
  order_id?: string
  customer_name?: string
  quantity?: number // order total after the change
  delta?: number
  // failed
  error?: string
  detail?: string
  candidates?: string[]
}

export interface VoiceCommand {
  id: string
  transcript: string
  delivery_date: string
  status: CommandStatus
  result: CommandResult | null
}

/** Data-access seam, like OrderRepo: Supabase in production, a local fake Assistant in demo mode. */
export interface VoiceRepo {
  send(transcript: string, date: string): Promise<VoiceCommand>
  get(ids: string[]): Promise<VoiceCommand[]>
  /** False when the command is no longer queued, so it could not be dismissed. */
  dismiss(id: string): Promise<boolean>
  subscribe(onChange: (c: VoiceCommand) => void): () => void
}

export const MIN_HOLD_MS = 400
export const MAX_HOLD_MS = 15_000
export const SLIDE_CANCEL_PX = 80
export const UNCLAIMED_AFTER_MS = 30_000
export const DONE_VISIBLE_MS = 5_000
export const MAX_RESULTS = 2
export const MAX_TRANSCRIPT = 500

export const slidToCancel = (startX: number, x: number) => startX - x > SLIDE_CANCEL_PX

export type Release = 'send' | 'cancelled' | 'hint'

/** What letting go of the bar does (W16): only a long enough hold with words, not slid away, sends. */
export function releaseOutcome(heldMs: number, slid: boolean, transcript: string): Release {
  if (slid) return 'cancelled'
  return heldMs < MIN_HOLD_MS || !transcript.trim() ? 'hint' : 'send'
}

/** One command as the screen tracks it. `id` is local, so it exists before the server row does. */
export interface Tracked {
  id: string
  commandId: string | null
  transcript: string
  date: string
  sentAt: number
  status: 'sending' | 'send_failed' | CommandStatus
  result: CommandResult | null
  finishedAt: number | null
  shownAt: string // "HH:mm" source: ISO time it was sent
}

export type View = 'sending' | 'processing' | 'unclaimed' | 'done' | 'failed' | 'send_failed'

/** What to show for a command at time `now`, or null when it should leave the screen. */
export function viewOf(c: Tracked, now: number): View | null {
  switch (c.status) {
    case 'sending': return 'sending'
    case 'send_failed': return 'send_failed'
    case 'queued': return now - c.sentAt >= UNCLAIMED_AFTER_MS ? 'unclaimed' : 'processing' // E10
    case 'processing': return 'processing'
    case 'done': return now - (c.finishedAt ?? now) >= DONE_VISIBLE_MS ? null : 'done'
    case 'failed': return 'failed'
    case 'dismissed': return null
  }
}

export const isPending = (c: Tracked) => c.status === 'queued' || c.status === 'processing'

const ORDER: Record<CommandStatus, number> = { queued: 0, processing: 1, done: 2, failed: 2, dismissed: 2 }

/** Apply a server row. Late or repeated events never move a command backwards. */
export function applyUpdate(c: Tracked, row: VoiceCommand, now: number): Tracked {
  if (c.commandId !== row.id) return c
  if (c.status !== 'sending' && c.status !== 'send_failed' && ORDER[row.status] <= ORDER[c.status]) return c
  const finished = row.status === 'done' || row.status === 'failed'
  return { ...c, status: row.status, result: row.result, finishedAt: finished ? now : null }
}
