<script setup lang="ts">
import { ref } from 'vue'
import { setPassword } from '../composables/useSession'
const password = ref(''), error = ref(''), busy = ref(false)
async function submit() {
  busy.value = true; error.value = ''
  error.value = (await setPassword(password.value)) ?? ''
  busy.value = false
}
</script>
<template>
  <form class="login" @submit.prevent="submit">
    <h2>Set your password</h2>
    <label>New password<input v-model="password" type="password" autocomplete="new-password" minlength="8" required /></label>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <button class="btn primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save password' }}</button>
  </form>
</template>
