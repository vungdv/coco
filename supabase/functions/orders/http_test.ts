// Run: npx deno test supabase/functions/orders
import { assertEquals } from 'jsr:@std/assert@1'
import { respond } from './http.ts'

const order = { id: 'o1', quantity: 5 }, line = { id: 'l1', quantity: 5 }

Deno.test('Given a new line was stored, Then 201 with the order total and the line (V1)', async () => {
  const r = respond({ status: 'created', order, line })
  assertEquals(r.status, 201)
  assertEquals(await r.json(), { id: 'o1', quantity: 5, line })
})
Deno.test('Given a replay of the same message key, Then 200 and the stored line, so a retrying reader is safe (V5)', () => {
  assertEquals(respond({ status: 'replayed', order, line }).status, 200)
})
Deno.test('Given the same key with different content, Then 409 Problem Details instead of silently rewriting history (V5, D4)', async () => {
  const r = respond({ status: 'conflict', order, line })
  assertEquals([r.status, r.headers.get('content-type')], [409, 'application/problem+json'])
  assertEquals((await r.json()).error, 'idempotency_conflict')
})
