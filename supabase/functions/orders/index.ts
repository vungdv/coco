// Order API for other systems. Auth: x-api-key (SHA-256 compared against api_keys).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { validate } from './validate.ts'
import { problem, respond, type PlaceResult } from './http.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const hits = new Map<string, { n: number; t: number }>() // best-effort per-isolate rate limit (S25)

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
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

  // All writes go through one transactional DB function (spec v2 §3): lock, find/create the open order, append a line.
  const { data, error } = await db.rpc('place_order_line', {
    p_delivery_date: body.delivery_date as string,
    p_op: (body.op as string | undefined) ?? 'add',
    p_quantity: (body.quantity as number | undefined) ?? null,
    p_customer_name: (body.customer_name as string | undefined)?.trim() ?? null,
    p_customer_id: (body.customer_id as string | undefined)?.trim() ?? null,
    p_source: (body.source as string | undefined) ?? 'api',
    p_external_id: (body.external_id as string | null | undefined) ?? null,
    p_message: (body.message as string | undefined) ?? '',
    // omitted -> now() on create; ignored when comparing a replay
    p_placed_at: body.placed_at === undefined ? null : new Date(body.placed_at as string).toISOString(),
  }) // `delivered` is never written here (S23)
  if (error) return problem(500, 'Internal Server Error')
  await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', k.id)
  return respond(data as PlaceResult)
})
