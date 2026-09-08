<script setup lang="ts">
// IdeasSnapshotNode - 快照只读块树节点（ADR-0042 T5）
//
// 与活 BlockList 同构的 DOM（复用全局 _block.scss 类名 → 视觉一致），但：
// - 内容来自快照（props.node.block + 快照属性 map），绝不读写活 store
// - 交互仅限：chevron 折叠/展开、[[wiki]] 跳转、图片只读缩放
// - 属性 chip 为当日值的静态呈现（status 图标）；行级 priority/status 类
//   由快照属性推出，交由全局 CSS 渲染底色/删除线
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed, inject } from 'vue'
import BulletRender from '../Block/handlers/bullet/BulletRender.vue'
import { Icon } from '../Icons'
import { useEditorStore } from '../../stores/editor'
import { useNavigateToPage } from '../../composables/useNavigateToPage'
import { getPropertyDefinition } from '../../types/property'
import type { Property } from '../../types/property'
import type { TreeNode } from '../../types/block'
import {
  SNAPSHOT_MODAL_KEY,
  SNAPSHOT_PROPS_KEY,
  SNAPSHOT_TREE_KEY,
  type SnapshotPropsMap,
  type SnapshotTreeState,
} from './snapshotContext'
import IdeasSnapshotImage from './IdeasSnapshotImage.vue'

defineOptions({ name: 'IdeasSnapshotNode' })

const props = defineProps<{
  node: TreeNode
  pageId: string
  depth: number
}>()

const propsMap = inject<SnapshotPropsMap>(SNAPSHOT_PROPS_KEY)!
const treeState = inject<SnapshotTreeState>(SNAPSHOT_TREE_KEY)!
/** 快照只读 BlockModal 内（ADR-0042 T6）：dot 不再递归开弹窗 */
const inSnapshotModal = inject(SNAPSHOT_MODAL_KEY, false)
const editorStore = useEditorStore()
const { navigateToPage } = useNavigateToPage()

const blockId = computed(() => props.node.id)

// ── 快照属性 → 行级语义（与活 useBlockPropertySync 的 priorityClass/statusClass 一致）──
const blockProps = computed<Property[]>(() => propsMap.getBlockProps(blockId.value))

const getPropValue = (key: string): string | undefined =>
  blockProps.value.find(p => p.key === key)?.value as string | undefined

const priorityClass = computed(() => {
  const v = getPropValue('priority')
  return v ? `priority-${String(v).toLowerCase()}` : ''
})

const statusClass = computed(() => {
  const v = getPropValue('status')
  if (v === 'Done') return 'status-done'
  if (v === 'Canceled') return 'status-canceled'
  return ''
})

/** between-bullet-content 且封闭值含图标的属性 → 静态图标 chip（如 status） */
const betweenChips = computed<{ icon: string; title: string }[]>(() => {
  const chips: { icon: string; title: string }[] = []
  for (const prop of blockProps.value) {
    if (prop.isHidden || prop.isDeleted) continue
    const def = getPropertyDefinition(prop.key)
    if (!def || def.displayPosition !== 'between-bullet-content') continue
    const cv = def.closedValues?.find(c => c.value === prop.value)
    if (cv?.icon) chips.push({ icon: cv.icon, title: cv.label ?? '' })
  }
  return chips
})

const isCollapsed = computed(() => treeState.isCollapsed(blockId.value))

/** wiki / 外链跳转（与活编辑链路 .block-link 语义一致，快照内只读） */
function onContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return
  const link = target.closest('.block-link') as HTMLElement | null
  if (!link) return
  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
    return
  }
  const pageName = link.dataset.page
  if (pageName) {
    navigateToPage(pageName).catch(err => {
      console.error('[IdeasSnapshotNode] 导航失败:', err)
    })
  }
}

/**
 * dot 打开快照只读 BlockModal（ADR-0042 T6）：以快照上下文打开全局 BlockModal，
 * 弹窗内展示该块当日快照子树（只读）。弹窗内 dot 为 no-op，避免递归开弹窗。
 */
function openDetail() {
  if (inSnapshotModal) return
  editorStore.openBlockModal(blockId.value, { snapshotOf: props.pageId })
}
</script>

<template>
  <div
    class="block snapshot-block"
    :class="[priorityClass, statusClass]"
    :data-block-id="blockId"
  >
    <div class="block-row">
      <!-- 缩进占位 -->
      <div class="block-indent" :style="{ width: `${depth * 24}px` }"></div>

      <div class="block-inner">
        <!-- Bullet：chevron 有子块时负责折叠/展开；dot 仅占位（快照只读，不触发 BlockModal） -->
        <span class="block-bullet">
          <span
            v-if="node.children.length > 0"
            class="bullet-chevron"
            title="折叠 / 展开"
            @click.stop="treeState.toggle(blockId)"
          >
            <ChevronDown v-if="!isCollapsed" :size="18" :stroke-width="2" />
            <ChevronRight v-else :size="18" :stroke-width="2" />
          </span>
          <span class="bullet-dot" title="打开块详情（只读快照）" @click.stop="openDetail" />
        </span>

        <div class="block-body">
          <!-- Between 属性静态 chip（当日值，不可交互） -->
          <span v-if="betweenChips.length" class="snapshot-property-inline">
            <span
              v-for="chip in betweenChips"
              :key="chip.icon"
              class="snapshot-property-item"
              :title="chip.title"
            >
              <span class="snapshot-property-icon">
                <Icon :name="chip.icon" />
              </span>
            </span>
          </span>

          <!-- 内容区：image 走只读图片；其余统一复用 BulletRender -->
          <div class="block-content">
            <IdeasSnapshotImage v-if="node.block.type === 'image'" :block="node.block" />
            <BulletRender
              v-else
              :content="node.block.content"
              @content-click="onContentClick"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 子节点容器（复用全局 .block-children 缩进线；折叠时不渲染子树） -->
    <div
      v-if="node.children.length > 0 && !isCollapsed"
      class="block-children"
      :style="{ '--indent-depth': depth }"
    >
      <IdeasSnapshotNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :page-id="pageId"
        :depth="depth + 1"
      />
    </div>
  </div>
</template>

<style scoped>
/* 快照只读行：去掉活编辑器的手势提示（文本光标 → 默认；dot 不放大） */
.snapshot-block .block-content {
  cursor: default;
}

.snapshot-block .bullet-dot {
  cursor: pointer;
  border-radius: 50%;
  transition: background-color 0.12s ease;
}

.snapshot-block .bullet-dot:hover {
  background: var(--bg-hover);
}

.snapshot-property-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.snapshot-property-item {
  display: flex;
  align-items: center;
  padding: 2px 0;
}

.snapshot-property-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-lg);
  line-height: var(--leading-none);
}
</style>
