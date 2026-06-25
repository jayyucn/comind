<script setup lang="ts">
import { computed } from 'vue'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'

const props = defineProps<{
  searchQuery: string
  activeFilters: string[]
}>()

const emit = defineEmits<{
  (e: 'update:searchQuery', value: string): void
  (e: 'toggleFilter', type: string): void
  (e: 'clearFilters'): void
}>()

const types = useRelationshipTypes()

const filterOptions = computed(() => {
  return types.items.value.filter(t => !t.deleted)
})
</script>

<template>
  <div class="search-filter-bar">
    <div class="search-input-wrapper">
      <span class="search-icon">🔍</span>
      <input
        :value="searchQuery"
        type="text"
        placeholder="搜索页面标题..."
        class="search-input"
        @input="emit('update:searchQuery', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div class="filter-chips">
      <button
        v-for="t in filterOptions"
        :key="t.type"
        class="filter-chip"
        :class="{ active: activeFilters.includes(t.type) }"
        :style="activeFilters.includes(t.type) ? { backgroundColor: t.color + '20', borderColor: t.color, color: t.color } : {}"
        @click="emit('toggleFilter', t.type)"
      >
        {{ t.label }}
      </button>
      <button
        v-if="activeFilters.length > 0"
        class="clear-filters-btn"
        @click="emit('clearFilters')"
      >
        清除过滤
      </button>
    </div>
  </div>
</template>

<style scoped>
.search-filter-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.search-input-wrapper {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 300px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 32px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

.filter-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all 80ms ease;
}

.filter-chip:hover {
  background: var(--bg-hover);
}

.filter-chip.active {
  font-weight: 500;
}

.clear-filters-btn {
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}

.clear-filters-btn:hover {
  color: var(--text-primary);
}
</style>
