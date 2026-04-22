<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const newPageTitle = ref('')
const creating = ref(false)

onMounted(async () => {
  await pageStore.loadAllPages()
  if (pageStore.pages.length > 0) {
    await pageStore.openPage(pageStore.pages[0].id)
    ensureFirstBlock()
  }
})

function ensureFirstBlock() {
  const hasBlock = blockStore.blocks.some(b => b.pageId === pageStore.currentPageId && b.parentId === null)
  if (!hasBlock) {
    blockStore.createBlock({ pageId: pageStore.currentPageId, content: '' })
  }
}

async function handleCreatePage() {
  const title = newPageTitle.value.trim()
  if (!title) return
  creating.value = true
  try {
    const page = await pageStore.createPage(title)
    await pageStore.openPage(page.id)
    ensureFirstBlock()
    newPageTitle.value = ''
  } finally {
    creating.value = false
  }
}

async function handleOpenPage(pageId: string) {
  await pageStore.openPage(pageId)
  ensureFirstBlock()
}
</script>

<template>
  <aside class="sidebar">
    <!-- Logo 标题 -->
    <div class="sidebar-header">
      <span class="sidebar-logo">COMIND</span>
    </div>

    <!-- 页面列表 -->
    <div class="sidebar-pages">
      <div
        v-for="page in pageStore.pages"
        :key="page.id"
        class="page-item"
        :class="{ active: pageStore.currentPageId === page.id }"
        tabindex="0"
        @click="handleOpenPage(page.id)"
        @keydown.enter="handleOpenPage(page.id)"
      >
        <span class="page-icon">📄</span>
        <span class="page-title">{{ page.title }}</span>
        <span class="page-time">{{ formatTime(page.updatedAt) }}</span>
      </div>

      <!-- 无页面时 -->
      <div v-if="pageStore.pages.length === 0" class="sidebar-empty">
        <div class="sidebar-empty-title">暂无页面</div>
        <div class="sidebar-empty-sub">点击下方按钮创建</div>
      </div>
    </div>

    <!-- 新建页面 -->
    <div class="sidebar-footer">
      <div class="new-page-form">
        <input
          v-model="newPageTitle"
          class="new-page-input"
          placeholder="页面标题..."
          @keydown.enter="handleCreatePage"
        />
        <button
          class="new-page-btn"
          :disabled="creating || !newPageTitle.trim()"
          @click="handleCreatePage"
        >+</button>
      </div>
    </div>
  </aside>
</template>

<script lang="ts">
// 时间格式化工具
function formatTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 2 * hour) return '1 小时前'
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'

  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<style scoped>
.sidebar {
  width: 240px;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
}

/* ── 顶部标题 ── */
.sidebar-header {
  padding: 14px var(--space-4) 12px;
  border-bottom: 1px solid var(--border);
  height: 40px;
  display: flex;
  align-items: center;
}

.sidebar-logo {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* ── 页面列表 ── */
.sidebar-pages {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-1) 0;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.sidebar-pages::-webkit-scrollbar {
  width: 4px;
}

.sidebar-pages::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 2px;
}

.page-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px var(--space-4);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 0;
  transition: none;
  position: relative;
}

.page-item:hover {
  background: var(--bg-hover);
}

.page-item.active {
  background: var(--bg-active);
}

.page-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent);
}

.page-icon {
  font-size: 14px;
  flex-shrink: 0;
  line-height: 1;
}

.page-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
}

.page-time {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  font-weight: 400;
}

/* ── 空状态 ── */
.sidebar-empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
}

.sidebar-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.sidebar-empty-sub {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 底部新建 ── */
.sidebar-footer {
  padding: var(--space-3);
  border-top: 1px solid var(--border);
}

.new-page-form {
  display: flex;
  gap: 6px;
  align-items: center;
}

.new-page-input {
  flex: 1;
  padding: 5px var(--space-2);
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--color-white);
  outline: none;
  font-family: inherit;
  color: var(--text-primary);
  transition: border-color 80ms ease;
}

.new-page-input::placeholder {
  color: var(--text-tertiary);
  font-style: italic;
}

.new-page-input:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}

.new-page-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: var(--accent);
  color: var(--color-white);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 80ms ease;
}

.new-page-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.new-page-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
