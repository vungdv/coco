// W3C Trace Context and one structured log line per request. Never logs transcripts or names.
const TRACEPARENT = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, '0')).join('')

/** The caller's trace id (a new one when it sent none) and a span id for this request. */
export function traceOf(req: Request) {
  return { trace_id: TRACEPARENT.exec(req.headers.get('traceparent') ?? '')?.[1] ?? hex(16), span_id: hex(8) }
}
