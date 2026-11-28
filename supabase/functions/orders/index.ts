// Order API for other systems. Auth: x-api-key (SHA-256 compared against api_keys).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { apiKeyAuth } from '../_shared/auth.ts'
import { validate } from './validate.ts'
import { problem, respond, type PlaceResult } from './http.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const authenticate = apiKeyAuth(db, 60)

Deno.serve(async (req) => {
  if (req.method !== 'POST') return problem(405, 'Method Not Allowed', {}, { allow: 'POST' })

  const auth = await authenticate(req)
  if (auth instanceof Response) return auth

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
  await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.keyId)
  return respond(data as PlaceResult)
})
