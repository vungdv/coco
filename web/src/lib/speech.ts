// Browser speech to text (Web Speech API, vi-VN), as in the voice-to-text spike (spec v3 E1).

interface RecognitionResult { readonly isFinal: boolean; readonly 0: { transcript: string } }
export interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => Recognition

export function speechCtor(w: unknown = globalThis): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null
}

export type SpeechError = 'denied' | 'failed'

export interface SpeechEvents {
  onText(finalText: string, interim: string): void
  onError(error: SpeechError): void
}

const join = (...parts: string[]) => parts.map(p => p.trim()).filter(Boolean).join(' ')
const STOP_TIMEOUT_MS = 2_000

/** One hold of the talk bar: listens until stop() or abort(). */
export function listen(Ctor: RecognitionCtor, events: SpeechEvents) {
  let kept = '' // text from earlier recognition sessions of this hold
  let finalText = ''
  let interim = ''
  let over = false
  let done: ((text: string) => void) | null = null
  const rec = new Ctor()
  rec.lang = 'vi-VN'
  rec.continuous = true
  rec.interimResults = true

  const text = () => join(kept, finalText, interim)
  const finish = () => { over = true; done?.(text()); done = null }

  rec.onresult = (e) => {
    const finals: string[] = [], pending: string[] = []
    // rebuilt from the whole list each time: Android Chrome repeats results if they are appended by index
    for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? finals : pending).push(e.results[i][0].transcript)
    finalText = join(...finals)
    interim = join(...pending)
    events.onText(join(kept, finalText), interim)
  }
  rec.onerror = ({ error }) => {
    if (error === 'no-speech' || error === 'aborted') return
    over = true
    events.onError(error === 'not-allowed' || error === 'service-not-allowed' ? 'denied' : 'failed')
  }
  rec.onend = () => {
    if (done || over) { finish(); return }
    // Safari ends on a pause while the chef still holds the bar: keep what was heard and listen again
    kept = text()
    finalText = interim = ''
    try { rec.start() } catch { over = true }
  }

  try { rec.start() } catch { over = true; events.onError('failed') }

  return {
    /** Stop listening and resolve with everything heard, including words still being recognised. */
    stop(): Promise<string> {
      if (over) return Promise.resolve(text())
      return new Promise((resolve) => {
        const timer = setTimeout(() => finish(), STOP_TIMEOUT_MS) // some browsers never fire onend
        done = (t) => { clearTimeout(timer); resolve(t) }
        rec.stop()
      })
    },
    abort() { over = true; rec.abort() },
  }
}
