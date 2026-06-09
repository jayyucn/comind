<script setup lang="ts">
const props = defineProps<{
  section: string
  collapsed: boolean
  label: string
  labelColor: string
}>()

const emit = defineEmits<{
  (e: 'toggle'): void
}>()

function handleToggle() {
  emit('toggle')
}
</script>

<template>
  <div class="concept-section">
    <div class="concept-section-header" @click="handleToggle">
      <div class="concept-section-label" :style="{ color: labelColor }">
        {{ label }}
      </div>
      <div class="concept-section-toggle" :class="{ collapsed }">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
    </div>
    <div class="concept-section-body" :class="{ collapsed }">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.concept-section {
  border-bottom: 1px solid var(--border);
}

.concept-section:last-child {
  border-bottom: none;
}

.concept-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px 6px;
  cursor: pointer;
  user-select: none;
}

.concept-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.concept-section-toggle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: transform 0.15s ease;
}

.concept-section-toggle.collapsed {
  transform: rotate(-90deg);
}

.concept-section-body {
  padding: 0 16px 10px;
  overflow: hidden;
  transition: max-height 0.2s ease, opacity 0.2s ease;
  max-height: 1000px;
  opacity: 1;
}

.concept-section-body.collapsed {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}
</style>
