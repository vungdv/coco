<script setup lang="ts">
import { ref } from 'vue'
import { signIn } from '../composables/useSession'
const email = ref(''), password = ref(''), error = ref(''), busy = ref(false)
async function submit() {
  busy.value = true; error.value = ''
  error.value = (await signIn(email.value, password.value)) ?? ''
  busy.value = false
}
</script>
<template>
  <form class="login" @submit.prevent="submit">
    <h2>Sign in</h2>
    <label>Email<input v-model="email" type="email" autocomplete="username" required /></label>
    <label>Password<input v-model="password" type="password" autocomplete="current-password" required /></label>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <button class="btn primary" :disabled="busy">{{ busy ? 'Signing in…' : 'Sign in' }}</button>
  </form>
</template>
