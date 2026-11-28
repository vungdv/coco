// HTTP mapping for the Order API (RFC 7807 problems, spec v2 §4, spec v3 §6). Pure: unit tested.
import { json, problem } from '../_shared/problem.ts'
export { problem }

export type PlaceResult = { status: 'created' | 'replayed' | 'conflict' | 'no_open_order'; order: Record<string, unknown> | null; line: Record<string, unknown> | null }

/** Map the DB outcome to HTTP (spec v2 §4): 201 new line, 200 replay, 409 idempotency conflict / nothing to adjust. */
export function respond({ status, order, line }: PlaceResult): Response {
  if (status === 'conflict') return problem(409, 'Conflict', {
    error: 'idempotency_conflict', detail: 'external_id was already used with different content', order, line })
  if (status === 'no_open_order') return problem(409, 'Conflict', {
    error: 'no_open_order', detail: 'this customer has no open order for that delivery_date to adjust' })
  // spec v3 §6: a delete answers 200, because the order it returns is gone from the list
  return json(status === 'created' && line?.op !== 'delete' ? 201 : 200, { ...order, line })
}
