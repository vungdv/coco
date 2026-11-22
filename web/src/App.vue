<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import OrderTable from './components/OrderTable.vue'
import SkeletonRows from './components/SkeletonRows.vue'
import { useDateRoute } from './composables/useRoute'
import { useOrders } from './composables/useOrders'
import { initSession, sessionState, signOut } from './composables/useSession'
import { formatLong, todayVN } from './lib/date'
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
      <header class="top">
        <h1>Order management</h1>
        <label class="btn pick">Pick date
          <input type="date" :value="date" aria-label="Pick date" @change="setDate(($event.target as HTMLInputElement).value)" />
        </label>
      </header>
      <h2 class="date">{{ formatLong(date) }}
        <button v-if="date !== todayVN()" class="link" @click="setDate(todayVN())">Today</button>
      </h2>
      <p class="summary">
        {{ summary.orders }} {{ summary.orders === 1 ? 'order' : 'orders' }} · {{ summary.portions }} portions · {{ summary.delivered }} delivered
        <span v-if="repo.mode === 'demo'" class="demo">· demo data</span>
      </p>

      <SkeletonRows v-if="loading" />
      <div v-else-if="error" class="state">
        <p>{{ error }}</p><button class="btn" @click="reload">Retry</button>
      </div>
      <p v-else-if="!orders.length" class="state">No orders for this day.</p>
      <OrderTable v-else :orders="orders" :disabled="!online" @toggle="toggle" />

      <button v-if="hasBackend" class="link signout" @click="signOut">Sign out</button>
      <p v-if="health !== null && hasBackend" class="foot">{{ health ? 'Supabase connected' : 'Supabase unreachable' }}</p>
    </template>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </main>
</template>
