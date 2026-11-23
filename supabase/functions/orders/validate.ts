// Request validation for the Order API (S21). Pure: no I/O, so it can be unit tested.

// RFC 3339 date-time with an explicit offset; a zone-less time would be read in the server's zone.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i

export function validate(b: Record<string, unknown>) {
  const f: Record<string, string> = {}
  if (typeof b.customer_name !== 'string' || !b.customer_name.trim()) f.customer_name = 'required'
  if (!Number.isInteger(b.quantity) || (b.quantity as number) <= 0) f.quantity = 'must be a positive integer'
  if (typeof b.delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date) ||
      Number.isNaN(Date.parse(b.delivery_date))) f.delivery_date = 'must be YYYY-MM-DD'
  if (b.message !== undefined && (typeof b.message !== 'string' || b.message.length > 2000)) f.message = 'max 2000 characters'
  if (b.external_id !== undefined && b.external_id !== null && typeof b.external_id !== 'string') f.external_id = 'must be a string'
  if (b.source !== undefined && (typeof b.source !== 'string' || !b.source)) f.source = 'must be a non-empty string'
  if (b.placed_at !== undefined && (typeof b.placed_at !== 'string' || !DATE_TIME.test(b.placed_at) ||
      Number.isNaN(Date.parse(b.placed_at)))) f.placed_at = 'must be an RFC 3339 date-time with offset'
  return f
}
