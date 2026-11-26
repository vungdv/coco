// HTTP mapping for the Order API (RFC 7807 problems, spec v2 §4). Pure: unit tested.

export const problem = (status: number, title: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title, status, ...extra }), {
    status, headers: { 'content-type': 'application/problem+json', ...headers },
  })
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export type PlaceResult = { status: 'created' | 'replayed' | 'conflict'; order: Record<string, unknown>; line: unknown }

/** Map the DB outcome to HTTP (spec v2 §4): 201 new line, 200 replay, 409 idempotency conflict. */
export function respond({ status, order, line }: PlaceResult): Response {
  if (status === 'conflict') return problem(409, 'Conflict', {
    error: 'idempotency_conflict', detail: 'external_id was already used with different content', order, line })
  return json(status === 'created' ? 201 : 200, { ...order, line })
}
