<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ExternalLink, X } from 'lucide-vue-next'
import Block from '../Block/index.vue'
import { useBlockStore } from '../../stores/blocks'
import type { TreeNode } from '../../types/block'

/**
 * 单 block 编辑抽屉（仿 PageDrawer）：列表（任务中心/看板/日历…）点卡片后，
 * 不整页跳转、也不内联编辑，改为滑出抽屉内嵌完整 Block 编辑器（Block/index.vue）。
 * 用合成的单节点树（仅目标 block，无子节点）驱动 Block 渲染，复用其全部编辑能力
 * （内容 / 属性 / 状态），与 PageDrawer 内嵌 Page 同理，且天然可复用于任意来源的 block。
 * 受控组件：blockId 非空时显示，close 事件由父级清空；opened 在挂载完成时触发。
 */
const props = defineProps<{
  /** 打开的 block id；null/空串时抽屉关闭。 */
  blockId: string | null
}>()

const emit = defineEmits<{
  close: []
  opened: []
}>()

const router = useRouter()
const blockStore = useBlockStore()

const block = computed(() => (props.blockId ? blockStore.getBlock(props.blockId) : null))
const pageId = computed(() => block.value?.pageId ?? null)
// 合成单节点树：仅目标 block，无子节点，depth=0 即可驱动 Block 渲染完整编辑器
const node = computed<TreeNode | null>(() =>
  block.value ? { id: block.value.id, block: block.value, children: [] } : null,
)

// block 可能尚未在 store（跨页引用 / 懒加载），打开时确保加载真实 block 以驱动编辑器
watch(
  () => props.blockId,
  async (id) => {
    if (!id) return
    try {
      await blockStore.loadBlock(id)
    } catch {
      /* 加载失败（无权限/已删除）由模板 loading 态兜底，不弹错 */
    }
  },
  { immediate: true },
)

// 前往所属页面并定位到该 block（与 PageDrawer.openInPage 同理，但目标是单 block）
function openInPage() {
  if (!pageId.value || !props.blockId) return
  emit('close')
  router.push({ name: 'page', params: { pageId: pageId.value } })
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId: props.blockId } }))
  }, 0)
}

onMounted(() => {
  if (props.blockId) emit('opened')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="block-drawer">
      <div v-if="blockId" class="block-drawer-backdrop" @click.self="emit('close')">
        <aside class="block-drawer">
          <header class="drawer-header">
            <button
              class="drawer-open"
              title="前往所属页面"
              data-testid="block-drawer-open"
              @click="openInPage"
            >
              <ExternalLink :size="18" />
            </button>
            <button class="drawer-close" title="关闭" data-testid="block-drawer-close" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>
          <div class="drawer-body">
            <Block v-if="node" :node="node" :page-id="pageId!" :depth="0" />
            <div v-else class="drawer-loading">加载中…</div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.block-drawer-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-drawer);
  display: flex;
  justify-content: flex-end;
}

.block-drawer {
  width: min(88vw, 760px);
  max-width: 100%;
  height: 100%;
  background-color: var(--bg-base);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.25);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, var(--app-split));
  flex-shrink: 0;
}

.drawer-close,
.drawer-open {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 16px;
}

.drawer-loading {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  padding: 16px;
}

.block-drawer-enter-active,
.block-drawer-leave-active {
  transition: opacity 0.2s ease;
}

.block-drawer-enter-from,
.block-drawer-leave-to {
  opacity: 0;
}

.block-drawer-enter-active .block-drawer,
.block-drawer-leave-active .block-drawer {
  transition: transform 0.25s ease;
}

.block-drawer-enter-from .block-drawer,
.block-drawer-leave-to .block-drawer {
  transform: translateX(100%);
}
</style>
