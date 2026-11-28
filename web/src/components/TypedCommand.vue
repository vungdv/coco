<script setup lang="ts">
// Fallback when the microphone is not allowed (spec v3 §7, mockup A4): type the command instead.
import { ref } from 'vue'
import MicIcon from './MicIcon.vue'
import { formatShortDay } from '../lib/date'
import { MAX_TRANSCRIPT } from '../lib/voice'
import { intlTag, locale, t } from '../i18n'

const props = defineProps<{ date: string; disabled: boolean }>()
const emit = defineEmits<{ send: [transcript: string, date: string] }>()
const open = ref(false)
const text = ref('')
function submit() {
  if (!text.value.trim() || props.disabled) return
  emit('send', text.value, props.date)
  text.value = ''
  open.value = false
}
</script>
<template>
  <div class="talk">
    <form v-if="open" class="bubble" @submit.prevent="submit" @keydown.esc="open = false">
      <span class="hint">{{ t('voice.micDenied') }}</span>
      <label class="typed">
        <span class="eyebrow">{{ t('voice.typeLabel') }} · {{ formatShortDay(date, intlTag[locale]) }}</span>
        <input v-model="text" :maxlength="MAX_TRANSCRIPT" :placeholder="t('voice.example')" autofocus />
      </label>
      <span class="actions">
        <button type="button" class="btn" @click="open = false">{{ t('voice.cancel') }}</button>
        <button type="submit" class="btn primary" :disabled="disabled || !text.trim()">{{ t('voice.send') }}</button>
      </span>
    </form>
    <button type="button" class="talkbar" :disabled="disabled" :aria-expanded="open" @click="open = !open">
      <span class="mic"><MicIcon :size="26" /></span>{{ t('voice.type') }}
    </button>
  </div>
</template>
