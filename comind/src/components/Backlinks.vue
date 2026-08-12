<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePageStore } from '../stores/pages'
import { useEditorStore } from '../stores/editor'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { useBlockStore } from '../stores/blocks'
import { usePropertyStore } from '../stores/property'
import { useBlockRegistry } from '../composables/useBlockRegistry'
import { buildDocumentOrder } from '../utils/block-helpers'
import type { Block } from '../types/block'
import PropertyInline from './Block/PropertyInline.vue'
import PropertyDisplay from './Block/PropertyDisplay.vue'

const props = withDefaults(defineProps<{
  pageId?: string
}>(), {
  pageId: undefined
})

const pageStore = usePageStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()
const propertyStore = usePropertyStore()
const { navigateToPage } = useNavigateToPage()
const { getHandler } = useBlockRegistry()

interface Link {
  id: string
  sourceBlockId: string
  targetPageId: string
  relationshipType: string | null
  createdAt: number
}

interface BacklinkItem {
  link: Link
  block: Block
}

interface BacklinkGroup {
  sourcePageId: string
  sourcePageTitle: string
  items: BacklinkItem[]
}

const groupedBacklinks = ref<BacklinkGroup[]>([])
const loading = ref(false)
const collapsed = ref(false)

const hasBacklinks = computed(() => groupedBacklinks.value.length > 0)
const targetPageId = computed(() => props.pageId ?? pageStore.currentPageId)

async function loadBacklinks() {
  const currentId = targetPageId.value
  if (!currentId) {
    groupedBacklinks.value = []
    return
  }

  loading.value = true
  try {
    // 2. 获取指向当前页的所有反链
    const links = await blockStore.getBacklinks(currentId)

    // 3. 解析每个 link 的 sourceBlockId → block（含 pageId）
    // 去重：按 sourceBlockId 去重（一个块内多个 [[B]] 引用只显示一次）
    const uniqueLinks = new Map<string, Link>()
    for (const link of links) {
      if (!uniqueLinks.has(link.sourceBlockId)) {
        uniqueLinks.set(link.sourceBlockId, link)
      }
    }

    // 并行加载所有去重后的块
    const blockEntries = await Promise.all(
      [...uniqueLinks.entries()].map(async ([sourceBlockId, link]) => {
        const block = await blockStore.loadBlock(sourceBlockId)
        return block ? { link, block } : null
      })
    )

    // 构建 itemMap，跳过 orphan-block
    const itemMap = new Map<string, BacklinkItem>()
    for (const entry of blockEntries) {
      if (entry) {
        itemMap.set(entry.link.sourceBlockId, entry)
      }
    }

    // 4. 收集所有 sourcePageId，加载完整页树（文档顺序排序需要）
    const sourcePageIds = [...new Set(
      [...itemMap.values()].map(item => item.block.pageId)
    )]
    if (sourcePageIds.length > 0) {
      const uncachedSourceIds = sourcePageIds.filter(
        id => blockStore.getBlocksByPage(id).length === 0
      )
      if (uncachedSourceIds.length > 0) {
        await blockStore.loadMultiPageBlocks(uncachedSourceIds)
      }
    }

    // 5. 过滤 orphan-page + 按 sourcePageId 分组
    const groupMap = new Map<string, BacklinkItem[]>()
    for (const item of itemMap.values()) {
      const page = pageStore.getPage(item.block.pageId)
      if (!page) continue // orphan-page 跳过
      const existing = groupMap.get(item.block.pageId) ?? []
      existing.push(item)
      groupMap.set(item.block.pageId, existing)
    }

    // 6. 组内排序（文档顺序）+ 组间排序（字母序）
    const groups: BacklinkGroup[] = []
    for (const [sourcePageId, items] of groupMap) {
      const page = pageStore.getPage(sourcePageId)!
      // 获取该页所有块，构建文档顺序
      const pageBlocks = blockStore.getBlocksByPage(sourcePageId)
      const orderMap = buildDocumentOrder(pageBlocks)
      // 按文档顺序排序组内块
      items.sort((a, b) => {
        const oa = orderMap.get(a.block.id) ?? 0
        const ob = orderMap.get(b.block.id) ?? 0
        return oa - ob
      })
      groups.push({
        sourcePageId,
        sourcePageTitle: page.title ?? '未命名页面',
        items
      })
    }
    // 按页面标题字母序排序
    groups.sort((a, b) => a.sourcePageTitle.localeCompare(b.sourcePageTitle))

    // 7. 加载所有块的属性（PropertyDisplay/PropertyInline 需要）
    const allBlockIds = groups.flatMap(g => g.items.map(i => i.block.id))
    await Promise.allSettled(
      allBlockIds.map(id => propertyStore.loadBlockProperties(id))
    )

    groupedBacklinks.value = groups
  } finally {
    loading.value = false
  }
}

// 点击块内容：处理 wiki link 导航（[[页面名]] / 外部链接），普通文本点击冒泡到 backlink-block
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const link = target.closest('.block-link') as HTMLElement | null
  if (!link) return

  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
    return
  }
  const pageName = link.dataset.page
  if (pageName) {
    navigateToPage(pageName).catch(err => {
      console.error('导航失败:', err)
    })
  }
}

// 点击反链块：跳转到源页 + 激活该块
// wiki link 点击由 handleContentClick 负责导航，此处跳过避免双重导航
async function handleBacklinkClick(item: BacklinkItem, event: MouseEvent) {
  if ((event.target as HTMLElement).closest('.block-link')) return

  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }

  const block = blockStore.getBlock(item.link.sourceBlockId)
  if (!block) return

  if (block.pageId !== pageStore.currentPageId) {
    await navigateToPage(block.pageId)
  }

  await nextTick()
  editorStore.activateBlock(item.link.sourceBlockId)
}

// 点击组标题：跳转到源页（不激活块）
async function handleGroupClick(sourcePageId: string) {
  if (sourcePageId !== pageStore.currentPageId) {
    await navigateToPage(sourcePageId)
  }
}

function getBlockPropertiesMap(blockId: string): Record<string, any> {
  const props = propertyStore.getBlockProperties(blockId)
  const result: Record<string, any> = {}
  for (const prop of props) {
    result[prop.key] = prop.value
  }
  return result
}

function getBlockLanguage(blockId: string): string | undefined {
  const prop = propertyStore.getBlockProperty(blockId, 'language')
  return prop?.value as string | undefined
}

// 监听 targetPageId 变化，重新加载 Backlinks
watch(
  targetPageId,
  () => loadBacklinks(),
  { immediate: true }
)

// grid-template-rows 由 CSS .is-collapsed 类控制，无需 JS 动画
</script>

<template>
  <div v-if="hasBacklinks" class="backlinks-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- 面板 Header：始终可见，点击切换折叠 -->
    <div class="backlinks-header" @click="collapsed = !collapsed">
      <span class="backlinks-toggle">{{ collapsed ? '▶' : '▼' }}</span>
      <span class="backlinks-title">
        反向链接
        <span class="backlinks-count">({{ groupedBacklinks.reduce((sum, g) => sum + g.items.length, 0) }})</span>
      </span>
    </div>

    <!-- 折叠内容区：grid-template-rows 动画，无 JS maxHeight 操作 -->
    <div class="backlinks-body-wrapper" :class="{ 'is-collapsed': collapsed }">
      <div class="backlinks-body">
        <div v-if="loading" class="backlinks-loading">加载中...</div>

        <div v-else class="backlinks-groups">
          <div
            v-for="group in groupedBacklinks"
            :key="group.sourcePageId"
            class="backlink-group"
          >
            <!-- 组标题：[[A]] (count)，点击跳转到源页 -->
            <div class="backlink-group-header" @click="handleGroupClick(group.sourcePageId)">
              <span class="backlink-group-title">[[{{ group.sourcePageTitle }}]]</span>
              <span class="backlink-group-count">({{ group.items.length }})</span>
            </div>

            <!-- 块列表：向右缩进 24px -->
            <div class="backlink-block-list">
              <div
                v-for="item in group.items"
                :key="item.link.sourceBlockId"
                class="backlink-block"
                @click="handleBacklinkClick(item, $event)"
              >
                <!-- Bullet（纯展示圆点，不可拖拽/折叠） -->
                <span class="block-bullet backlink-bullet">
                  <span class="bullet-dot"></span>
                </span>

                <!-- PropertyInline: between-bullet-content -->
                <PropertyInline
                  :block-id="item.link.sourceBlockId"
                  position="between-bullet-content"
                />

                <!-- 块内容：renderComponent（readonly） -->
                <component
                  v-if="getHandler(item.block.type)"
                  :is="getHandler(item.block.type)!.renderComponent"
                  :block-id="item.link.sourceBlockId"
                  :content="item.block.content"
                  :properties="getBlockPropertiesMap(item.link.sourceBlockId)"
                  :language="getBlockLanguage(item.link.sourceBlockId)"
                  :readonly="true"
                  @content-click="handleContentClick"
                />
                <span v-else class="backlink-text-fallback">{{ item.block.content || '空块' }}</span>

                <!-- PropertyInline: right-of-content -->
                <PropertyInline
                  :block-id="item.link.sourceBlockId"
                  position="right-of-content"
                />

                <!-- PropertyDisplay（下方属性区，stopPropagation） -->
                <div class="backlink-properties" @click.stop>
                  <PropertyDisplay :block-id="item.link.sourceBlockId" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Backlinks 面板布局方案（分组重构）
 * - 面板固定在页面底部，不随页面滚动
 * - 按来源页面分组，组标题左上角，块向右缩进 24px
 * - 面板级折叠（grid-template-rows CSS 动画）
 */

.backlinks-panel {
  flex-shrink: 0;
  border-top: 2px  var(--border);
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  padding: 0;
  max-width: var(--max-width);
  width: 100%;
  box-sizing: border-box;
}

.backlinks-header {
  display: flex;
  justify-content: flex-start;
  padding: var(--space-3) 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.backlinks-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  letter-spacing: var(--letter-wide-2);
}

.backlinks-icon {
  font-size: var(--text-sm);
}

.backlinks-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: var(--font-normal);
}

.backlinks-toggle {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 2px var(--space-1);
  /* 展开 + 非 hover 时隐藏；hover 或折叠时可见 */
  opacity: 0;
  transition: opacity 120ms ease;
}

.backlinks-header:hover .backlinks-toggle,
.backlinks-panel.is-collapsed .backlinks-toggle {
  opacity: 1;
}

/*
 * 折叠动画：grid-template-rows: 0fr → 1fr
 * - 无 JS maxHeight 操作，纯 CSS 过渡
 * - overflow: hidden 始终在 inner 层，内容彻底裁剪无泄漏
 * - 0fr 等效于 row 高度 0（子元素 overflow hidden），1fr 等效于 auto
 */
.backlinks-body-wrapper {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 200ms ease;
  overflow: hidden;
  /* body 相对 header 向右缩进 24px（与 backlink-block-list 对齐） */
  padding-left: 24px;
}

.backlinks-body-wrapper.is-collapsed {
  grid-template-rows: 0fr;
  height: 0;
}

/* inner 层：min-height: 0 + overflow: hidden 彻底裁剪 */
.backlinks-body {
  /* min-height: 0 允许 grid item 收缩到 0（覆盖默认的 min-height: auto） */
  min-height: 0;
  overflow: hidden;
  /* padding 放在 inner 层，这样折叠时 padding 也被裁剪 */
  padding-bottom: var(--space-4);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.backlinks-body::-webkit-scrollbar {
  width: 4px;
}

.backlinks-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.backlinks-body::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

.backlinks-loading {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: var(--space-4) var(--space-1);
  text-align: center;
}

/* 分组容器 */
.backlinks-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

/* 组标题 */
.backlink-group-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--space-2) 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.backlink-group-header:hover {
  background: var(--bg-hover);
}

.backlink-group-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-primary);
}

.backlink-group-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: var(--font-normal);
}

/* 块列表：由外层 backlinks-body-wrapper 统一缩进 */
.backlink-block-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 单个反链块 */
.backlink-block {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--space-0);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 80ms ease;
}

.backlink-block:hover {
  background: var(--bg-hover);
}

/* Bullet：覆盖全局 .block-bullet 的 cursor 和 hover */
.backlink-bullet {
  cursor: default;
}

.backlink-bullet:hover .bullet-dot {
  opacity: var(--block-bullet-opacity);
  transform: translateY(1px);
  box-shadow: none;
}

/* renderComponent 内容区 */
.backlink-block > :deep(.block-render) {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-normal);
}

/* fallback 纯文本（无 handler 时） */
.backlink-text-fallback {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
  color: var(--text-primary);
}

/* PropertyDisplay 下方属性区 */
.backlink-properties {
  width: 100%;
  padding-left: 24px; /* 对齐 bullet 宽度 20px + gap 4px */
}
</style>
