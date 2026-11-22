import { describe, expect, it } from 'vitest'
import { sortOrders, summarize, type Order } from './orders'

const o = (id: string, delivered: boolean, created_at: string, quantity = 1): Order => ({
  id, customer_name: id, quantity, message: '', delivery_date: '2026-11-21', delivered, delivered_at: null, created_at,
})

describe('sortOrders', () => {
  it('Given mixed orders, Then undelivered first, each group by created_at (§5.1)', () => {
    const r = sortOrders([o('a', true, '1'), o('b', false, '3'), o('c', false, '2')])
    expect(r.map(x => x.id)).toEqual(['c', 'b', 'a'])
  })
})
describe('summarize', () => {
  it('counts orders, portions and delivered', () => {
    expect(summarize([o('a', true, '1', 5), o('b', false, '2', 2)])).toEqual({ orders: 2, portions: 7, delivered: 1 })
  })
})
