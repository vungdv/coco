// Run: npx deno test supabase/functions/orders
import { assertEquals } from 'jsr:@std/assert@1'
import { validate } from './validate.ts'

const base = { customer_name: 'Honey', quantity: 2, delivery_date: '2026-11-23' }

Deno.test('Given a minimal valid order without placed_at, Then it passes (placed_at is optional, old callers keep working)', () => {
  assertEquals(validate(base), {})
})
Deno.test('Given placed_at with a +07:00 or Z offset, Then it passes', () => {
  assertEquals(validate({ ...base, placed_at: '2026-11-23T08:05:00+07:00' }), {})
  assertEquals(validate({ ...base, placed_at: '2026-11-23T01:05:00.123Z' }), {})
})
Deno.test('Given placed_at without an offset, Then 422 field error (would be read in the wrong zone)', () => {
  assertEquals(Object.keys(validate({ ...base, placed_at: '2026-11-23T08:05:00' })), ['placed_at'])
})
Deno.test('Given placed_at that is not a date-time, Then field error', () => {
  for (const placed_at of ['2026-11-23', 'yesterday', 1763859900, '2026-13-45T08:05:00Z']) {
    assertEquals(Object.keys(validate({ ...base, placed_at })), ['placed_at'])
  }
})
Deno.test('Given missing name, bad quantity and bad date, Then each field is reported (S21)', () => {
  assertEquals(Object.keys(validate({ quantity: 0, delivery_date: 'x' })).sort(), ['customer_name', 'delivery_date', 'quantity'])
})

// spec v2 §4: adjustments
Deno.test('Given a v1 body without op, Then it is an add and still valid (old callers keep working)', () => {
  assertEquals(validate({ ...base }), {})
})
Deno.test('Given reduce/set by customer_id only, Then valid (name only needed to create an order)', () => {
  assertEquals(validate({ op: 'reduce', quantity: 2, customer_id: 'zalo:1', delivery_date: '2026-11-23' }), {})
  assertEquals(validate({ op: 'set', quantity: 0, customer_name: 'Lan', delivery_date: '2026-11-23' }), {})
})
Deno.test('Given cancel without quantity, Then valid; with a quantity, Then field error (ambiguous intent)', () => {
  assertEquals(validate({ op: 'cancel', customer_name: 'Lan', delivery_date: '2026-11-23' }), {})
  assertEquals(Object.keys(validate({ op: 'cancel', quantity: 2, customer_name: 'Lan', delivery_date: '2026-11-23' })), ['quantity'])
})
Deno.test('Given reduce 0 or set -1, Then quantity error (reduce must remove something, set cannot go negative)', () => {
  assertEquals(Object.keys(validate({ ...base, op: 'reduce', quantity: 0 })), ['quantity'])
  assertEquals(Object.keys(validate({ ...base, op: 'set', quantity: -1 })), ['quantity'])
})
Deno.test('Given an unknown op, Then op error', () => {
  assertEquals(Object.keys(validate({ ...base, op: 'double' })), ['op'])
})
Deno.test('Given an add with only customer_id, Then customer_name is required (the kitchen needs a name to show)', () => {
  assertEquals(Object.keys(validate({ quantity: 1, customer_id: 'zalo:1', delivery_date: '2026-11-23' })), ['customer_name'])
})
Deno.test('Given a reduce with neither name nor id, Then customer_name error', () => {
  assertEquals(Object.keys(validate({ op: 'reduce', quantity: 1, delivery_date: '2026-11-23' })), ['customer_name'])
})

// spec v3 §6: delete
Deno.test('Given delete without a quantity, Then valid; with one, a field error, so a delete is never a partial change', () => {
  const del = { op: 'delete', customer_id: 'zalo:1', delivery_date: '2026-11-28' }
  assertEquals(validate(del), {})
  assertEquals(Object.keys(validate({ ...del, quantity: 1 })), ['quantity'])
})
