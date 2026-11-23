<script setup lang="ts">
import { locale, locales, setLocale, t } from '../i18n'
</script>
<template>
  <div class="lang" role="group" :aria-label="t('app.language')">
    <button v-for="l in locales" :key="l" type="button" :lang="l" :aria-pressed="locale === l"
      @click="setLocale(l)">{{ l.toUpperCase() }}</button>
  </div>
</template>
