// Demo mode: a stand-in for the Assistant that understands the simple command forms and edits the demo orders.
// The real extraction lives in the Assistant (its spec v3); this exists only to show the flow without a backend.
import { demoStore } from './demoRepo'
import { normalize, type Order } from './orders'
import type { CommandResult, VoiceCommand, VoiceRepo } from './voice'

const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase()
const HONORIFICS = new Set(['chi', 'anh', 'em', 'co', 'chu', 'bac', 'ba', 'ong', 'ban'])
/** Word order is ignored; only a leading honorific is dropped, since "Anh" also ends names like "Minh Anh". */
const key = (name: string) => {
  const words = plain(name).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return (words.length > 1 && HONORIFICS.has(words[0]) ? words.slice(1) : words).sort().join(' ')
}

const PATTERNS: [NonNullable<CommandResult['op']>, RegExp][] = [
  ['delete', /^(.+?)[,\s]+(?:xoá|xóa) đơn$/iu],
  ['cancel', /^(.+?)[,\s]+(?:huỷ|hủy) đơn$/iu],
  ['add', /^(.+?)[,\s]+thêm (\d+)(?: suất| phần)?$/iu],
  ['reduce', /^(.+?)[,\s]+(?:bớt|giảm) (\d+)(?: suất| phần)?$/iu],
  ['set', /^(.+?)[,\s]+(\d+) (?:suất|phần)$/iu],
]

export function parseDemo(transcript: string) {
  const s = transcript.normalize('NFC').trim().replace(/[.!]+$/, '')
  for (const [op, re] of PATTERNS) {
    const m = re.exec(s)
    if (m) return { op, name: m[1].trim(), qty: m[2] === undefined ? null : Number(m[2]) }
  }
  return null
}

/** Apply one command to the demo orders of its date. */
export function applyDemo(orders: Order[], command: VoiceCommand, at: string): { orders: Order[]; status: 'done' | 'failed'; result: CommandResult } {
  const fail = (result: CommandResult) => ({ orders, status: 'failed' as const, result })
  const p = parseDemo(command.transcript)
  if (!p) return fail({ error: 'not_understood' })
  const day = orders.filter(o => o.delivery_date === command.delivery_date)
  const matches = day.filter(o => !o.delivered && key(o.customer_name) === key(p.name))
  const partial = matches.length ? matches : day.filter(o => !o.delivered
    && key(p.name).split(' ').every(w => key(o.customer_name).split(' ').includes(w)))
  if (partial.length > 1) return fail({ error: 'ambiguous', detail: p.name, candidates: partial.map(o => o.customer_name) })
  const found = partial[0]
  if (!found && p.op !== 'add' && p.op !== 'set') return fail({ error: 'not_found', detail: p.name })

  const total = found?.quantity ?? 0
  const delta = { add: p.qty!, set: p.qty! - total, reduce: -Math.min(p.qty!, total), cancel: -total, delete: -total }[p.op]
  const line = { id: command.id, op: p.op, quantity: delta, requested_quantity: p.qty, message: command.transcript,
    placed_at: at, source: 'voice' }
  const order = normalize({
    ...(found ?? { id: `demo-${command.id}`, customer_name: p.name, delivery_date: command.delivery_date,
      delivered: false, delivered_at: null, created_at: at }),
    lines: [...(found?.lines ?? []), line],
  })
  const rest = orders.filter(o => o.id !== order.id)
  return {
    orders: p.op === 'delete' ? rest : [...rest, order],
    status: 'done',
    result: { op: p.op, order_id: order.id, customer_name: order.customer_name, quantity: order.quantity, delta },
  }
}

const commands = new Map<string, VoiceCommand>()
const listeners = new Set<(c: VoiceCommand) => void>()
const emit = (c: VoiceCommand) => { commands.set(c.id, c); listeners.forEach(l => l(c)) }

export const demoVoiceRepo: VoiceRepo = {
  async send(transcript, delivery_date) {
    const c: VoiceCommand = { id: crypto.randomUUID(), transcript, delivery_date, status: 'queued', result: null }
    commands.set(c.id, c)
    setTimeout(() => {
      if (commands.get(c.id)?.status !== 'queued') return
      emit({ ...c, status: 'processing' })
      setTimeout(() => {
        const out = applyDemo(demoStore.read(), c, new Date().toISOString())
        demoStore.write(out.orders)
        emit({ ...c, status: out.status, result: out.result })
      }, 900)
    }, 600)
    return c
  },
  async get(ids) { return ids.flatMap(id => commands.get(id) ?? []) },
  async dismiss(id) {
    const c = commands.get(id)
    if (c?.status !== 'queued') return false
    emit({ ...c, status: 'dismissed' })
    return true
  },
  subscribe(onChange) { listeners.add(onChange); return () => { listeners.delete(onChange) } },
}
