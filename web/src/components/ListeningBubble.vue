<script setup lang="ts">
import { t } from '../i18n'
defineProps<{ dateLabel: string; finalText: string; interim: string; cancelling: boolean }>()
</script>
<template>
  <div class="bubble" :class="{ cancelling }" role="status">
    <span class="eyebrow">{{ t('voice.listening') }} · {{ dateLabel }}</span>
    <span class="said">
      {{ finalText }} <span class="interim">{{ interim }}</span>
      <span v-if="!finalText && !interim" class="interim">{{ t('voice.example') }}</span>
    </span>
    <span class="hint">{{ t(cancelling ? 'voice.releaseToCancel' : 'voice.releaseToSend') }}</span>
  </div>
</template>
