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
