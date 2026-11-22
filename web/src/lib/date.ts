export const TZ = 'Asia/Ho_Chi_Minh'

/** Today's date (YYYY-MM-DD) in Vietnam, never UTC (S5). */
export function todayVN(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function isValidDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
}

/** e.g. "Saturday, November 21, 2026" */
export function formatLong(date: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: TZ }).format(new Date(`${date}T12:00:00+07:00`))
}
