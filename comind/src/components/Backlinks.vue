<script setup lang="ts">
import { ref, watch } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { storage } from '../storage/indexedDB'
import { db } from '../storage/db'
import type { LinkRecord } from '../types/link'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

interface BacklinkItem {
  link: LinkRecord
  sourceContent: string
  sourcePageTitle: string
}

const backlinkItems = ref<BacklinkItem[]>([])
const loading = ref(false)
const collapsed = ref(false)
const linkStatusMap = ref<Map<string, { blockExists: boolean; pageExists: boolean }>>(new Map())

// 点击 Backlink：跳转到源 Block 所在 Page，并激活该 Block
async function handleBacklinkClick(link: LinkRecord) {
  const status = getLinkStatus(link)
  if (!status.blockExists || !status.pageExists) return

  // 1. 先保存当前 block 内容（如果有）
  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }

  // 2. 从 storage 查源 Block（当前 page 的 blocks 可能不包含它）
  const blockRecord = await db.blocks.get(link.sourceBlockId)
  if (!blockRecord) return

  // 3. 切换到源 Block 所在 Page
  if (blockRecord.pageId !== pageStore.currentPageId) {
    await pageStore.openPage(blockRecord.pageId)
    await blockStore.loadPage(blockRecord.pageId)
  }

  // 4. 将源 Block 切换为 edit 态
  setTimeout(() => {
    editorStore.activateBlock(link.sourceBlockId)
  }, 0)
}

// 预计算每个 link 的存在状态 + 获取源 block 内容和所属 page 标题
async function loadBacklinks() {
  if (!pageStore.currentPageId) {
    backlinkItems.value = []
    linkStatusMap.value = new Map()
    return
  }

  loading.value = true
  try {
    const links = await storage.getBacklinks(pageStore.currentPageId)

    // 并行获取所有 link 的源 block 信息
    const results = await Promise.all(
      links.map(async (link) => {
        const key = `${link.sourceBlockId}_${link.targetPageId}`
        const blockRecord = await db.blocks.get(link.sourceBlockId)
        const blockExists = !!blockRecord

        let pageExists = false
        let pageTitle = ''
        if (blockExists) {
          const pageRecord = await db.pages.get(blockRecord!.pageId)
          pageExists = !!pageRecord
          pageTitle = pageRecord?.title ?? '未命名页面'
        }

        return {
          link,
          sourceContent: blockExists ? blockRecord!.content : '',
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

// 监听当前 Page 变化，重新加载 Backlinks
watch(
  () => pageStore.currentPageId,
  () => loadBacklinks(),
  { immediate: true }
)
</script>

<template>
  <div class="backlinks-section">
    <div class="backlinks-header" @click="collapsed = !collapsed">
      <span class="backlinks-title">
        <span class="backlinks-icon">↩</span>
        反向链接
        <span v-if="backlinkItems.length > 0" class="backlinks-count">({{ backlinkItems.length }})</span>
      </span>
      <span class="backlinks-toggle">{{ collapsed ? '▶' : '▼' }}</span>
    </div>

    <div v-if="!collapsed">
      <div v-if="loading" class="backlinks-loading">加载中...</div>

      <div v-else-if="backlinkItems.length === 0" class="backlinks-empty">
        暂无反向链接
      </div>

      <div v-else class="backlinks-list">
        <div
          v-for="item in backlinkItems"
          :key="item.link.sourceBlockId + item.link.targetPageId"
          class="backlink-item"
          :class="{
            'orphan-block': !getLinkStatus(item.link).blockExists,
            'orphan-page': getLinkStatus(item.link).blockExists && !getLinkStatus(item.link).pageExists
          }"
          @click="handleBacklinkClick(item.link)"
        >
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
.backlinks-section {
  margin-top: 48px;
  padding: 24px 0;
  border-top: 2px dashed #e8e0d4;
}

.backlinks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 8px 4px;
  cursor: pointer;
  border-radius: 6px;
  transition: background 80ms ease;
}

.backlinks-header:hover {
  background: #eeede9;
}

.backlinks-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #78716c;
  letter-spacing: 0.05em;
}

.backlinks-icon {
  font-size: 14px;
}

.backlinks-count {
  font-size: 12px;
  color: #a8a29e;
  font-weight: 400;
}

.backlinks-toggle {
  font-size: 10px;
  color: #a8a29e;
  padding: 2px 4px;
}

.backlinks-loading,
.backlinks-empty {
  font-size: 13px;
  color: #a8a29e;
  padding: 16px 4px;
  text-align: center;
}

.backlinks-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.backlink-item {
  padding: 12px 16px;
  font-size: 13px;
  color: #57534e;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  transition: background 80ms ease;
}

.backlink-item:hover:not(.orphan-block):not(.orphan-page) {
  background: #eeede9;
  color: #1c1917;
}

.backlink-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.backlink-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  color: #1c1917;
}

.backlink-page {
  font-size: 12px;
  color: #a8a29e;
  flex-shrink: 0;
  white-space: nowrap;
}

.backlink-hint {
  font-size: 12px;
  color: #a8a29e;
  font-style: italic;
}

/* 悬空链接样式 - 源 Block 已删除 */
.backlink-item.orphan-block {
  opacity: 0.6;
  cursor: not-allowed;
}

.backlink-item.orphan-block .backlink-text {
  text-decoration: line-through;
  font-weight: 400;
}

/* 悬空链接样式 - 源 Page 已删除 */
.backlink-item.orphan-page {
  opacity: 0.6;
  cursor: not-allowed;
}

.backlink-item.orphan-page .backlink-text {
  text-decoration: line-through;
  font-weight: 400;
}
</style>
