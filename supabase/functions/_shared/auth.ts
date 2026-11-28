// x-api-key authentication for integrations: SHA-256 compared against api_keys, with a rate limit.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { problem } from './problem.ts'

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Returns the check for one function: it yields the key's id, or the 401/429 response to send. */
export function apiKeyAuth(db: SupabaseClient, perMinute: number) {
  const hits = new Map<string, { n: number; t: number }>() // best-effort per-isolate rate limit (S25)
  return async (req: Request): Promise<{ keyId: string } | Response> => {
    const key = req.headers.get('x-api-key')
    if (!key) return problem(401, 'Unauthorized')
    const { data: k } = await db.from('api_keys').select('id, revoked_at').eq('key_hash', await sha256(key)).maybeSingle()
    if (!k || k.revoked_at) return problem(401, 'Unauthorized')

    const now = Date.now(), h = hits.get(k.id)
    if (!h || now - h.t > 60_000) hits.set(k.id, { n: 1, t: now })
    else if (++h.n > perMinute) return problem(429, 'Too Many Requests', {}, { 'retry-after': '60' })
    return { keyId: k.id as string }
  }
}
