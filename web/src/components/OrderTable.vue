<script setup lang="ts">
import { ref } from 'vue'
import { isCancelled, lineLabel, showLines, type Order } from '../lib/orders'
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
    <div v-for="o in orders" :key="o.id" class="row" :class="{ done: o.delivered, cancelled: isCancelled(o), open: open === o.id }" role="row"
      @click="open = open === o.id ? null : o.id">
      <label class="c-check" @click.stop>
        <input type="checkbox" :checked="o.delivered" :disabled="disabled || isCancelled(o)"
          :aria-label="t('orders.markDelivered', { name: o.customer_name })" @change="$emit('toggle', o.id)" />
        <span class="box" />
      </label>
      <span class="who">
        <span class="name">{{ o.customer_name }}<em v-if="isCancelled(o)" class="tag"> · {{ t('orders.cancelled') }}</em><em v-if="o.pending" class="pend"> · {{ t('orders.pending') }}</em></span>
        <time class="time" :datetime="o.placed_at">{{ formatTime(o.placed_at) }}</time>
      </span>
      <span class="c-qty">{{ o.quantity }}</span>
      <ul v-if="showLines(o)" class="msg lines">
        <li v-for="l in o.lines" :key="l.id">
          <b class="delta" :class="l.op">{{ lineLabel(l) }}</b> {{ l.message }}
          <time class="time" :datetime="l.placed_at">{{ formatTime(l.placed_at) }}</time>
        </li>
      </ul>
      <span v-else class="msg">{{ o.lines[0]?.message }}</span>
    </div>
  </div>
</template>
