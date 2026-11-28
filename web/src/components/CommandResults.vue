<script setup lang="ts">
import { resultText } from '../lib/resultText'
import type { Tracked, View } from '../lib/voice'
import { formatTime } from '../lib/date'
import { t } from '../i18n'

type Result = Tracked & { view: View }
defineProps<{ results: Result[] }>()
const emit = defineEmits<{ dismiss: [id: string]; show: [result: Result] }>()
const icon: Record<View, string> = { sending: '', processing: '', unclaimed: '◷', done: '✓', failed: '⚠', send_failed: '⚠' }
const canShow = (r: Result) => r.view === 'done' && r.result?.op !== 'delete' && !!r.result?.order_id
</script>
<template>
  <div class="results" role="status">
    <div v-for="r in results" :key="r.id" class="res" :class="r.view">
      <span v-if="icon[r.view]" class="icon" aria-hidden="true">{{ icon[r.view] }}</span>
      <span v-else class="spin" aria-hidden="true" />
      <component :is="canShow(r) ? 'button' : 'span'" class="body" :type="canShow(r) ? 'button' : undefined"
        @click="canShow(r) && emit('show', r)">
        <span class="title">{{ resultText(r, r.view, t).title }}</span>
        <small>{{ resultText(r, r.view, t).detail }} · {{ formatTime(r.shownAt) }}</small>
      </component>
      <button v-if="r.view === 'unclaimed'" type="button" class="act" @click="emit('dismiss', r.id)">{{ t('voice.drop') }}</button>
      <button v-else-if="r.view === 'failed' || r.view === 'send_failed'" type="button" class="act"
        :aria-label="t('voice.close')" @click="emit('dismiss', r.id)">✕</button>
    </div>
  </div>
</template>
