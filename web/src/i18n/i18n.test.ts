import { describe, expect, it } from 'vitest'
import { detectLocale, translate } from './index'
import { en, vi } from './messages'

describe('translate', () => {
  it('Given Vietnamese is active, When translating a key, Then the Vietnamese string is returned', () => {
    expect(translate('vi', 'app.empty')).toBe('Không có đơn nào trong ngày này.')
    expect(translate('en', 'app.empty')).toBe('No orders for this day.')
  })
  it('Given a message with a {name} placeholder, When translating with params, Then the value is filled in', () => {
    expect(translate('en', 'orders.markDelivered', { name: 'Chị Lan' })).toBe('Mark Chị Lan delivered')
    expect(translate('vi', 'orders.markDelivered', { name: 'Chị Lan' })).toBe('Đánh dấu đã giao cho Chị Lan')
  })
  it('Given a param is missing, Then the placeholder is left visible rather than rendering "undefined"', () => {
    expect(translate('en', 'app.pickDate')).toBe('Pick date, currently {date}')
  })
})

describe('catalogs', () => {
  it('Given the English key set, Then Vietnamese translates every key with a non-empty string (no silent English fallback)', () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort())
    for (const v of Object.values(vi)) expect(v.trim()).not.toBe('')
  })
  it('Given a message has placeholders, Then the Vietnamese version uses the same placeholders', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(vi[k])).toEqual(ph(en[k]))
  })
})

describe('detectLocale', () => {
  it('Given a saved choice, Then it wins over the browser language', () => {
    expect(detectLocale('en', ['vi-VN'])).toBe('en')
  })
  it('Given no saved choice and a Vietnamese browser, Then Vietnamese is used', () => {
    expect(detectLocale(null, ['vi-VN', 'en-US'])).toBe('vi')
  })
  it('Given browser languages in preference order, Then the first supported one is used', () => {
    expect(detectLocale(null, ['fr-FR', 'en-GB', 'vi'])).toBe('en')
  })
  it('Given a corrupted saved value and an unsupported browser language, Then it falls back to English', () => {
    expect(detectLocale('xx', ['ja-JP'])).toBe('en')
  })
})
