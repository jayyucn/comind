<script setup lang="ts">
import SidebarContainer from './SidebarContainer.vue'

defineOptions({ name: 'Sidebar' })

const emit = defineEmits<{
  openSearch: []
}>()
</script>

<template>
  <SidebarContainer
    @open-search="emit('openSearch')"
  />
</template>
