<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import OrderTable from './components/OrderTable.vue'
import SkeletonRows from './components/SkeletonRows.vue'
import { useDateRoute } from './composables/useRoute'
import { useOrders } from './composables/useOrders'
import { initSession, sessionState, signOut } from './composables/useSession'

import { addDays, formatLong, formatParts, todayVN } from './lib/date'
import { checkHealth, hasBackend, supabaseRepo } from './lib/supabase'
import { demoRepo } from './lib/demoRepo'

const LoginForm = defineAsyncComponent(() => import('./components/LoginForm.vue')) // lazy (M5)
const SetPasswordForm = defineAsyncComponent(() => import('./components/SetPasswordForm.vue'))
const repo = hasBackend ? supabaseRepo : demoRepo
const { date, setDate } = useDateRoute()
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout>
const showToast = (m: string) => { toast.value = m; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 3500) }
const { orders, summary, loading, error, online, reload, toggle } = useOrders(repo, date, showToast)
const health = ref<boolean | null>(null)
const parts = computed(() => formatParts(date.value))
const isToday = computed(() => date.value === todayVN())
const isHealthRoute = location.hash.startsWith('#/health')

onMounted(async () => {
  initSession()
  if (hasBackend) health.value = await checkHealth()
})
</script>

<template>
  <main class="page">
    <p v-if="isHealthRoute" class="health">{{ !hasBackend ? 'Demo mode (no Supabase configured)' : health ? 'Supabase connected' : 'Supabase unreachable' }}</p>

    <div v-if="sessionState === 'loading'" class="center">Loading…</div>
    <LoginForm v-else-if="sessionState === 'signedout'" />
    <SetPasswordForm v-else-if="sessionState === 'setpassword'" />
    <div v-else-if="sessionState === 'denied'" class="center">
      <p>You don't have access.</p>
      <button class="btn" @click="signOut">Sign out</button>
    </div> 

    <template v-else>
      <div v-if="!online" class="banner">You're offline — showing last loaded data</div>
      <header class="datebar">
        <button class="nav" aria-label="Previous day" @click="setDate(addDays(date, -1))">‹</button>
        <label class="when">
          <span class="eyebrow">{{ parts.weekday }}<span v-if="isToday" class="today"> · Today</span></span>
          <span class="day">{{ parts.day }} <span class="caret" aria-hidden="true">▾</span></span>
          <input type="date" :value="date" :aria-label="`Pick date, currently ${formatLong(date)}`"
            @change="setDate(($event.target as HTMLInputElement).value)" />
        </label>
        <button class="nav" aria-label="Next day" @click="setDate(addDays(date, 1))">›</button>
      </header>
      <button v-if="!isToday" class="link back-today" @click="setDate(todayVN())">← Back to today</button>

      <dl class="stats">
        <div><dt>Orders</dt><dd>{{ summary.orders }}</dd></div>
        <div><dt>Portions</dt><dd>{{ summary.portions }}</dd></div>
        <div><dt>Delivered</dt><dd>{{ summary.delivered }}<small>/{{ summary.orders }}</small></dd></div>
      </dl>
      <p v-if="repo.mode === 'demo'" class="demo">Showing demo data</p>

      <SkeletonRows v-if="loading" />
      <div v-else-if="error" class="state">
        <p>{{ error }}</p><button class="btn" @click="reload">Retry</button>
      </div>
      <div v-else-if="!orders.length" class="state empty">
        <span class="empty-icon" aria-hidden="true">🍲</span>
        <p>No orders for this day.</p>
      </div>
      <OrderTable v-else :orders="orders" :disabled="!online" @toggle="toggle" />

      <footer v-if="hasBackend" class="foot">
        <span v-if="health !== null" class="status" :class="{ bad: !health }">{{ health ? 'Connected' : 'Server unreachable' }}</span>
        <button class="link signout" @click="signOut">Sign out</button>
      </footer>
    </template>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </main>
</template>
