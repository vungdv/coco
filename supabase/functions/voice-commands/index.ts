// Voice Command API for the Assistant (spec v3 §6). Auth: x-api-key.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { apiKeyAuth } from '../_shared/auth.ts'
import { problem } from '../_shared/problem.ts'
import { handle, type CommandStore } from './handler.ts'
import { traceOf } from './trace.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const authenticate = apiKeyAuth(db, 120) // polling every 2 s is 30/min, plus one PATCH per command

async function rpc(fn: string, args?: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn} ${error.code}`)
  return data
}

const store: CommandStore = {
  claim: () => rpc('claim_voice_command'),
  finish: (p_id, p_status, p_result) => rpc('finish_voice_command', { p_id, p_status, p_result }),
}

Deno.serve(async (req) => {
  const trace = traceOf(req), started = Date.now()
  let res: Response, error: string | undefined
  try {
    const auth = await authenticate(req)
    res = auth instanceof Response ? auth : await handle(req, store)
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    res = problem(500, 'Internal Server Error')
  }
  if (res.status !== 204) { // idle polls would drown the log
    console.log(JSON.stringify({ event: 'voice_command_api', method: req.method, status: res.status,
      latency_ms: Date.now() - started, error, ...trace }))
  }
  return res
})
