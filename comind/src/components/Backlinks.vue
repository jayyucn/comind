<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePageStore } from '../stores/pages'
import { useEditorStore } from '../stores/editor'
import { storage } from '../storage/indexedDB'
import { db } from '../storage/db'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import type { LinkRecord } from '../types/link'

const props = withDefaults(defineProps<{
  pageId?: string
}>(), {
  pageId: undefined
})

const pageStore = usePageStore()
const editorStore = useEditorStore()
const { navigateToPage } = useNavigateToPage()

interface BacklinkItem {
  link: LinkRecord
  sourceContent: string
  sourcePageTitle: string
}

const backlinkItems = ref<BacklinkItem[]>([])
const loading = ref(false)
const collapsed = ref(false)
const bodyRef = ref<HTMLElement | null>(null)
const isAnimating = ref(false)
const linkStatusMap = ref<Map<string, { blockExists: boolean; pageExists: boolean }>>(new Map())

// 判断是否有Backlinks数据（用于条件显示）
const hasBacklinks = computed(() => backlinkItems.value.length > 0)

// 获取当前需要加载的pageId
const targetPageId = computed(() => props.pageId ?? pageStore.currentPageId)

// 点击 Backlink：跳转到该Block所在Page，并激活该Block
async function handleBacklinkClick(link: LinkRecord) {
  const status = getLinkStatus(link)
  if (!status.blockExists || !status.pageExists) return

  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }

  let blockRecord
  try {
    blockRecord = await db.blocks.get(link.sourceBlockId)
  } catch (err) {
    console.error('获取源块失败:', err)
    return
  }
  if (!blockRecord) return

  if (blockRecord.pageId !== pageStore.currentPageId) {
    await navigateToPage(blockRecord.pageId)
  }

  await nextTick()
  editorStore.activateBlock(link.sourceBlockId)
}

// 预计算每个link的存在状态 + 获取该block内容和所在page标题
async function loadBacklinks() {
  const currentId = targetPageId.value
  if (!currentId) {
    backlinkItems.value = []
    linkStatusMap.value = new Map()
    return
  }

  loading.value = true
  try {
    const links = await storage.getBacklinks(currentId)

    const results = await Promise.all(
      links.map(async (link) => {
        const key = `${link.sourceBlockId}_${link.targetPageId}`
        let blockExists = false
        let blockRecord = null

        try {
          blockRecord = await db.blocks.get(link.sourceBlockId)
          blockExists = !!blockRecord
        } catch (err) {
          console.error('获取源块失败:', err)
        }

        let pageExists = false
        let pageTitle = ''
        if (blockExists && blockRecord) {
          try {
            const pageRecord = await db.pages.get(blockRecord.pageId)
            pageExists = !!pageRecord
            pageTitle = pageRecord?.title ?? '未命名页面'
          } catch (err) {
            console.error('获取页面失败:', err)
          }
        }

        return {
          link,
          sourceContent: blockExists && blockRecord ? blockRecord.content : '',
          sourcePageTitle: pageTitle,
          status: { blockExists, pageExists },
          key
        }
      })
    )

    backlinkItems.value = results.map(r => ({
      link: r.link,
      sourceContent: r.sourceContent,
      sourcePageTitle: r.sourcePageTitle
    }))

    const statusMap = new Map<string, { blockExists: boolean; pageExists: boolean }>()
    for (const r of results) {
      statusMap.set(r.key, r.status)
    }
    linkStatusMap.value = statusMap
  } finally {
    loading.value = false
  }
}

function getLinkStatus(link: LinkRecord) {
  const key = `${link.sourceBlockId}_${link.targetPageId}`
  return linkStatusMap.value.get(key) ?? { blockExists: true, pageExists: true }
}

// 监听targetPageId变化，重新加载Backlinks
watch(
  targetPageId,
  () => loadBacklinks(),
  { immediate: true }
)

// 折叠动画
watch(collapsed, async (isCollapsed) => {
  const el = bodyRef.value
  if (!el) return
  if (isCollapsed) {
    el.style.maxHeight = el.scrollHeight + 'px'
    await nextTick()
    requestAnimationFrame(() => {
      el.style.maxHeight = '0px'
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  } else {
    el.style.maxHeight = 'none'
    const targetHeight = el.scrollHeight
    el.style.maxHeight = '0px'
    await nextTick()
    requestAnimationFrame(() => {
      el.style.maxHeight = targetHeight + 'px'
      setTimeout(() => { isAnimating.value = false }, 220)
    })
    isAnimating.value = true
  }
}, { flush: 'post' })

// 链接数量变化时重算高度
watch([backlinkItems, loading], async () => {
  if (collapsed.value) return
  await nextTick()
  if (bodyRef.value) bodyRef.value.style.maxHeight = 'none'
})
</script>

<template>
  <div v-if="hasBacklinks" class="backlinks-panel" :class="{ 'is-collapsed': collapsed }">
    <!-- 面板 Header：始终可见，点击切换折叠 -->
    <div class="backlinks-header" @click="collapsed = !collapsed">
      <span class="backlinks-title">
        <span class="backlinks-icon">🔗</span>
        反向链接
        <span class="backlinks-count">({{ backlinkItems.length }})</span>
      </span>
      <span class="backlinks-toggle">{{ collapsed ? '▶' : '▼' }}</span>
    </div>

    <!-- 折叠内容区：max-height 动画控制 -->
    <div ref="bodyRef" class="backlinks-body">
      <div v-if="loading" class="backlinks-loading">加载中...</div>

      <div v-else-if="backlinkItems.length === 0" class="backlinks-empty">
        暂无反向链接
      </div>

      <div v-else class="backlinks-list">
        <div v-for="item in backlinkItems" :key="item.link.sourceBlockId + item.link.targetPageId" class="backlink-item"
          :class="{
            'orphan-block': !getLinkStatus(item.link).blockExists,
            'orphan-page': getLinkStatus(item.link).blockExists && !getLinkStatus(item.link).pageExists
          }" @click="handleBacklinkClick(item.link)">
          <span class="backlink-text">{{ item.sourceContent || '空块' }}</span>
          <span class="backlink-page">{{ item.sourcePageTitle }}</span>
          <span v-if="!getLinkStatus(item.link).blockExists" class="backlink-hint">(来源块已删除)</span>
          <span v-else-if="!getLinkStatus(item.link).pageExists" class="backlink-hint">(来源页面已删除)</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Backlinks 面板布局方案�? * - 面板固定在页面底部，不随页面滚动
 * - 高度随链接数量增高，上限 400px（超出内部滚动）
 * - 页面主体区域可独立滚�? *
 * 父级布局要求（App.vue）：
 *   .app { display: flex; flex-direction: column; height: 100vh; }
 *   .main-scroll { flex: 1; overflow-y: auto; }
 *   .backlinks-panel { flex-shrink: 0; }
 */

.backlinks-panel {
  flex-shrink: 0;
  border-top: 2px dashed var(--border);
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
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) 0;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.backlinks-header:hover {
  background: var(--bg-hover);
}

.backlinks-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}

.backlinks-icon {
  font-size: var(--text-sm);
}

.backlinks-count {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-weight: 400;
}

.backlinks-toggle {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 2px var(--space-1);
}

/* 内容区：JS 通过 maxHeight 控制折叠动画 */
.backlinks-body {
  overflow: hidden;
  padding: 0 0 var(--space-4);
  /* WebKit 滚动条 */
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

.backlinks-loading,
.backlinks-empty {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: var(--space-4) var(--space-1);
  text-align: center;
}

.backlinks-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.backlink-item {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  transition: background 80ms ease;
}

.backlink-item:hover:not(.orphan-block):not(.orphan-page) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.backlink-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: var(--text-primary);
}

.backlink-page {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
  white-space: nowrap;
}

.backlink-hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-style: italic;
}

/* 悬空链接样式 - �?Block 已删�?*/
.backlink-item.orphan-block {
  opacity: 0.6;
  cursor: not-allowed;
}

.backlink-item.orphan-block .backlink-text {
  text-decoration: line-through;
}

/* 悬空链接样式 - �?Page 已删�?*/
.backlink-item.orphan-page {
  opacity: 0.6;
  cursor: not-allowed;
}

.backlink-item.orphan-page .backlink-text {
  text-decoration: line-through;
}
</style>
