<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { usePageStore } from '../stores/pages';
import { pushModal, popModal } from '../composables/useModalKeyboard';

const props = defineProps<{
  visible: boolean;
  position: {
    x: number;
    y: number;
  };
  range: {
    from: number;
    to: number;
  };
  query: string;
}>();

const emit = defineEmits<{
  (e: 'select', pageName: string): void;
  (e: 'close'): void;
}>();

const pageStore = usePageStore();
const selectedIndex = ref(0);

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    pushModal('wiki-link-menu')
    selectedIndex.value = 0
  } else {
    popModal('wiki-link-menu')
  }
})

onUnmounted(() => {
  popModal('wiki-link-menu')
})

watch(() => props.query, () => {
  selectedIndex.value = 0
})

const filteredPages = computed(() => {
  if (!props.query) {
    return pageStore.pages
      .filter(p => !p.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10);
  }
  return pageStore.pages
    .filter(p => !p.deleted && p.title.toLowerCase().includes(props.query.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
});

const menuItems = computed(() => {
  const items: Array<{
    type: 'page' | 'create';
    title: string;
    pageId?: string;
  }> = [];

  filteredPages.value.forEach(page => {
    items.push({
      type: 'page',
      title: page.title,
      pageId: page.id
    });
  });

  if (props.query.trim()) {
    const exists = filteredPages.value.some(p => p.title.toLowerCase() === props.query.toLowerCase());
    if (!exists) {
      items.push({
        type: 'create',
        title: props.query.trim()
      });
    }
  }

  return items;
});

function selectItem(item: typeof menuItems.value[0]) {
  emit('select', item.title);
}

function selectNext() {
  if (menuItems.value.length > 0) {
    selectedIndex.value = Math.min(selectedIndex.value + 1, menuItems.value.length - 1);
  }
}

function selectPrev() {
  if (menuItems.value.length > 0) {
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0);
  }
}

function confirmSelect() {
  if (menuItems.value.length === 0 || !menuItems.value[selectedIndex.value]) {
    emit('close')
    return
  }
  
  selectItem(menuItems.value[selectedIndex.value])
}

function close() {
  emit('close');
}

defineExpose({ selectNext, selectPrev, confirmSelect, close });
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="wiki-link-menu-overlay" @click.self="emit('close')">
      <div 
        class="wiki-link-menu"
        :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      >
        <div class="wlm-body">
          <div v-if="menuItems.length === 0" class="wlm-empty">
            <span v-if="!query">No pages yet</span>
            <span v-else>No pages found</span>
          </div>
          <div
            v-for="(item, index) in menuItems"
            :key="item.type === 'page' ? item.pageId : `create-${item.title}`"
            class="wlm-item"
            :class="{ 
              active: selectedIndex === index,
              'wlm-create': item.type === 'create'
            }"
            @click="selectItem(item)"
            @mouseenter="selectedIndex = index"
          >
            <span class="wlm-icon">{{ item.type === 'create' ? '+' : '📄' }}</span>
            <span class="wlm-title">{{ item.type === 'create' ? `Create "${item.title}"` : item.title }}</span>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wiki-link-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.wiki-link-menu {
  position: absolute;
  width: 320px;
  max-height: 360px;
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-color, #E7E5E4);
}

.wlm-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.wlm-empty {
  padding: 16px;
  color: var(--text-muted, #78716C);
  font-style: italic;
  text-align: center;
  font-size: 14px;
}

.wlm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 14px;
  transition: background-color 0.15s;
}

.wlm-item:hover {
  background: var(--bg-secondary, #F5F5F4);
}

.wlm-item.active {
  background: var(--accent-color-light, #DBEAFE);
}

.wlm-item.wlm-create {
  color: var(--accent-color, #2563EB);
}

.wlm-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.wlm-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #1C1917);
}

.wlm-item.wlm-create .wlm-title {
  color: var(--accent-color, #2563EB);
}
</style>
