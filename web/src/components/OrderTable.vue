<script setup lang="ts">
import { ref } from 'vue'
import type { Order } from '../lib/orders'
defineProps<{ orders: Order[]; disabled: boolean }>()
defineEmits<{ toggle: [id: string] }>()
const open = ref<string | null>(null)
</script>
<template>
  <div class="card" role="table" aria-label="Orders">
    <div class="row head" role="row">
      <span class="c-check" /><span>NAME</span><span class="c-qty">QTY.</span><span>MESSAGE</span>
    </div>
    <div v-for="o in orders" :key="o.id" class="row" :class="{ done: o.delivered, open: open === o.id }" role="row"
      @click="open = open === o.id ? null : o.id">
      <label class="c-check" @click.stop>
        <input type="checkbox" :checked="o.delivered" :disabled="disabled"
          :aria-label="`Mark ${o.customer_name} delivered`" @change="$emit('toggle', o.id)" />
        <span class="box" />
      </label>
      <span class="name">{{ o.customer_name }}<em v-if="o.pending" class="pend"> · pending</em></span>
      <span class="c-qty">{{ o.quantity }}</span>
      <span class="msg">{{ o.message }}</span>
    </div>
  </div>
</template>
