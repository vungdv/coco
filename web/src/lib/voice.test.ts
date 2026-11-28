import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommandTracker } from './commandTracker'
import { applyDemo, parseDemo } from './demoVoice'
import { translate } from '../i18n'
import { resultText } from './resultText'
import { listen, speechCtor, type Recognition } from './speech'
import { lineLabel, normalize, showLines } from './orders'
import { releaseOutcome, slidToCancel, viewOf, type Tracked, type VoiceCommand, type VoiceRepo } from './voice'

const row = (p: Partial<VoiceCommand> = {}): VoiceCommand =>
  ({ id: 'c1', transcript: 'Lê Hương, 4 suất', delivery_date: '2026-11-28', status: 'queued', result: null, ...p })

function fakeRepo(over: Partial<VoiceRepo> = {}) {
  let push: (c: VoiceCommand) => void = () => {}
  const repo: VoiceRepo = {
    send: vi.fn(async () => row()), get: vi.fn(async () => []), dismiss: vi.fn(async () => true),
    subscribe: (f) => { push = f; return () => {} }, ...over,
  }
  return { repo, push: (c: VoiceCommand) => push(c) }
}

describe('hold to talk (W16)', () => {
  it('Given a long enough hold with words, When released, Then it sends', () => {
    expect(releaseOutcome(900, false, 'Lê Hương 4 suất')).toBe('send')
  })
  it('Given a slide left past 80 px, Then it cancels, so a wrong start costs nothing', () => {
    expect([slidToCancel(300, 219), slidToCancel(300, 221)]).toEqual([true, false])
    expect(releaseOutcome(900, true, 'Lê Hương 4 suất')).toBe('cancelled')
  })
  it('Given a tap under 400 ms or no words, Then nothing is sent and the hint shows', () => {
    expect([releaseOutcome(399, false, 'x'), releaseOutcome(900, false, '  ')]).toEqual(['hint', 'hint'])
  })
})

describe('command tracking (W12, W18)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
  afterEach(() => vi.useRealTimers())
  const track = (repo: VoiceRepo) => {
    let list: Tracked[] = []
    const tracker = createCommandTracker(repo, l => { list = l })
    return { tracker, list: () => list, view: () => list[0] && viewOf(list[0], Date.now()) }
  }

  it('Given a sent command, Then sending → processing → done, and done leaves after 5 s', async () => {
    const f = fakeRepo(), t = track(f.repo)
    const sent = t.tracker.send('  Lê Hương, 4 suất ', '2026-11-28')
    expect(t.view()).toBe('sending')
    await sent
    expect([t.view(), t.list()[0].transcript]).toEqual(['processing', 'Lê Hương, 4 suất'])
    f.push(row({ status: 'done', result: { op: 'set', customer_name: 'Lê Hương', quantity: 4, delta: -3 } }))
    expect(t.view()).toBe('done')
    vi.advanceTimersByTime(5000)
    t.tracker.prune()
    expect(t.list()).toEqual([])
  })
  it('Given the Assistant is off, Then after 30 s it shows unclaimed, and Bỏ dismisses it (W12, E10)', async () => {
    const f = fakeRepo(), t = track(f.repo)
    await t.tracker.send('x', '2026-11-28')
    vi.advanceTimersByTime(29_999)
    expect(t.view()).toBe('processing')
    vi.advanceTimersByTime(1)
    expect(t.view()).toBe('unclaimed')
    await t.tracker.dismiss(t.list()[0].id)
    expect(f.repo.dismiss).toHaveBeenCalledWith('c1')
    expect(t.list()).toEqual([])
  })
  it('Given the Assistant claimed it first, When Bỏ is tapped, Then it stays and shows the real state', async () => {
    const f = fakeRepo({ dismiss: vi.fn(async () => false), get: vi.fn(async () => [row({ status: 'processing' })]) })
    const t = track(f.repo)
    await t.tracker.send('x', '2026-11-28')
    await t.tracker.dismiss(t.list()[0].id)
    expect(t.list()[0].status).toBe('processing')
  })
  it('Given the result arrives before the insert response, Then it is not lost', async () => {
    let push: (c: VoiceCommand) => void = () => {}
    const t = track(fakeRepo({
      subscribe: (f) => { push = f; return () => {} },
      send: async () => { push(row({ status: 'done', result: {} })); return row() },
    }).repo)
    await t.tracker.send('x', '2026-11-28')
    expect(t.list()[0].status).toBe('done')
  })
  it('Given a late processing event after done, Then it never moves backwards', async () => {
    const f = fakeRepo(), t = track(f.repo)
    await t.tracker.send('x', '2026-11-28')
    f.push(row({ status: 'failed', result: { error: 'not_found' } }))
    f.push(row({ status: 'processing' }))
    expect(t.view()).toBe('failed')
  })
  it('Given the insert fails, Then it says so and is not resent by itself (no duplicate commands)', async () => {
    const send = vi.fn(async () => { throw new Error('offline') })
    const t = track(fakeRepo({ send }).repo)
    await t.tracker.send('x', '2026-11-28')
    expect([t.view(), send.mock.calls.length]).toEqual(['send_failed', 1])
  })
})

describe('result wording (spec v3 §7)', () => {
  const say = (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate('vi', k, p)
  const c = (result: Tracked['result']): Tracked => ({ id: 'l', commandId: 'c', transcript: 'Hương huỷ đơn', date: 'd',
    sentAt: 0, status: 'done', result, finishedAt: 0, shownAt: '' })
  it('Given a set from 7 to 4, Then it says the new total and where it came from', () => {
    const r = resultText(c({ op: 'set', customer_name: 'Lê Hương', quantity: 4, delta: -3 }), 'done', say)
    expect([r.title, r.detail.startsWith('từ 7')]).toEqual(['Lê Hương = 4 suất', true])
  })
  it('Given an ambiguous name, Then both candidates are listed (W7)', () => {
    const r = resultText(c({ error: 'ambiguous', detail: 'Hương', candidates: ['Lê Hương', 'Hương Giang'] }), 'failed', say)
    expect([r.title, r.detail]).toEqual(['“Hương” có 2 người', 'Lê Hương · Hương Giang — nói đủ tên'])
  })
  it('Given not found, cancelled, deleted and not understood, Then each names what happened (W8, W9)', () => {
    expect(resultText(c({ error: 'not_found', detail: 'Minh' }), 'failed', say).title).toBe('Không tìm thấy “Minh”')
    expect(resultText(c({ error: 'not_understood', detail: 'day_word' }), 'failed', say).title).toBe('Chưa hiểu lệnh')
    expect(resultText(c({ op: 'cancel', customer_name: 'Chị Mai', quantity: 0 }), 'done', say).title).toBe('Đã huỷ đơn Chị Mai')
    expect(resultText(c({ op: 'delete', customer_name: 'Chị Mai', quantity: 0 }), 'done', say).title).toBe('Đã xoá đơn Chị Mai')
  })
})

describe('speech (E1, W17)', () => {
  class Fake implements Recognition {
    static last: Fake
    lang = ''; continuous = false; interimResults = false; starts = 0
    onresult: Recognition['onresult'] = null
    onerror: Recognition['onerror'] = null
    onend: Recognition['onend'] = null
    constructor() { Fake.last = this }
    start() { this.starts++ }
    stop() { queueMicrotask(() => this.onend?.()) }
    abort() {}
    say(...parts: [string, boolean][]) {
      this.onresult!({ results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) })
    }
  }
  const events = () => ({ onText: vi.fn(), onError: vi.fn() })

  it('Given no Speech Recognition in the browser, Then there is none to use, so no talk bar', () => {
    expect(speechCtor({})).toBeNull()
    expect(speechCtor({ webkitSpeechRecognition: Fake })).toBe(Fake)
  })
  it('Given final and interim words, When stopped, Then both are sent, in Vietnamese', async () => {
    const s = listen(Fake, events())
    Fake.last.say(['Lê Hương', true], ['4 suất', false])
    expect([Fake.last.lang, await s.stop()]).toEqual(['vi-VN', 'Lê Hương 4 suất'])
  })
  it('Given the browser ends on a pause while still held, Then it listens again and keeps the words', async () => {
    const s = listen(Fake, events())
    Fake.last.say(['Lê Hương', true])
    Fake.last.onend!()
    Fake.last.say(['4 suất', true])
    expect([Fake.last.starts, await s.stop()]).toEqual([2, 'Lê Hương 4 suất'])
  })
  it('Given microphone permission is denied, Then it reports denied and does not restart', () => {
    const e = events()
    listen(Fake, e)
    Fake.last.onerror!({ error: 'not-allowed' })
    Fake.last.onend!()
    expect([e.onError.mock.calls, Fake.last.starts]).toEqual([[['denied']], 1])
  })
})

describe('demo Assistant and voice lines', () => {
  const order = (name: string, qty: number, id = name) => normalize({ id, customer_name: name, delivery_date: '2026-11-28',
    delivered: false, delivered_at: null, created_at: 'c',
    lines: [{ id: `${id}1`, op: 'add', quantity: qty, requested_quantity: qty, message: '', placed_at: '1' }] })
  const run = (transcript: string, orders = [order('Lê Hương', 7), order('Hương Giang', 2)]) =>
    applyDemo(orders, row({ transcript }), '2')

  it('Given the command forms, Then each is read', () => {
    expect(['Lê Hương, 4 suất', 'Lê Hương thêm 2', 'Lê Hương bớt 1', 'Lê Hương, huỷ đơn', 'Lê Hương, xoá đơn']
      .map(s => parseDemo(s)?.op)).toEqual(['set', 'add', 'reduce', 'cancel', 'delete'])
  })
  it('Given an open order of 7, When set to 4, Then a voice line shows =4 on the same order', () => {
    const r = run('lê hương, 4 suất')
    const o = r.orders.find(x => x.id === 'Lê Hương')!
    expect([o.quantity, r.result.delta, lineLabel(o.lines.at(-1)!), o.lines.at(-1)!.source]).toEqual([4, -3, '=4', 'voice'])
  })
  it('Given delete, Then the order leaves the list; given an ambiguous or unknown name, Then nothing changes', () => {
    expect(run('Lê Hương, xoá đơn').orders.map(o => o.id)).toEqual(['Hương Giang'])
    expect(run('Hương, huỷ đơn').result.error).toBe('ambiguous')
    expect(run('Minh bớt 1').result.error).toBe('not_found')
    expect(run('ừ để anh xem').result.error).toBe('not_understood')
  })
  it('Given an order for "Anh Minh", When "Minh Anh, 2 suất" is said, Then it is another customer, not a change to Anh Minh', () => {
    const r = run('Minh Anh, 2 suất', [order('Anh Minh', 8)])
    expect(r.orders.map(o => [o.customer_name, o.quantity])).toEqual([['Anh Minh', 8], ['Minh Anh', 2]])
    expect(run('Minh thêm 1', [order('Anh Minh', 8)]).result.quantity).toBe(9)
  })
  it('Given a walk-in add by voice, Then the row shows the delta and mic, not a plain v1 message (W1)', () => {
    const o = run('Minh, 2 suất', []).orders[0]
    expect([o.quantity, showLines(o)]).toEqual([2, true])
  })
})
