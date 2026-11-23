import { describe, expect, it } from 'vitest'
import { addDays, formatLong, formatTime, formatParts, isValidDate, todayVN } from './date'

describe('todayVN', () => {
  it('Given 17:30 UTC on 21 Nov, When computing today, Then Vietnam is already 22 Nov (S5)', () => {
    expect(todayVN(new Date('2026-11-21T17:30:00Z'))).toBe('2026-11-22')
  })
})
describe('formatLong', () => {
  it('Given 2026-11-21, Then long English format (S3)', () => {
    expect(formatLong('2026-11-21')).toBe('Saturday, November 21, 2026')
  })
  it('Given 2026-11-21 and the vi-VN locale, Then long Vietnamese format', () => {
    expect(formatLong('2026-11-21', 'vi-VN')).toBe('Thứ Bảy, 21 tháng 11, 2026')
  })
})
describe('isValidDate', () => {
  it('rejects malformed values that could come from the URL', () => {
    expect(isValidDate('2026-13-45')).toBe(false)
    expect(isValidDate('abc')).toBe(false)
    expect(isValidDate('2026-11-21')).toBe(true)
  })
})
describe('addDays', () => {
  it('Given a date, When stepping to the next/previous day, Then it crosses month and year boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })
  it('Given a leap year, When stepping past 28 Feb, Then 29 Feb is not skipped', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
})
describe('formatParts', () => {
  it('Given 2026-11-23, Then weekday and short day fit a 375px header', () => {
    expect(formatParts('2026-11-23')).toEqual({ weekday: 'Monday', day: 'Nov 23, 2026' })
  })
  it('Given 2026-11-23 and the vi-VN locale, Then Vietnamese weekday and day-first short date', () => {
    expect(formatParts('2026-11-23', 'vi-VN')).toEqual({ weekday: 'Thứ Hai', day: '23 thg 11, 2026' })
  })
})
describe('formatTime', () => {
  it('Given a UTC timestamp, When showing order time, Then it is HH:mm in Vietnam time (not device/UTC)', () => {
    expect(formatTime('2026-11-23T01:05:00Z')).toBe('08:05')
  })
  it('Given 17:00 UTC, Then midnight renders as 00:00, not 24:00', () => {
    expect(formatTime('2026-11-23T17:00:00Z')).toBe('00:00')
  })
})
