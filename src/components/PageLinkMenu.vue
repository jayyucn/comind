<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { popModal, pushModal } from '../composables/useModalKeyboard';
import { usePageStore } from '../stores/pages';
import BasePopover from './common/BasePopover.vue';

const props = defineProps<{
  visible: boolean;
  position: {
    x: number;
    y: number;
  };
  /** 锚点元素（光标所在 DOM 节点），由父级经 editorEvents 反查得到；提供后进入 BasePopover 避让模式（ADR-0038）。 */
  anchorEl?: HTMLElement | null;
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
  const q = props.query.toLowerCase();
  return pageStore.pages
    .filter(p => !p.deleted && p.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const aExact = aTitle === q ? 0 : 1;
      const bExact = bTitle === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStartsWith = aTitle.startsWith(q) ? 0 : 1;
      const bStartsWith = bTitle.startsWith(q) ? 0 : 1;
      if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 10);
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
  <BasePopover
    :visible="visible"
    :position="position"
    :anchor-el="anchorEl || null"
    placement="bottom"
    @close="emit('close')"
  >
    <div class="wiki-link-menu">
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
  </BasePopover>
</template>

<style scoped>
.wiki-link-menu {
  width: 320px;
  max-height: 360px;
  background: var(--bg-base);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
}

.wlm-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.wlm-empty {
  padding: 16px;
  color: var(--text-tertiary);
  font-style: italic;
  text-align: center;
  font-size: var(--text-sm);
}

.wlm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: var(--text-sm);
  transition: background-color 0.15s;
}

.wlm-item:hover {
  background: var(--bg-hover);
}

.wlm-item.active {
  background: var(--accent-subtle);
}

.wlm-item.wlm-create {
  color: var(--accent);
}

.wlm-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
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
