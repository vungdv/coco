<script setup lang="ts">
// Hold to talk (spec v3 E9, §7): holding listens, releasing sends, sliding left cancels.
import { onBeforeUnmount, ref } from 'vue'
import ListeningBubble from './ListeningBubble.vue'
import MicIcon from './MicIcon.vue'
import { listen, type RecognitionCtor, type SpeechError } from '../lib/speech'
import { MAX_HOLD_MS, MIN_HOLD_MS, releaseOutcome, slidToCancel } from '../lib/voice'
import { formatShortDay } from '../lib/date'
import { intlTag, locale, t } from '../i18n'

const props = defineProps<{ speech: RecognitionCtor; date: string; disabled: boolean }>()
const emit = defineEmits<{ send: [transcript: string, date: string]; hint: []; error: [error: SpeechError] }>()

const holding = ref(false)
const cancelling = ref(false)
const finalText = ref('')
const interim = ref('')
const seconds = ref(0)
let session: ReturnType<typeof listen> | null = null
let startedAt = 0
let startX = 0
let date = ''
let cap: ReturnType<typeof setTimeout>
let clock: ReturnType<typeof setInterval>

function start(x: number) {
  if (holding.value || props.disabled) return
  holding.value = true
  cancelling.value = false
  finalText.value = interim.value = ''
  seconds.value = 0
  startedAt = Date.now()
  startX = x
  date = props.date // the date on screen when the chef started talking (E4)
  session = listen(props.speech, {
    onText: (f, i) => { finalText.value = f; interim.value = i },
    onError: (e) => { end(); emit('error', e) },
  })
  cap = setTimeout(release, MAX_HOLD_MS)
  clock = setInterval(() => seconds.value++, 1000)
}

/** Leaves the holding state and hands back the session still to be stopped. */
function end() {
  clearTimeout(cap)
  clearInterval(clock)
  holding.value = false
  const s = session
  session = null
  return s
}

async function release() {
  if (!holding.value) return
  const held = Date.now() - startedAt
  const slid = cancelling.value
  const day = date
  const s = end()
  if (!s) return
  if (slid || held < MIN_HOLD_MS) {
    s.abort()
    if (!slid) emit('hint')
    return
  }
  const text = await s.stop()
  const outcome = releaseOutcome(held, slid, text)
  if (outcome === 'send') emit('send', text, day)
  else emit('hint')
}

function cancel() { end()?.abort() }

function down(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  start(e.clientX)
}
function move(e: PointerEvent) { if (holding.value) cancelling.value = slidToCancel(startX, e.clientX) }
function keydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel()
  else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(0) }
}
function keyup(e: KeyboardEvent) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release() } }

onBeforeUnmount(cancel)
</script>

<template>
  <div v-if="holding" class="dim" aria-hidden="true" />
  <div class="talk">
    <ListeningBubble v-if="holding" :date-label="formatShortDay(date, intlTag[locale])" :final-text="finalText"
      :interim="interim" :cancelling="cancelling" />
    <button type="button" class="talkbar" :class="{ holding, cancelling }" :disabled="disabled" :aria-label="t('voice.hold')"
      :aria-pressed="holding" @pointerdown="down" @pointermove="move" @pointerup="release" @pointercancel="cancel"
      @keydown="keydown" @keyup="keyup" @blur="cancel" @contextmenu.prevent>
      <span class="mic"><MicIcon :size="holding ? 32 : 26" /></span>
      <template v-if="holding">
        <span class="wave" aria-hidden="true"><i v-for="n in 16" :key="n" :style="{ animationDelay: `${(n % 5) * -0.17}s` }" /></span>
        <span class="clock">0:{{ String(seconds).padStart(2, '0') }}</span>
      </template>
      <span v-else>{{ t('voice.hold') }}</span>
    </button>
  </div>
</template>
