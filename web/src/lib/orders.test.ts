import { describe, expect, it } from 'vitest'
import { normalize, sortOrders, summarize, type Order } from './orders'

const o = (id: string, delivered: boolean, placed_at: string, quantity = 1, created_at = placed_at): Order => normalize({
  id, customer_name: id, delivery_date: '2026-11-21', delivered, delivered_at: null, created_at,
  lines: [{ id: `${id}-1`, op: 'add', quantity, requested_quantity: quantity, message: '', placed_at }],
})

describe('sortOrders', () => {
  it('Given mixed orders, Then undelivered first, each group by placed_at (§5.1)', () => {
    const r = sortOrders([o('a', true, '1'), o('b', false, '3'), o('c', false, '2')])
    expect(r.map(x => x.id)).toEqual(['c', 'b', 'a'])
  })
  it('Given an order backfilled late (inserted after a newer one), Then it still sorts by when the customer placed it', () => {
    const late = o('late', false, '2026-11-21T00:10:00Z', 1, '2026-11-21T05:00:00Z')
    const early = o('early', false, '2026-11-21T02:00:00Z', 1, '2026-11-21T02:00:01Z')
    expect(sortOrders([early, late]).map(x => x.id)).toEqual(['late', 'early'])
  })
})
describe('summarize', () => {
  it('Given one delivered and one pending order, Then it counts total and remaining orders and portions', () => {
    expect(summarize([o('a', true, '1', 5), o('b', false, '2', 2)])).toEqual({ orders: 2, ordersLeft: 1, portions: 7, portionsLeft: 2 })
  })
  it('Given every order delivered, Then nothing remains', () => {
    const s = summarize([o('a', true, '1', 5), o('b', true, '2', 3)])
    expect([s.ordersLeft, s.portionsLeft]).toEqual([0, 0])
  })
})
describe('normalize', () => {
  it('Given an order cached offline in the v1 shape, Then it is read as one add line and keeps its total, message and time', () => {
    const v1 = { id: 'a', customer_name: 'A', delivery_date: '2026-11-21', delivered: false, delivered_at: null,
      created_at: '2026-11-21T05:00:00Z', quantity: 5, message: 'Em 5 suất', placed_at: '2026-11-21T00:10:00Z' }
    const n = normalize(v1)
    expect([n.quantity, n.placed_at, n.lines.length, n.lines[0].op, n.lines[0].message]).toEqual([5, '2026-11-21T00:10:00Z', 1, 'add', 'Em 5 suất'])
  })
  it('Given a v1 cached order without placed_at, Then it shows created_at instead of crashing on an invalid time', () => {
    const n = normalize({ id: 'a', customer_name: 'A', delivery_date: 'd', delivered: false, delivered_at: null, created_at: '2026-11-21T01:00:00Z', quantity: 1 })
    expect(n.placed_at).toBe('2026-11-21T01:00:00Z')
  })
  it('Given a Supabase row with unordered order_lines, Then lines are sorted by time, total is their sum and the row time is the first line', () => {
    const n = normalize({ id: 'a', customer_name: 'A', delivery_date: 'd', delivered: false, delivered_at: null, created_at: 'c',
      order_lines: [
        { id: '2', op: 'reduce', quantity: -2, requested_quantity: 2, message: 'bớt 2', placed_at: '2026-11-21T02:00:00Z' },
        { id: '1', op: 'add', quantity: 5, requested_quantity: 5, message: '5 suất', placed_at: '2026-11-21T01:00:00Z' },
      ] })
    expect([n.quantity, n.placed_at, n.lines.map(l => l.id)]).toEqual([3, '2026-11-21T01:00:00Z', ['1', '2']])
    expect('order_lines' in n).toBe(false)
  })
})
