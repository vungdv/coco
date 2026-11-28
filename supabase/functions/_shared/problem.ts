// JSON and Problem Details (RFC 7807) responses shared by the Edge Functions.

export const problem = (status: number, title: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title, status, ...extra }), {
    status, headers: { 'content-type': 'application/problem+json', ...headers },
  })
export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
