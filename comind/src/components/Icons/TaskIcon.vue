<script setup lang="ts">
defineProps<{
  name: string
  size?: number
  color?: string
}>()
</script>

<template>
  <svg
    :width="size || 16"
    :height="size || 16"
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :style="color ? { color } : {}"
  >
    <use :href="`/icons.svg#${name}`" />
  </svg>
</template>
