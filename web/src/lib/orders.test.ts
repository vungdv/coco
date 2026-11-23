import { describe, expect, it } from 'vitest'
import { sortOrders, summarize, withPlacedAt, type Order } from './orders'

const o = (id: string, delivered: boolean, placed_at: string, quantity = 1, created_at = placed_at): Order => ({
  id, customer_name: id, quantity, message: '', delivery_date: '2026-11-21', delivered, delivered_at: null, created_at, placed_at,
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
describe('withPlacedAt', () => {
  it('Given an order cached offline before placed_at existed, Then it shows created_at instead of crashing on an invalid time', () => {
    const { placed_at: _, ...old } = o('a', false, 'x', 1, '2026-11-21T01:00:00Z')
    expect(withPlacedAt([old])[0].placed_at).toBe('2026-11-21T01:00:00Z')
  })
  it('Given an order that has placed_at, Then it is kept', () => {
    expect(withPlacedAt([o('a', false, '2026-11-21T00:10:00Z', 1, '2026-11-21T05:00:00Z')])[0].placed_at).toBe('2026-11-21T00:10:00Z')
  })
})
