// Voice Command API (spec v3 §6): routing, validation and HTTP mapping. No I/O of its own: the store is injected.
import { json, problem } from '../_shared/problem.ts'

export interface CommandStore {
  /** Claim the next command, or null when there is none. */
  claim(): Promise<unknown | null>
  /** Record an outcome, or null when the command is not processing. */
  finish(id: string, status: 'done' | 'failed', result: Record<string, unknown>): Promise<unknown | null>
}

export const ERRORS = ['not_understood', 'not_found', 'ambiguous', 'no_open_order', 'order_api_error', 'assistant_error']
const OPS = ['add', 'reduce', 'set', 'cancel', 'delete']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown) => typeof v === 'string' && !!v.trim()

export function validateOutcome(b: unknown) {
  const f: Record<string, string> = {}
  if (!isObject(b)) return { body: 'must be a JSON object' } as Record<string, string>
  if (b.status !== 'done' && b.status !== 'failed') f.status = 'must be done or failed'
  const r = b.result
  if (!isObject(r)) {
    f.result = 'must be an object'
  } else if (b.status === 'done') {
    if (!OPS.includes(r.op as string)) f['result.op'] = `must be one of ${OPS.join(', ')}`
    if (!isText(r.order_id)) f['result.order_id'] = 'required'
    if (!isText(r.customer_name)) f['result.customer_name'] = 'required'
    if (!Number.isInteger(r.quantity)) f['result.quantity'] = 'must be an integer'
    if (!Number.isInteger(r.delta)) f['result.delta'] = 'must be an integer'
  } else if (b.status === 'failed') {
    if (!ERRORS.includes(r.error as string)) f['result.error'] = `must be one of ${ERRORS.join(', ')}`
    if (r.candidates !== undefined && !(Array.isArray(r.candidates) && r.candidates.every(isText))) {
      f['result.candidates'] = 'must be a list of names'
    }
  }
  return f
}

export async function handle(req: Request, store: CommandStore): Promise<Response> {
  // The gateway may or may not keep the /functions/v1 prefix: route on what follows the function name.
  const path = new URL(req.url).pathname.split('/voice-commands')[1] ?? ''
  const target = path.replace(/^\/|\/$/g, '')

  if (target === 'claim') {
    if (req.method !== 'POST') return problem(405, 'Method Not Allowed', {}, { allow: 'POST' })
    const claimed = await store.claim()
    return claimed ? json(200, claimed) : new Response(null, { status: 204 })
  }

  if (!UUID.test(target)) return problem(404, 'Not Found')
  if (req.method !== 'PATCH') return problem(405, 'Method Not Allowed', {}, { allow: 'PATCH' })
  let body: unknown
  try { body = await req.json() } catch { return problem(400, 'Malformed JSON') }
  const fields = validateOutcome(body)
  if (Object.keys(fields).length) return problem(422, 'Validation failed', { error: 'validation_failed', fields })

  const { status, result } = body as { status: 'done' | 'failed'; result: Record<string, unknown> }
  const command = await store.finish(target, status, result)
  return command
    ? json(200, command)
    : problem(409, 'Conflict', { error: 'not_processing', detail: 'this command is not being processed' })
}
