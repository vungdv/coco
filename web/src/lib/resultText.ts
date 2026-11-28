// The words of one result-bar entry (spec v3 §7), as message keys so they follow the language switch.
import type { MessageKey } from '../i18n'
import type { Tracked, View } from './voice'

type Say = (key: MessageKey, params?: Record<string, string | number>) => string

const ERRORS: Record<string, MessageKey> = {
  not_understood: 'voice.err.notUnderstood',
  not_found: 'voice.err.notFound',
  ambiguous: 'voice.err.ambiguous',
  no_open_order: 'voice.err.noOpenOrder',
  order_api_error: 'voice.err.failed',
  assistant_error: 'voice.err.failed',
}

export function resultText(c: Tracked, view: View, say: Say): { title: string; detail: string } {
  const said = `“${c.transcript}”`
  const r = c.result ?? {}
  switch (view) {
    case 'sending': return { title: said, detail: say('voice.sending') }
    case 'processing': return { title: said, detail: say('voice.processing') }
    case 'unclaimed': return { title: say('voice.unclaimed'), detail: `${said} — ${say('voice.unclaimedDetail')}` }
    case 'send_failed': return { title: say('voice.sendFailed'), detail: said }
    case 'failed': {
      const name = r.detail ?? ''
      const key = ERRORS[r.error ?? ''] ?? 'voice.err.failed'
      const title = say(key, { name, count: r.candidates?.length ?? 0 })
      return { title, detail: r.error === 'ambiguous' ? `${(r.candidates ?? []).join(' · ')} — ${say('voice.fullName')}` : said }
    }
    case 'done': {
      const name = r.customer_name ?? ''
      const quantity = r.quantity ?? 0
      const title = r.op === 'delete' ? say('voice.deleted', { name })
        : r.op === 'cancel' ? say('voice.cancelled', { name })
        : say('voice.total', { name, quantity })
      const before = quantity - (r.delta ?? 0)
      const was = r.op !== 'delete' && r.op !== 'cancel' && before > 0 && r.delta ? `${say('voice.from', { before })} · ` : ''
      return { title, detail: `${was}${said}` }
    }
  }
}
