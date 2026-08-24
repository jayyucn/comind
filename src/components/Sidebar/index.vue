<script setup lang="ts">
import SidebarContainer from './SidebarContainer.vue'

defineOptions({ name: 'Sidebar' })

defineProps<{
  canGoBack: boolean
  canGoForward: boolean
}>()

const emit = defineEmits<{
  goBack: []
  goForward: []
  openSearch: []
}>()
</script>

<template>
  <SidebarContainer
    v-bind="$props"
    @go-back="emit('goBack')"
    @go-forward="emit('goForward')"
    @open-search="emit('openSearch')"
  />
</template>
