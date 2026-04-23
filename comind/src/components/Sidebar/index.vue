<script setup lang="ts">
import SidebarContainer from './SidebarContainer.vue'

// Re-export with the name that App.vue expects
defineOptions({ name: 'Sidebar' })
</script>

<template>
  <SidebarContainer />
</template>