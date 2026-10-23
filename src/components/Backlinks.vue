<script setup lang="ts">
import { ChevronDown, FileText } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'

import { useBlockRegistry } from '../composables/useBlockRegistry'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { useNavigateToTag } from '../composables/useNavigateToTag'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { useFieldValueStore } from '../stores/fieldValue'
import { usePageStore } from '../stores/pages'
import { useTagsStore } from '../stores/tags'
import type { Block } from '../types/block'
import type { FieldValueData } from '../types/field-definition'
import { buildDocumentOrder } from '../utils/block-helpers'
import { extractFieldBacklinks } from '../utils/field-backlinks'
import { decodeFieldValueData } from '../utils/field-value-codec'
import BlockFieldZone from './Block/BlockFieldZone.vue'

const props = withDefaults(defineProps<{
  pageId?: string
}>(), {
  pageId: undefined
})

const pageStore = usePageStore()
const editorStore = useEditorStore()
const blockStore = useBlockStore()
const fieldValueStore = useFieldValueStore()
const tagsStore = useTagsStore()
const { navigateToPage } = useNavigateToPage()
const { navigateToTag } = useNavigateToTag()
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
    // 字段名取自持久化定义（tagsStore.fieldDefinitions）。反链可能先于块字段区首次
    // 渲染加载，缺定义时字段标题会退化成 `f-*` 内部 key。失败不阻断反链本体。
    await Promise.allSettled([tagsStore.ensureLoaded()])

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

    // 3.5 字段引用并入反链（issue T3 AC4）：content 解析（[[X]]）覆盖不到的
    //     字段值引用——前端聚合，遍历字段值缓存中 value_type==='page' 且值=本页
    //     id 的块（最小实现，不动 Rust；缓存只含本会话已加载块，见 field-backlinks.ts）。
    for (const { blockId } of extractFieldBacklinks(fieldValueStore.fieldValuesByBlock, currentId)) {
      if (!uniqueLinks.has(blockId)) {
        uniqueLinks.set(blockId, {
          id: `field-ref:${blockId}`,
          sourceBlockId: blockId,
          targetPageId: currentId,
          relationshipType: 'field-ref',
          createdAt: 0,
        })
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
    // loadMultiPageBlocks 内部按「整页是否已缓存」过滤：仅经上面 loadBlock 单块
    // 预览过的源页（store 只有零散块）会在此整页补齐 —— 否则后续导航打开该页时
    // ensurePageBlocks 误判已缓存而跳过拉取，页面内容残缺。
    const sourcePageIds = [...new Set(
      [...itemMap.values()].map(item => item.block.pageId)
    )]
    if (sourcePageIds.length > 0) {
      await blockStore.loadMultiPageBlocks(sourcePageIds)
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

    // 7. 加载所有块的字段值（BlockFieldZone 需要）
    const allBlockIds = groups.flatMap(g => g.items.map(i => i.block.id))
    await Promise.allSettled(
      allBlockIds.map(id => fieldValueStore.loadBlockFieldValues(id))
    )

    groupedBacklinks.value = groups
  } finally {
    loading.value = false
  }
}

// 点击块内容：处理 inline #tag 与 wiki link（[[页面名]] / 外部链接）导航，
// 普通文本点击冒泡到 backlink-block
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement

  // ADR-0050 D7：inline `#tag` chip → 该 tag 的聚合页，与正文渲染态同口径。
  // 必须先于 `.block-link` 判定：纯文本兜底渲染出的 tag 同时带 `block-link` 类
  // 和 `data-page="标签名"`，走链接分支会跳到一个不存在同名页面的地址。
  const tagChip = target.closest('.block-tag') as HTMLElement | null
  if (tagChip) {
    const tagId = tagChip.dataset.tagId
    if (tagId) {
      navigateToTag(tagId).catch(err => {
        console.error('标签导航失败:', err)
      })
    }
    return
  }

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
// wiki link / tag 点击由 handleContentClick 负责导航，此处跳过避免双重导航
async function handleBacklinkClick(item: BacklinkItem, event: MouseEvent) {
  const target = event.target as HTMLElement
  if (target.closest('.block-link') || target.closest('.block-tag')) return

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

function getBlockFieldValuesMap(blockId: string): Record<string, FieldValueData> {
  const rows = fieldValueStore.getBlockFieldValues(blockId)
  const result: Record<string, FieldValueData> = {}
  for (const fv of rows) {
    result[fv.key] = decodeFieldValueData(fv.value_json, fv.value_type) as FieldValueData
  }
  return result
}

function getBlockLanguage(blockId: string): string | undefined {
  const fv = fieldValueStore.getBlockFieldValue(blockId, 'language')
  return fv ? (decodeFieldValueData(fv.value_json, fv.value_type) as string) : undefined
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
  <div
    v-if="hasBacklinks"
    class="backlinks-panel"
    :class="{ 'is-collapsed': collapsed }"
  >
    <!-- 面板 Header：始终可见，点击切换折叠 -->
    <div
      class="backlinks-header"
      @click="collapsed = !collapsed"
    >
      <!-- 折叠指示：与 block 的 bullet-chevron 同一个 lucide 图标（ChevronDown），
           折叠态由 CSS rotate(-90°) 表达（同 _block.scss 的 .bullet-chevron），
           不做 v-if 换图标——换图标只能瞬间跳变，旋转才能与折叠动画同时起止。
           箭头只表示折叠态，header 整行才是点击目标。 -->
      <span class="backlinks-toggle">
        <ChevronDown
          :size="16"
          :stroke-width="2"
        />
      </span>
      <span class="backlinks-title">
        反向链接
        <span class="backlinks-count">({{ groupedBacklinks.reduce((sum, g) => sum + g.items.length, 0) }})</span>
      </span>
    </div>

    <!-- 折叠内容区：grid-template-rows 动画，无 JS maxHeight 操作 -->
    <div
      class="backlinks-body-wrapper"
      :class="{ 'is-collapsed': collapsed }"
    >
      <div class="backlinks-body">
        <div
          v-if="loading"
          class="backlinks-loading"
        >
          加载中...
        </div>

        <div
          v-else
          class="backlinks-groups"
        >
          <div
            v-for="group in groupedBacklinks"
            :key="group.sourcePageId"
            class="backlink-group"
          >
            <!-- 组标题：页面身份（图标 + 页名）+ 计数，点击跳转到源页。
                 不拼 `[[ ]]`——分组键是页面实体，不是正文里的 wiki link 语法，
                 原样拼括号在视觉上等于「未渲染的源码」。 -->
            <div
              class="backlink-group-header"
              @click="handleGroupClick(group.sourcePageId)"
            >
              <FileText
                class="backlink-group-icon"
                :size="13"
                aria-hidden="true"
              />
              <span class="backlink-group-title">{{ group.sourcePageTitle }}</span>
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
                  <span class="bullet-dot" />
                </span>

                <!-- 内联槽: between -->
                <BlockFieldZone
                  :block-id="item.link.sourceBlockId"
                  variant="between"
                />

                <!-- 块内容：renderComponent（readonly） -->
                <component
                  :is="getHandler(item.block.type)!.renderComponent"
                  v-if="getHandler(item.block.type)"
                  :block-id="item.link.sourceBlockId"
                  :content="item.block.content"
                  :field-values="getBlockFieldValuesMap(item.link.sourceBlockId)"
                  :language="getBlockLanguage(item.link.sourceBlockId)"
                  :readonly="true"
                  @content-click="handleContentClick"
                />
                <span
                  v-else
                  class="backlink-text-fallback"
                >{{ item.block.content || '空块' }}</span>

                <!-- 下方字段区：只读投影，自身不再拦截点击——点字段冒泡到块行，
                     语义等于「跳到源块的这一处」 -->
                <div class="backlink-properties">
                  <BlockFieldZone
                    :block-id="item.link.sourceBlockId"
                    variant="all"
                  />
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
  transition: background var(--dur-fast) var(--ease-out);
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  padding: 2px var(--space-1);
  /* 展开 + 非 hover 时隐藏；hover 或折叠时可见 */
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);

  svg {
    display: block;
    /* 折叠方向旋转的过渡基线：与 .backlinks-body-wrapper 的 grid-template-rows
       动画逐字一致（--dur-base + --ease-in-out），起止同步。 */
    transition: transform var(--dur-base) var(--ease-in-out);
  }
}

.backlinks-panel.is-collapsed .backlinks-toggle svg {
  transform: rotate(-90deg);
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
  transition: grid-template-rows var(--dur-base) var(--ease-in-out);
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

/* 组标题 = 页面身份行（图标 + 页名 + 计数）。
   hover 只染字色不改底：底留给块行，否则「组头」与「块行」争同一视觉权重。 */
.backlink-group-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0 var(--space-1);
  cursor: pointer;
}

.backlink-group-icon {
  flex: none;
  color: var(--text-tertiary);
  transition: color var(--dur-fast) var(--ease-out);
}

.backlink-group-header:hover .backlink-group-icon {
  color: var(--accent);
}

.backlink-group-title {
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  /* 与面板标题（--text-secondary）同色会读成同层：组标题是列表的结构锚点，
     保持 primary，靠图标与 medial 字重和块正文区分 */
  color: var(--text-primary);
  transition: color var(--dur-fast) var(--ease-out);
}

.backlink-group-header:hover .backlink-group-title {
  color: var(--accent);
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
  transition: background var(--dur-fast) var(--ease-out);
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

/* 块内字段区（all 变体，只读）+ 视觉分层：
   1. 压到块正文之下一档——字段是块的元数据，不是块的正文；
   2. 抹掉 all 变体自带的纱底与外边距，那是块内语境，在反链行里会与行 hover 底打架；
   3. 去掉 chip 的 hover 反馈与手型：此处不可编辑，唯一交互是「跳到源块」。 */
.backlink-properties {
  width: 100%;
  padding-left: 24px; /* 对齐 bullet 宽度 20px + gap 4px */
}

.backlink-properties :deep(.property-display) {
  margin-top: 2px;
  padding: 0;
  background: transparent;
}

.backlink-properties :deep(.property-item) {
  font-size: var(--text-xs);
  cursor: default;
}

.backlink-properties :deep(.property-item:hover) {
  background: transparent;
}

/* 字段名统一压到 tertiary：含 built-in 字段，其强调色在次要区里会跳（优先级需压过
   `.property-item.built-in .property-key`，故选择器逐层写全） */
.backlink-properties :deep(.property-item .property-key),
.backlink-properties :deep(.property-item.built-in .property-key) {
  color: var(--text-tertiary);
  font-weight: var(--font-normal);
}

.backlink-properties :deep(.block-field-zone-chip) {
  font-size: var(--text-xs);
  line-height: calc(var(--leading-normal) * var(--text-xs));
  cursor: default;
}

.backlink-properties :deep(.block-field-zone-chip:hover) {
  background: transparent;
  border-color: var(--border-color);
}

/* 值比字段名亮一档，但仍低于块正文（--text-primary）：层级 = 正文 > 值 > 字段名 */
.backlink-properties :deep(.bfz-chip-value) {
  color: var(--text-secondary);
}
</style>
