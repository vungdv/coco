<script setup lang="ts">
import { ref } from 'vue'
import type { Order } from '../lib/orders'
import { formatTime } from '../lib/date'
import { t } from '../i18n'
defineProps<{ orders: Order[]; disabled: boolean }>()
defineEmits<{ toggle: [id: string] }>()
const open = ref<string | null>(null)
</script>
<template>
  <div class="card" role="table" :aria-label="t('orders.label')">
    <div class="row head" role="row">
      <span class="c-check" /><span>{{ t('orders.name') }}</span><span class="c-qty">{{ t('orders.qty') }}</span><span>{{ t('orders.message') }}</span>
    </div>
    <div v-for="o in orders" :key="o.id" class="row" :class="{ done: o.delivered, open: open === o.id }" role="row"
      @click="open = open === o.id ? null : o.id">
      <label class="c-check" @click.stop>
        <input type="checkbox" :checked="o.delivered" :disabled="disabled"
          :aria-label="t('orders.markDelivered', { name: o.customer_name })" @change="$emit('toggle', o.id)" />
        <span class="box" />
      </label>
      <span class="who">
        <span class="name">{{ o.customer_name }}<em v-if="o.pending" class="pend"> · {{ t('orders.pending') }}</em></span>
        <time class="time" :datetime="o.placed_at">{{ formatTime(o.placed_at) }}</time>
      </span>
      <span class="c-qty">{{ o.quantity }}</span>
      <span class="msg">{{ o.message }}</span>
    </div>
  </div>
</template>
