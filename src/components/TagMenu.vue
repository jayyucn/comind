<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { popModal, pushModal } from '../composables/useModalKeyboard';
import { useTagsStore } from '../stores/tags';
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
  (e: 'select', tagName: string): void;
  (e: 'close'): void;
}>();

const tagsStore = useTagsStore();
const selectedIndex = ref(0);

watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    pushModal('tag-menu');
    selectedIndex.value = 0;
  } else {
    popModal('tag-menu');
  }
});

onUnmounted(() => {
  popModal('tag-menu');
});

watch(() => props.query, () => {
  selectedIndex.value = 0;
});

const filteredTags = computed(() => {
  if (!props.query.trim()) {
    // 最近使用标签（lastUsedAt 降序）
    return tagsStore.recentTags().slice(0, 10);
  }
  const q = props.query.toLowerCase();
  return tagsStore.allTags
    .filter((t) => !t.deleted_at && t.title.toLowerCase().includes(q))
    .sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      const aExact = aTitle === q ? 0 : 1;
      const bExact = bTitle === q ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStartsWith = aTitle.startsWith(q) ? 0 : 1;
      const bStartsWith = bTitle.startsWith(q) ? 0 : 1;
      if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith;
      return 0;
    })
    .slice(0, 10);
});

const menuItems = computed(() => {
  const items: Array<{
    type: 'tag' | 'create';
    title: string;
    color?: string;
  }> = [];

  filteredTags.value.forEach((tag) => {
    items.push({
      type: 'tag',
      title: tag.title,
      color: tag.color,
    });
  });

  if (props.query.trim()) {
    const exists = filteredTags.value.some(
      (t) => t.title.toLowerCase() === props.query.toLowerCase()
    );
    if (!exists) {
      items.push({
        type: 'create',
        title: props.query.trim(),
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
    emit('close');
    return;
  }
  selectItem(menuItems.value[selectedIndex.value]);
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
    <div class="tag-menu">
      <div class="tm-body">
        <div
          v-if="menuItems.length === 0"
          class="tm-empty"
        >
          <span v-if="!query">No tags yet</span>
          <span v-else>No tags found</span>
        </div>
        <div
          v-for="(item, index) in menuItems"
          :key="item.type === 'tag' ? `tag-${item.title}` : `create-${item.title}`"
          class="tm-item"
          :class="{
            active: selectedIndex === index,
            'tm-create': item.type === 'create',
          }"
          @mousedown.prevent
          @click="selectItem(item)"
          @mouseenter="selectedIndex = index"
        >
          <span
            v-if="item.type === 'create'"
            class="tm-icon"
          >+</span>
          <span
            v-else
            class="tm-dot"
            :style="{ background: item.color ? `var(${item.color})` : 'var(--text-tertiary)' }"
          />
          <span class="tm-title">{{
            item.type === 'create' ? `Create "#${item.title}"` : item.title
          }}</span>
        </div>
      </div>
    </div>
  </BasePopover>
</template>

<style scoped>
.tag-menu {
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

.tm-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.tm-empty {
  padding: 16px;
  color: var(--text-tertiary);
  font-style: italic;
  text-align: center;
  font-size: var(--text-sm);
}

.tm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: var(--text-sm);
  transition: background-color var(--dur-fast) var(--ease-out);
}

.tm-item:hover {
  background: var(--bg-hover);
}

.tm-item.active {
  background: var(--accent-subtle);
}

.tm-item.tm-create {
  color: var(--accent);
}

.tm-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
}

.tm-dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.tm-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #1c1917);
}

.tm-item.tm-create .tm-title {
  color: var(--accent-color, #2563eb);
}
</style>
