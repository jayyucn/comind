<script setup lang="ts">
import { onMounted } from 'vue'
import { X } from 'lucide-vue-next'
import PageIndex from './index.vue'

/**
 * 右侧页面弹层（drawer）：从列表（页面库/任务中心）点标题后不整页跳路由，
 * 改为滑出抽屉内嵌完整页面编辑器（Page/index.vue）。
 * 受控组件：pageId 非空时显示，close 事件由父级清空。
 * opened 在 PageIndex 挂载完成后触发（父 onMounted 晚于子），供父级转发
 * navigate-to-block 定位事件（TaskHub 场景）。
 */
const props = defineProps<{
  /** 打开的页面 id；null/空串时抽屉关闭。 */
  pageId: string | null
}>()

const emit = defineEmits<{
  close: []
  opened: []
}>()

onMounted(() => {
  if (props.pageId) emit('opened')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="page-drawer">
      <div v-if="pageId" class="page-drawer-backdrop" @click.self="emit('close')">
        <aside class="page-drawer">
          <header class="drawer-header">
            <button class="drawer-close" title="关闭" data-testid="page-drawer-close" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>
          <div class="drawer-body">
            <PageIndex :key="pageId" :page-id="pageId" />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.page-drawer-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: var(--z-drawer);
  display: flex;
  justify-content: flex-end;
}

.page-drawer {
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, var(--app-split));
  flex-shrink: 0;
}

.drawer-close {
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
}

.page-drawer-enter-active,
.page-drawer-leave-active {
  transition: opacity 0.2s ease;
}

.page-drawer-enter-from,
.page-drawer-leave-to {
  opacity: 0;
}

.page-drawer-enter-active .page-drawer,
.page-drawer-leave-active .page-drawer {
  transition: transform 0.25s ease;
}

.page-drawer-enter-from .page-drawer,
.page-drawer-leave-to .page-drawer {
  transform: translateX(100%);
}
</style>
