<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import OrderTable from './components/OrderTable.vue'
import SkeletonRows from './components/SkeletonRows.vue'
import LangSwitch from './components/LangSwitch.vue'
import { intlTag, locale, t, type MessageKey } from './i18n'
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
const showToast = (key: MessageKey) => { toast.value = t(key); clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.value = ''), 3500) }
const { orders, summary, loading, error, online, reload, toggle } = useOrders(repo, date, showToast)
const health = ref<boolean | null>(null)
const tag = computed(() => intlTag[locale.value])
const parts = computed(() => formatParts(date.value, tag.value))
const isToday = computed(() => date.value === todayVN())
const isHealthRoute = location.hash.startsWith('#/health')

onMounted(async () => {
  initSession()
  if (hasBackend) health.value = await checkHealth()
})
</script>

<template>
  <main class="page">
    <LangSwitch />
    <p v-if="isHealthRoute" class="health">{{ t(!hasBackend ? 'health.demo' : health ? 'health.ok' : 'health.bad') }}</p>

    <div v-if="sessionState === 'loading'" class="center">{{ t('app.loading') }}</div>
    <LoginForm v-else-if="sessionState === 'signedout'" />
    <SetPasswordForm v-else-if="sessionState === 'setpassword'" />
    <div v-else-if="sessionState === 'denied'" class="center">
      <p>{{ t('app.noAccess') }}</p>
      <button class="btn" @click="signOut">{{ t('app.signOut') }}</button>
    </div>

    <template v-else>
      <div v-if="!online" class="banner">{{ t('app.offline') }}</div>
      <header class="datebar">
        <button class="nav" :aria-label="t('app.prevDay')" @click="setDate(addDays(date, -1))">‹</button>
        <label class="when">
          <span class="eyebrow">{{ parts.weekday }}<span v-if="isToday" class="today"> · {{ t('app.today') }}</span></span>
          <span class="day">{{ parts.day }} <span class="caret" aria-hidden="true">▾</span></span>
          <input type="date" :value="date" :aria-label="t('app.pickDate', { date: formatLong(date, tag) })"
            @change="setDate(($event.target as HTMLInputElement).value)" />
        </label>
        <button class="nav" :aria-label="t('app.nextDay')" @click="setDate(addDays(date, 1))">›</button>
      </header>
      <button v-if="!isToday" class="link back-today" @click="setDate(todayVN())">{{ t('app.backToday') }}</button>

      <dl class="stats">
        <div><dt>{{ t('stats.orders') }}</dt><dd>{{ summary.orders }}</dd></div>
        <div><dt>{{ t('stats.portions') }}</dt><dd>{{ summary.portions }}</dd></div>
        <div><dt>{{ t('stats.delivered') }}</dt><dd>{{ summary.delivered }}<small>/{{ summary.orders }}</small></dd></div>
      </dl>
      <p v-if="repo.mode === 'demo'" class="demo">{{ t('app.demoData') }}</p>

      <SkeletonRows v-if="loading" />
      <div v-else-if="error" class="state">
        <p>{{ t(error) }}</p><button class="btn" @click="reload">{{ t('app.retry') }}</button>
      </div>
      <div v-else-if="!orders.length" class="state empty">
        <span class="empty-icon" aria-hidden="true">🍲</span>
        <p>{{ t('app.empty') }}</p>
      </div>
      <OrderTable v-else :orders="orders" :disabled="!online" @toggle="toggle" />

      <footer v-if="hasBackend" class="foot">
        <span v-if="health !== null" class="status" :class="{ bad: !health }">{{ t(health ? 'app.connected' : 'app.unreachable') }}</span>
        <button class="link signout" @click="signOut">{{ t('app.signOut') }}</button>
      </footer>
    </template>
    <div v-if="toast" class="toast" role="status">{{ toast }}</div>
  </main>
</template>
