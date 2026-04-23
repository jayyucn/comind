<script setup lang="ts">
const emit = defineEmits<{
  'toggle-collapse': []
}>()
</script>

<template>
  <div class="sidebar-header">
    <span class="sidebar-logo">COMIND</span>
    <button 
      class="collapse-btn" 
      title="折叠侧边栏"
      @click="emit('toggle-collapse')"
    >
      <span class="collapse-icon">◀</span>
    </button>
  </div>
</template>

<style scoped>
.sidebar-header {
  padding: 14px var(--space-4) 12px;
  border-bottom: 1px solid var(--border);
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  flex-shrink: 0;
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.collapse-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--text-secondary);
  transition: background 80ms ease;
}

.collapse-btn:hover {
  background: var(--bg-hover);
}

.collapse-icon {
  font-size: 10px;
  line-height: 1;
}
</style>