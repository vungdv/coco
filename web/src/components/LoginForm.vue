<script setup lang="ts">
import { ref } from 'vue'
import { signIn } from '../composables/useSession'
import { t, type MessageKey } from '../i18n'
const email = ref(''), password = ref(''), error = ref<MessageKey | null>(null), busy = ref(false)
async function submit() {
  busy.value = true; error.value = null
  error.value = await signIn(email.value, password.value)
  busy.value = false
}
</script>
<template>
  <form class="login" @submit.prevent="submit">
    <h2>{{ t('login.title') }}</h2>
    <label>{{ t('login.email') }}<input v-model="email" type="email" autocomplete="username" required /></label>
    <label>{{ t('login.password') }}<input v-model="password" type="password" autocomplete="current-password" required /></label>
    <p v-if="error" class="err" role="alert">{{ t(error) }}</p>
    <button class="btn primary" :disabled="busy">{{ busy ? t('login.busy') : t('login.submit') }}</button>
  </form>
</template>
