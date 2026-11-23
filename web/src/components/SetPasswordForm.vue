<script setup lang="ts">
import { ref } from 'vue'
import { setPassword } from '../composables/useSession'
import { t } from '../i18n'
const password = ref(''), error = ref(''), busy = ref(false)
async function submit() {
  busy.value = true; error.value = ''
  error.value = (await setPassword(password.value)) ?? ''
  busy.value = false
}
</script>
<template>
  <form class="login" @submit.prevent="submit">
    <h2>{{ t('setpw.title') }}</h2>
    <label>{{ t('setpw.password') }}<input v-model="password" type="password" autocomplete="new-password" minlength="8" required /></label>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <button class="btn primary" :disabled="busy">{{ busy ? t('setpw.busy') : t('setpw.submit') }}</button>
  </form>
</template>
