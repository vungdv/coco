<template>
  <div class="card" aria-busy="true">
    <div v-for="i in 5" :key="i" class="row skel"><span class="bar" /><span class="bar" /><span class="bar" /></div>
  </div>
</template>
