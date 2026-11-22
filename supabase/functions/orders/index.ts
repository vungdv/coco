// Order API for other systems. Auth: x-api-key (SHA-256 compared against api_keys).
import { createClient } from 'npm:@supabase/supabase-js@2'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const hits = new Map<string, { n: number; t: number }>() // best-effort per-isolate rate limit (S25)

const problem = (status: number, title: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}) =>
  new Response(JSON.stringify({ type: 'about:blank', title, status, ...extra }), {
    status, headers: { 'content-type': 'application/problem+json', ...headers },
  })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function validate(b: Record<string, unknown>) {
  const f: Record<string, string> = {}
  if (typeof b.customer_name !== 'string' || !b.customer_name.trim()) f.customer_name = 'required'
  if (!Number.isInteger(b.quantity) || (b.quantity as number) <= 0) f.quantity = 'must be a positive integer'
  if (typeof b.delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.delivery_date) ||
      Number.isNaN(Date.parse(b.delivery_date))) f.delivery_date = 'must be YYYY-MM-DD'
  if (b.message !== undefined && (typeof b.message !== 'string' || b.message.length > 2000)) f.message = 'max 2000 characters'
  if (b.external_id !== undefined && b.external_id !== null && typeof b.external_id !== 'string') f.external_id = 'must be a string'
  if (b.source !== undefined && (typeof b.source !== 'string' || !b.source)) f.source = 'must be a non-empty string'
  return f
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return problem(405, 'Method Not Allowed', {}, { allow: 'POST' })

  const key = req.headers.get('x-api-key')
  if (!key) return problem(401, 'Unauthorized')
  const hash = await sha256(key)
  const { data: k } = await db.from('api_keys').select('id, revoked_at').eq('key_hash', hash).maybeSingle()
  if (!k || k.revoked_at) return problem(401, 'Unauthorized')

  const now = Date.now(), h = hits.get(k.id)
  if (!h || now - h.t > 60_000) hits.set(k.id, { n: 1, t: now })
  else if (++h.n > 60) return problem(429, 'Too Many Requests', {}, { 'retry-after': '60' })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return problem(400, 'Malformed JSON') }
  const fields = validate(body ?? {})
  if (Object.keys(fields).length) return problem(422, 'Validation failed', { error: 'validation_failed', fields })

  const row = {
    source: (body.source as string | undefined) ?? 'api',
    external_id: (body.external_id as string | null | undefined) ?? null,
    customer_name: (body.customer_name as string).trim(),
    quantity: body.quantity as number,
    message: (body.message as string | undefined) ?? '',
    delivery_date: body.delivery_date as string,
  } // `delivered` is intentionally never written here (S18, S23)

  let existed = false
  if (row.external_id) {
    const { data } = await db.from('orders').select('id').eq('source', row.source).eq('external_id', row.external_id).maybeSingle()
    existed = !!data
  }
  const { data, error } = await db.from('orders').upsert(row, { onConflict: 'source,external_id' }).select().single()
  if (error) return problem(500, 'Internal Server Error')
  await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id)
  return json(existed ? 200 : 201, data)
})
