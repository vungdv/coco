// Run: npx deno test supabase/functions
import { assertEquals } from 'jsr:@std/assert@1'
import { handle, validateOutcome, type CommandStore } from './handler.ts'
import { traceOf } from './trace.ts'

const ID = '11111111-2222-3333-4444-555555555555'
const BASE = 'http://x/voice-commands'
const done = { op: 'set', order_id: 'o1', customer_name: 'Lê Hương', quantity: 4, delta: -3 }

const store = (over: Partial<CommandStore> = {}): CommandStore => ({
  claim: () => Promise.resolve(null),
  finish: (id) => Promise.resolve({ id }),
  ...over,
})
const patch = (body: unknown, id = ID) =>
  new Request(`${BASE}/${id}`, { method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body) })
const claim = () => new Request(`${BASE}/claim`, { method: 'POST' })

// Main scenarios
Deno.test('Given a queued command, When claim is called, Then 200 with the command and that day\'s orders', async () => {
  const claimed = { command: { id: ID }, orders: [] }
  const r = await handle(claim(), store({ claim: () => Promise.resolve(claimed) }))
  assertEquals([r.status, await r.json()], [200, claimed])
})
Deno.test('Given nothing queued, When claim is called, Then 204 so the Assistant just waits', async () => {
  assertEquals((await handle(claim(), store())).status, 204)
})
Deno.test('Given a processing command, When PATCHed done or failed, Then 200 and the outcome is stored as sent', async () => {
  for (const body of [{ status: 'done', result: done },
    { status: 'failed', result: { error: 'ambiguous', candidates: ['Lê Hương', 'Hương Giang'] } }]) {
    let stored: unknown
    const r = await handle(patch(body), store({ finish: (id, status, result) => {
      stored = [id, status, result]
      return Promise.resolve({ id })
    } }))
    assertEquals([r.status, stored], [200, [ID, body.status, body.result]])
  }
})

// Edge cases and errors
Deno.test('Given the full gateway path, Then routing still works', async () => {
  const r = await handle(new Request('http://x/functions/v1/voice-commands/claim', { method: 'POST' }), store())
  assertEquals(r.status, 204)
})
Deno.test('Given a command that is not processing, Then 409 Problem Details, so a late run drops its result (V9)', async () => {
  const r = await handle(patch({ status: 'done', result: done }), store({ finish: () => Promise.resolve(null) }))
  assertEquals([r.status, r.headers.get('content-type'), (await r.json()).error],
    [409, 'application/problem+json', 'not_processing'])
})
Deno.test('Given a wrong method, Then 405 with Allow', async () => {
  const a = await handle(new Request(`${BASE}/claim`), store())
  const b = await handle(new Request(`${BASE}/${ID}`, { method: 'POST' }), store())
  assertEquals([a.status, a.headers.get('allow'), b.status, b.headers.get('allow')], [405, 'POST', 405, 'PATCH'])
})
Deno.test('Given an unknown path or a non-uuid id, Then 404 without touching the store', async () => {
  for (const url of [BASE, `${BASE}/nope`]) {
    assertEquals((await handle(new Request(url, { method: 'PATCH' }), store())).status, 404)
  }
})
Deno.test('Given malformed JSON, Then 400; given a bad body, Then 422 and nothing is stored', async () => {
  const never = store({ finish: () => { throw new Error('must not be called') } })
  assertEquals((await handle(patch('{'), never)).status, 400)
  assertEquals((await handle(patch({ status: 'queued', result: {} }), never)).status, 422)
})
Deno.test('Given incomplete results, Then each missing field is reported, so the web can always render the result', () => {
  assertEquals(Object.keys(validateOutcome({ status: 'done', result: {} })).sort(),
    ['result.customer_name', 'result.delta', 'result.op', 'result.order_id', 'result.quantity'])
  assertEquals(Object.keys(validateOutcome({ status: 'failed', result: { error: 'oops', candidates: 'x' } })),
    ['result.error', 'result.candidates'])
  assertEquals(Object.keys(validateOutcome(null)), ['body'])
})

// Telemetry
Deno.test('Given a traceparent, Then its trace id is kept; otherwise a new one is made', () => {
  const trace = 'a'.repeat(32)
  assertEquals(traceOf(new Request(BASE, { headers: { traceparent: `00-${trace}-${'b'.repeat(16)}-01` } })).trace_id, trace)
  assertEquals(traceOf(new Request(BASE)).trace_id.length, 32)
})
