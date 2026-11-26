// Request validation for the Order API (v1 S21, spec v2 §4). Pure: no I/O, so it can be unit tested.

// RFC 3339 date-time with an explicit offset; a zone-less time would be read in the server's zone.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i

export const OPS = ['add', 'reduce', 'set', 'cancel'] as const
export type Op = typeof OPS[number]

export function validate(b: Record<string, unknown>) {
  const f: Record<string, string> = {}
  const op = b.op ?? 'add'
  if (!OPS.includes(op as Op)) f.op = `must be one of ${OPS.join(', ')}`
  const hasName = typeof b.customer_name === 'string' && !!b.customer_name.trim()
  if (b.customer_name !== undefined && !hasName) f.customer_name = 'must be a non-empty string'
  if (b.customer_id !== undefined && (typeof b.customer_id !== 'string' || !b.customer_id.trim())) f.customer_id = 'must be a non-empty string'
  if (op === 'add' && !hasName) f.customer_name = 'required'
  else if (!hasName && b.customer_id === undefined) f.customer_name = 'customer_name or customer_id is required'
  const q = b.quantity as number
  if (op === 'cancel') { if (b.quantity !== undefined && b.quantity !== null) f.quantity = 'must be omitted for cancel' }
  else if (op === 'set') { if (!Number.isInteger(q) || q < 0) f.quantity = 'must be a non-negative integer' }
  else if (!Number.isInteger(q) || q <= 0) f.quantity = 'must be a positive integer'
  if (typeof b.delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date) ||
      Number.isNaN(Date.parse(b.delivery_date))) f.delivery_date = 'must be YYYY-MM-DD'
  if (b.message !== undefined && (typeof b.message !== 'string' || b.message.length > 2000)) f.message = 'max 2000 characters'
  if (b.external_id !== undefined && b.external_id !== null && typeof b.external_id !== 'string') f.external_id = 'must be a string'
  if (b.source !== undefined && (typeof b.source !== 'string' || !b.source)) f.source = 'must be a non-empty string'
  if (b.placed_at !== undefined && (typeof b.placed_at !== 'string' || !DATE_TIME.test(b.placed_at) ||
      Number.isNaN(Date.parse(b.placed_at)))) f.placed_at = 'must be an RFC 3339 date-time with offset'
  return f
}
