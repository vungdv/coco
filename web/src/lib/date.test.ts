import { describe, expect, it } from 'vitest'
import { formatLong, isValidDate, todayVN } from './date'

describe('todayVN', () => {
  it('Given 17:30 UTC on 21 Nov, When computing today, Then Vietnam is already 22 Nov (S5)', () => {
    expect(todayVN(new Date('2026-11-21T17:30:00Z'))).toBe('2026-11-22')
  })
})
describe('formatLong', () => {
  it('Given 2026-11-21, Then long English format (S3)', () => {
    expect(formatLong('2026-11-21')).toBe('Saturday, November 21, 2026')
  })
})
describe('isValidDate', () => {
  it('rejects malformed values that could come from the URL', () => {
    expect(isValidDate('2026-13-45')).toBe(false)
    expect(isValidDate('abc')).toBe(false)
    expect(isValidDate('2026-11-21')).toBe(true)
  })
})
