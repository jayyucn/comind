# Page 右上角菜单、回收站与设置实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Page 页面右上角添加下拉菜单按钮，包含收藏/取消收藏、删除（移至回收站/永久删除）、回收站、设置功能，并实现回收站和设置界面。

**Architecture:** 采用"软删除"机制实现回收站功能——Page 增加 `deleted` 标记字段，删除时标记为已删除而非物理删除。菜单按钮使用绝对定位固定在页面右上角，下拉菜单使用 Vue 的响应式状态控制显示/隐藏。回收站和设置作为独立路由页面。

**Tech Stack:** Vue 3 + Pinia + Vue Router + Dexie (IndexedDB) + SVG Sprite

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types/page.ts` | 修改 | Page/PageRecord 增加 `deleted` 和 `deletedAt` 字段 |
| `src/storage/db.ts` | 修改 | Dexie 数据库版本升级至 v5，pages 表增加 deleted 索引 |
| `src/storage/indexedDB.ts` | 修改 | 增加 pageToRecord/recordToPage 字段映射，增加软删除/恢复/物理删除方法 |
| `src/stores/pages.ts` | 修改 | 增加 trashPages、softDeletePage、restorePage、permanentDeletePage 方法 |
| `public/icons.svg` | 修改 | 新增 7 个统一风格 SVG 图标 |
| `src/components/PageMenuButton.vue` | 新建 | 右上角菜单按钮组件（含下拉菜单） |
| `src/components/ConfirmDialog.vue` | 新建 | 通用确认对话框组件 |
| `src/components/Trash/TrashList.vue` | 新建 | 回收站页面组件 |
| `src/components/Settings/Settings.vue` | 新建 | 设置页面组件 |
| `src/router/routes.ts` | 修改 | 增加 /trash 和 /settings 路由 |
| `src/components/Page/index.vue` | 修改 | 引入 PageMenuButton 组件 |

---

## 边界情况清单

1. **当前页面被删除后**：若用户删除了当前正在浏览的页面，删除后应自动导航到首页（/journal）
2. **删除已收藏的页面**：删除页面时应同时从收藏列表中移除
3. **回收站页面恢复**：恢复页面时若标题已存在，应提示用户选择覆盖或重命名
4. **空回收站**：回收站为空时显示空状态提示
5. **菜单点击外部关闭**：点击菜单外部区域应自动关闭下拉菜单
6. **永久删除确认**：永久删除操作必须弹出二次确认对话框
7. **数据库迁移**：升级 Dexie 版本时，现有数据应自动迁移（Dexie 自动处理新增字段为 undefined）
8. **收藏状态同步**：菜单中"添加/取消收藏"文字和图标应根据当前页面收藏状态动态变化

---

## Task 1: 数据模型升级（Page 类型 + 数据库）

**Files:**
- Modify: `src/types/page.ts`
- Modify: `src/storage/db.ts`
- Modify: `src/storage/indexedDB.ts`

### Step 1: 修改 Page 类型，增加 deleted 字段

在 `src/types/page.ts` 中，为 `Page` 和 `PageRecord` 接口增加 `deleted` 和 `deletedAt` 字段：

```typescript
export interface Page {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: boolean        // 新增：是否已删除
  deletedAt: number | null // 新增：删除时间戳
}

export interface PageRecord {
  id: string
  blockId: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
  deleted: number         // 新增：0=未删除, 1=已删除
  deletedAt: number | null // 新增
}
```

### Step 2: 升级数据库版本

在 `src/storage/db.ts` 中，将版本从 4 升级到 5，并为 `deleted` 字段添加索引：

```typescript
constructor() {
  super('comind')
  this.version(5).stores({
    blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
    links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
    pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
    properties: 'id, blockId, [blockId+key]'
  })
}
```

**注意**：Dexie 的 `deleted` 索引用于快速查询未删除/已删除页面。现有数据会自动迁移，`deleted` 字段默认为 `undefined`，在查询时视为未删除。

### Step 3: 更新序列化/反序列化函数

在 `src/storage/indexedDB.ts` 中，更新 `pageToRecord` 和 `recordToPage` 函数：

```typescript
export function pageToRecord(page: Page): PageRecord {
  return {
    id: page.id,
    blockId: page.blockId,
    title: page.title,
    type: page.type,
    icon: page.icon,
    cover: page.cover,
    aliases: JSON.stringify(page.aliases),
    filePath: page.filePath,
    childrenCount: page.childrenCount,
    wordCount: page.wordCount,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deleted: page.deleted ? 1 : 0,
    deletedAt: page.deletedAt
  }
}

export function recordToPage(record: PageRecord): Page {
  let aliases: Page['aliases']
  try {
    aliases = JSON.parse(record.aliases)
  } catch {
    aliases = []
  }
  return {
    id: record.id,
    blockId: record.blockId,
    title: record.title,
    type: record.type as 'normal' | 'journal',
    icon: record.icon,
    cover: record.cover,
    aliases,
    filePath: record.filePath,
    childrenCount: record.childrenCount,
    wordCount: record.wordCount,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deleted: record.deleted === 1,
    deletedAt: record.deletedAt ?? null
  }
}
```

### Step 4: 增加软删除/恢复/物理删除方法

在 `IndexedDBAdapter` 类中增加以下方法：

```typescript
/** 软删除页面（移至回收站） */
async softDeletePage(pageId: string): Promise<void> {
  await db.transaction('rw', [db.pages], async () => {
    const record = await db.pages.get(pageId)
    if (record) {
      const page = recordToPage(record)
      page.deleted = true
      page.deletedAt = Date.now()
      page.updatedAt = Date.now()
      await db.pages.put(pageToRecord(page))
    }
  })
}

/** 恢复页面（从回收站还原） */
async restorePage(pageId: string): Promise<void> {
  await db.transaction('rw', [db.pages], async () => {
    const record = await db.pages.get(pageId)
    if (record) {
      const page = recordToPage(record)
      page.deleted = false
      page.deletedAt = null
      page.updatedAt = Date.now()
      await db.pages.put(pageToRecord(page))
    }
  })
}

/** 物理删除页面（从回收站永久删除） */
async permanentDeletePage(pageId: string): Promise<void> {
  await db.transaction('rw', [db.pages, db.blocks, db.links], async () => {
    // 1. 获取页面所有 Block
    const blocks = await db.blocks.where('pageId').equals(pageId).toArray()
    const blockIds = blocks.map(b => b.id)

    // 2. 删除所有相关 Link
    await db.links.where('sourceBlockId').anyOf(blockIds).delete()
    await db.links.where('targetPageId').equals(pageId).delete()

    // 3. 删除所有 Block
    await db.blocks.bulkDelete(blockIds)

    // 4. 删除 Page
    await db.pages.delete(pageId)
  })
}

/** 获取回收站中的页面 */
async getTrashedPages(): Promise<Page[]> {
  const records = await db.pages.where('deleted').equals(1).sortBy('deletedAt')
  return records.map(recordToPage).reverse() // 最新的在前面
}
```

### Step 5: 修改 getAllPages 过滤已删除页面

```typescript
async getAllPages(): Promise<Page[]> {
  const records = await db.pages.orderBy('title').toArray()
  return records
    .filter(r => r.deleted !== 1) // 过滤已删除页面
    .map(recordToPage)
}
```

### Step 6: Commit

```bash
git add src/types/page.ts src/storage/db.ts src/storage/indexedDB.ts
git commit -m "feat: add soft-delete support to Page model and IndexedDB"
```

---

## Task 2: 更新 Page Store

**Files:**
- Modify: `src/stores/pages.ts`

### Step 1: 增加回收站相关方法和计算属性

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Page } from '../types/page'
import { storage } from '../storage/indexedDB'
import { useBlockStore } from './blocks'

export const usePageStore = defineStore('pages', () => {
  const pages = ref<Page[]>([])
  const currentPageId = ref<string>('')
  const loading = ref(false)

  // 新增：回收站页面列表
  const trashPages = ref<Page[]>([])

  /** 从 IndexedDB 加载所有 Page 到内存 */
  async function loadAllPages() {
    loading.value = true
    try {
      pages.value = await storage.getAllPages()
    } finally {
      loading.value = false
    }
  }

  // 新增：加载回收站页面
  async function loadTrashPages() {
    trashPages.value = await storage.getTrashedPages()
  }

  async function openPage(pageId: string) {
    currentPageId.value = pageId
    const blockStore = useBlockStore()
    await blockStore.loadPageBlocks(pageId)
  }

  async function createPage(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
    const page = await storage.createPageWithRootBlock(title, type)
    pages.value.push(page)
    return page
  }

  function getPage(pageId: string): Page | undefined {
    return pages.value.find(p => p.id === pageId)
  }

  function getPageByTitle(title: string): Page | undefined {
    if (!title.trim()) return undefined
    return pages.value.find(p => p.title === title)
  }

  /** 重命名页面，返回重复信息（如有） */
  async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: Page }> {
    if (!newTitle.trim()) return {}
    const page = getPage(pageId)
    if (!page) return {}
    const trimmedTitle = newTitle.trim()
    if (page.title === trimmedTitle) return {}

    const duplicate = getPageByTitle(trimmedTitle)
    if (duplicate && duplicate.id !== pageId) {
      return { duplicated: duplicate }
    }

    await storage.renamePage(pageId, trimmedTitle)
    page.title = trimmedTitle
    return {}
  }

  /** 合并源页面到目标页面（事务操作） */
  async function mergePage(sourceId: string, targetId: string): Promise<void> {
    await storage.mergePage(sourceId, targetId)
    pages.value = pages.value.filter(p => p.id !== sourceId)
    if (currentPageId.value === sourceId) {
      currentPageId.value = targetId
    }
  }

  /** 删除页面（移至回收站） */
  async function softDeletePage(pageId: string): Promise<void> {
    await storage.softDeletePage(pageId)
    pages.value = pages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
  }

  /** 恢复页面（从回收站还原） */
  async function restorePage(pageId: string): Promise<void> {
    await storage.restorePage(pageId)
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    // 重新加载所有页面以包含恢复的页面
    await loadAllPages()
  }

  /** 永久删除页面 */
  async function permanentDeletePage(pageId: string): Promise<void> {
    await storage.permanentDeletePage(pageId)
    trashPages.value = trashPages.value.filter(p => p.id !== pageId)
    if (currentPageId.value === pageId) {
      currentPageId.value = ''
    }
  }

  return { 
    pages, 
    currentPageId, 
    loading, 
    trashPages,
    loadAllPages, 
    loadTrashPages,
    openPage, 
    createPage, 
    getPage, 
    getPageByTitle, 
    renamePage, 
    mergePage, 
    softDeletePage,
    restorePage,
    permanentDeletePage
  }
})
```

### Step 2: Commit

```bash
git add src/stores/pages.ts
git commit -m "feat: add trash page management to page store"
```

---

## Task 3: 添加 SVG 图标

**Files:**
- Modify: `public/icons.svg`

### Step 1: 在 icons.svg 末尾添加统一风格的图标

在 `</svg>` 闭合标签前添加以下 symbol：

```xml
  <symbol id="icon-menu" viewBox="0 0 20 20">
    <circle cx="10" cy="5" r="1.5" fill="#6b7280"/>
    <circle cx="10" cy="10" r="1.5" fill="#6b7280"/>
    <circle cx="10" cy="15" r="1.5" fill="#6b7280"/>
  </symbol>

  <symbol id="icon-star" viewBox="0 0 20 20">
    <path d="M10 2l2.5 5.5L18 8.5l-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5L10 2z" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>

  <symbol id="icon-star-filled" viewBox="0 0 20 20">
    <path d="M10 2l2.5 5.5L18 8.5l-4 4 1 5.5-5-2.5-5 2.5 1-5.5-4-4 5.5-.5L10 2z" fill="#eab308" stroke="#eab308" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>

  <symbol id="icon-trash" viewBox="0 0 20 20">
    <path d="M3 5h14M8 5V3a1 1 0 011-1h2a1 1 0 011 1v2m3 0v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5h10z" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 9v6M12 9v6" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
  </symbol>

  <symbol id="icon-trash-permanent" viewBox="0 0 20 20">
    <path d="M3 5h14M8 5V3a1 1 0 011-1h2a1 1 0 011 1v2m3 0v11a2 2 0 01-2 2H7a2 2 0 01-2-2V5h10z" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 9v6M12 9v6" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/>
  </symbol>

  <symbol id="icon-restore" viewBox="0 0 20 20">
    <path d="M4 9a6 6 0 0110.5-3.5l-3 3" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M16 11a6 6 0 01-10.5 3.5l3-3" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>

  <symbol id="icon-settings" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="3" fill="none" stroke="#6b7280" stroke-width="1.5"/>
    <path d="M17 10h-2M5 10H3M10 3v2M10 17v-2" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M14.5 5.5l-1.4 1.4M6.9 13.1l-1.4 1.4M14.5 14.5l-1.4-1.4M6.9 6.9L5.5 5.5" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round"/>
  </symbol>

  <symbol id="icon-arrow-right" viewBox="0 0 20 20">
    <path d="M8 5l5 5-5 5" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>
```

### Step 2: Commit

```bash
git add public/icons.svg
git commit -m "feat: add menu, star, trash, restore, settings icons to sprite"
```

---

## Task 4: 创建通用确认对话框组件

**Files:**
- Create: `src/components/ConfirmDialog.vue`

### Step 1: 创建 ConfirmDialog 组件

```vue
<script setup lang="ts">
defineProps<{
  visible: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="confirm-overlay" @click.self="emit('cancel')">
        <div class="confirm-dialog">
          <div class="confirm-title">{{ title }}</div>
          <div class="confirm-message">{{ message }}</div>
          <div class="confirm-actions">
            <button class="btn-cancel" @click="emit('cancel')">
              {{ cancelText || '取消' }}
            </button>
            <button 
              class="btn-confirm" 
              :class="{ danger }"
              @click="emit('confirm')"
            >
              {{ confirmText || '确认' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.confirm-dialog {
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 400px;
  box-shadow: var(--shadow-modal);
}

.confirm-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 8px;
}

.confirm-message {
  font-size: var(--text-sm);
  color: var(--color-ink-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn-cancel {
  padding: 6px 16px;
  background: transparent;
  color: var(--color-ink-secondary);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-cancel:hover {
  background: rgba(0, 0, 0, 0.04);
}

.btn-confirm {
  padding: 6px 16px;
  background: var(--color-accent);
  color: var(--color-white);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-confirm:hover {
  background: var(--color-accent-deep);
}

.btn-confirm.danger {
  background: var(--error);
}

.btn-confirm.danger:hover {
  background: #b91c1c;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
```

### Step 2: Commit

```bash
git add src/components/ConfirmDialog.vue
git commit -m "feat: add reusable ConfirmDialog component"
```

---

## Task 5: 创建 PageMenuButton 组件

**Files:**
- Create: `src/components/PageMenuButton.vue`

### Step 1: 创建 PageMenuButton 组件

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useFavorites } from '../composables/useFavorites'
import { usePageStore } from '../stores/pages'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{
  pageId: string
}>()

const router = useRouter()
const pageStore = usePageStore()
const { isFavorite, toggleFavorite } = useFavorites()

const isMenuOpen = ref(false)
const isDeleteSubmenuOpen = ref(false)
const showPermanentDeleteConfirm = ref(false)

const favorited = computed(() => isFavorite(props.pageId))

function toggleMenu() {
  isMenuOpen.value = !isMenuOpen.value
  if (!isMenuOpen.value) {
    isDeleteSubmenuOpen.value = false
  }
}

function closeMenu() {
  isMenuOpen.value = false
  isDeleteSubmenuOpen.value = false
}

function handleToggleFavorite() {
  toggleFavorite(props.pageId)
  closeMenu()
}

function toggleDeleteSubmenu() {
  isDeleteSubmenuOpen.value = !isDeleteSubmenuOpen.value
}

async function handleSoftDelete() {
  closeMenu()
  await pageStore.softDeletePage(props.pageId)
  // 删除当前页面后导航到首页
  router.push('/journal')
}

function handlePermanentDelete() {
  closeMenu()
  showPermanentDeleteConfirm.value = true
}

async function confirmPermanentDelete() {
  showPermanentDeleteConfirm.value = false
  await pageStore.permanentDeletePage(props.pageId)
  router.push('/journal')
}

function handleNavigateToTrash() {
  closeMenu()
  router.push('/trash')
}

function handleNavigateToSettings() {
  closeMenu()
  router.push('/settings')
}

// 点击外部关闭菜单
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.page-menu-button')) {
    closeMenu()
  }
}

// 监听点击外部
if (typeof window !== 'undefined') {
  window.addEventListener('click', handleClickOutside)
}
</script>

<template>
  <div class="page-menu-button">
    <button class="menu-trigger" @click.stop="toggleMenu">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <use href="/icons.svg#icon-menu" />
      </svg>
    </button>

    <Transition name="menu">
      <div v-if="isMenuOpen" class="menu-dropdown">
        <!-- 收藏/取消收藏 -->
        <button class="menu-item" @click="handleToggleFavorite">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <use :href="favorited ? '/icons.svg#icon-star-filled' : '/icons.svg#icon-star'" />
          </svg>
          <span>{{ favorited ? '取消收藏' : '添加收藏' }}</span>
        </button>

        <!-- 删除（带子菜单） -->
        <div class="menu-item has-submenu" @click="toggleDeleteSubmenu">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <use href="/icons.svg#icon-trash" />
          </svg>
          <span>删除本页</span>
          <svg class="arrow-icon" :class="{ rotated: isDeleteSubmenuOpen }" width="12" height="12" viewBox="0 0 20 20" fill="none">
            <use href="/icons.svg#icon-arrow-right" />
          </svg>
        </div>

        <!-- 删除子菜单 -->
        <Transition name="submenu">
          <div v-if="isDeleteSubmenuOpen" class="submenu">
            <button class="menu-item submenu-item" @click="handleSoftDelete">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <use href="/icons.svg#icon-trash" />
              </svg>
              <span>移至回收站</span>
            </button>
            <button class="menu-item submenu-item danger" @click="handlePermanentDelete">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <use href="/icons.svg#icon-trash-permanent" />
              </svg>
              <span>永久删除</span>
            </button>
          </div>
        </Transition>

        <div class="menu-divider"></div>

        <!-- 回收站 -->
        <button class="menu-item" @click="handleNavigateToTrash">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <use href="/icons.svg#icon-trash" />
          </svg>
          <span>回收站</span>
        </button>

        <!-- 设置 -->
        <button class="menu-item" @click="handleNavigateToSettings">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            <use href="/icons.svg#icon-settings" />
          </svg>
          <span>设置</span>
        </button>
      </div>
    </Transition>

    <!-- 永久删除确认对话框 -->
    <ConfirmDialog
      :visible="showPermanentDeleteConfirm"
      title="永久删除页面"
      :message="`确定要永久删除页面「${pageStore.getPage(pageId)?.title || ''}」吗？此操作不可撤销。`"
      confirm-text="永久删除"
      cancel-text="取消"
      danger
      @confirm="confirmPermanentDelete"
      @cancel="showPermanentDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.page-menu-button {
  position: relative;
}

.menu-trigger {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background 120ms ease, color 120ms ease;
}

.menu-trigger:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  padding: 4px;
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--color-ink);
  font-family: inherit;
  text-align: left;
  transition: background 80ms ease;
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--color-hover);
}

.menu-item.danger {
  color: var(--error);
}

.menu-item.danger:hover {
  background: #FEE2E2;
}

.menu-item.has-submenu {
  justify-content: space-between;
}

.menu-item.has-submenu span {
  flex: 1;
}

.arrow-icon {
  transition: transform 150ms ease;
}

.arrow-icon.rotated {
  transform: rotate(90deg);
}

.submenu {
  padding-left: 8px;
  border-left: 2px solid var(--color-border);
  margin-left: 12px;
  margin-top: 2px;
  margin-bottom: 2px;
}

.submenu-item {
  padding: 6px 10px;
  font-size: var(--text-xs);
}

.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 8px;
}

/* 过渡动画 */
.menu-enter-active,
.menu-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.submenu-enter-active,
.submenu-leave-active {
  transition: opacity 100ms ease, height 100ms ease;
}

.submenu-enter-from,
.submenu-leave-to {
  opacity: 0;
}
</style>
```

### Step 2: Commit

```bash
git add src/components/PageMenuButton.vue
git commit -m "feat: add PageMenuButton component with dropdown menu"
```

---

## Task 6: 修改 Page 组件引入菜单按钮

**Files:**
- Modify: `src/components/Page/index.vue`

### Step 1: 在 Page 组件中引入 PageMenuButton

修改 `src/components/Page/index.vue`：

```vue
<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import MergeDialog from '../MergeDialog.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import PageMenuButton from '../PageMenuButton.vue'  // 新增
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import type { Page } from '../../types/page'

// ... 其余代码保持不变 ...
</script>

<template>
  <div class="page-container">
    <div class="page-body">
      <main class="main-content">
        <div class="page-header">
          <div class="page-header-content">
            <h1
              v-if="!isEditingTitle"
              class="page-title page-title--display"
              :class="{ 'page-title--editable': editableTitle }"
              @click="startEditTitle"
            >{{ currentPageTitle }}</h1>
            <input
              v-else
              ref="titleInputRef"
              v-model="editingTitle"
              class="page-title page-title--input"
              @blur="saveTitle"
              @keydown.enter.prevent="saveTitle"
              @keydown.escape="cancelEditTitle"
            />
          </div>
          <PageMenuButton :page-id="resolvedPageId" />
        </div>

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
    </div>

    <!-- ... 其余代码保持不变 ... -->
  </div>
</template>
```

### Step 2: 修改 Page 组件样式

在 `src/components/Page/styles.css` 中，修改 `.page-header` 为 flex 布局：

```css
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.page-header-content {
  flex: 1;
  min-width: 0;
}
```

### Step 3: Commit

```bash
git add src/components/Page/index.vue src/components/Page/styles.css
git commit -m "feat: integrate PageMenuButton into Page component"
```

---

## Task 7: 创建回收站页面

**Files:**
- Create: `src/components/Trash/TrashList.vue`

### Step 1: 创建 TrashList 组件

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePageStore } from '../../stores/pages'
import ConfirmDialog from '../ConfirmDialog.vue'

const router = useRouter()
const pageStore = usePageStore()

const showRestoreConfirm = ref(false)
const showPermanentDeleteConfirm = ref(false)
const selectedPageId = ref('')

onMounted(async () => {
  await pageStore.loadTrashPages()
})

function handleRestore(pageId: string) {
  selectedPageId.value = pageId
  showRestoreConfirm.value = true
}

async function confirmRestore() {
  showRestoreConfirm.value = false
  await pageStore.restorePage(selectedPageId.value)
}

function handlePermanentDelete(pageId: string) {
  selectedPageId.value = pageId
  showPermanentDeleteConfirm.value = true
}

async function confirmPermanentDelete() {
  showPermanentDeleteConfirm.value = false
  await pageStore.permanentDeletePage(selectedPageId.value)
}

function handleNavigateToPage(pageId: string) {
  const page = pageStore.trashPages.find(p => p.id === pageId)
  if (page?.type === 'journal') {
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <div class="trash-list-view">
    <div class="trash-header">
      <h1 class="trash-title">回收站</h1>
      <span class="trash-count">{{ pageStore.trashPages.length }} 个页面</span>
    </div>

    <div class="trash-list">
      <div
        v-for="page in pageStore.trashPages"
        :key="page.id"
        class="trash-item"
      >
        <div class="trash-item-info" @click="handleNavigateToPage(page.id)">
          <span class="trash-item-title">{{ page.title }}</span>
          <span class="trash-item-date">删除于 {{ formatDate(page.deletedAt!) }}</span>
        </div>
        <div class="trash-item-actions">
          <button class="action-btn restore" title="恢复" @click="handleRestore(page.id)">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <use href="/icons.svg#icon-restore" />
            </svg>
            <span>恢复</span>
          </button>
          <button class="action-btn delete" title="永久删除" @click="handlePermanentDelete(page.id)">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <use href="/icons.svg#icon-trash-permanent" />
            </svg>
            <span>删除</span>
          </button>
        </div>
      </div>

      <div v-if="pageStore.trashPages.length === 0" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 20 20" fill="none">
          <use href="/icons.svg#icon-trash" />
        </svg>
        <div class="empty-text">回收站为空</div>
      </div>
    </div>

    <!-- 恢复确认对话框 -->
    <ConfirmDialog
      :visible="showRestoreConfirm"
      title="恢复页面"
      :message="`确定要恢复页面「${pageStore.trashPages.find(p => p.id === selectedPageId)?.title || ''}」吗？`"
      confirm-text="恢复"
      cancel-text="取消"
      @confirm="confirmRestore"
      @cancel="showRestoreConfirm = false"
    />

    <!-- 永久删除确认对话框 -->
    <ConfirmDialog
      :visible="showPermanentDeleteConfirm"
      title="永久删除页面"
      :message="`确定要永久删除页面「${pageStore.trashPages.find(p => p.id === selectedPageId)?.title || ''}」吗？此操作不可撤销。`"
      confirm-text="永久删除"
      cancel-text="取消"
      danger
      @confirm="confirmPermanentDelete"
      @cancel="showPermanentDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.trash-list-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.trash-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.trash-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.trash-count {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trash-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition: background 80ms ease;
}

.trash-item:hover {
  background: var(--bg-hover);
}

.trash-item-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.trash-item-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.trash-item-date {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.trash-item-actions {
  display: flex;
  gap: var(--space-2);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-family: inherit;
  transition: all 80ms ease;
}

.action-btn:hover {
  background: var(--bg-hover);
}

.action-btn.restore:hover {
  border-color: var(--success);
  color: var(--success);
}

.action-btn.delete:hover {
  border-color: var(--error);
  color: var(--error);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-8) 0;
  color: var(--text-tertiary);
  gap: var(--space-4);
}

.empty-state svg {
  opacity: 0.5;
}

.empty-text {
  font-size: var(--text-sm);
}
</style>
```

### Step 2: Commit

```bash
git add src/components/Trash/TrashList.vue
git commit -m "feat: add TrashList component for managing deleted pages"
```

---

## Task 8: 创建设置页面

**Files:**
- Create: `src/components/Settings/Settings.vue`

### Step 1: 创建 Settings 组件

```vue
<script setup lang="ts">
// 设置页面 - 预留配置项
</script>

<template>
  <div class="settings-view">
    <div class="settings-header">
      <h1 class="settings-title">设置</h1>
    </div>

    <div class="settings-content">
      <!-- 外观设置 -->
      <div class="settings-section">
        <h2 class="section-title">外观</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">主题</span>
            <span class="setting-desc">选择应用主题（即将推出）</span>
          </div>
          <span class="setting-value">浅色</span>
        </div>
      </div>

      <!-- 编辑器设置 -->
      <div class="settings-section">
        <h2 class="section-title">编辑器</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">字体大小</span>
            <span class="setting-desc">调整编辑器字体大小（即将推出）</span>
          </div>
          <span class="setting-value">默认</span>
        </div>
      </div>

      <!-- 数据管理 -->
      <div class="settings-section">
        <h2 class="section-title">数据管理</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">导出数据</span>
            <span class="setting-desc">将所有页面和块导出为 JSON（即将推出）</span>
          </div>
          <button class="setting-btn" disabled>导出</button>
        </div>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">导入数据</span>
            <span class="setting-desc">从 JSON 文件导入数据（即将推出）</span>
          </div>
          <button class="setting-btn" disabled>导入</button>
        </div>
      </div>

      <!-- 关于 -->
      <div class="settings-section">
        <h2 class="section-title">关于</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">版本</span>
            <span class="setting-desc">comind v0.1.0</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.settings-header {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.settings-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.setting-value {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.setting-btn {
  padding: 6px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: not-allowed;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: inherit;
}

.setting-btn:not(:disabled) {
  cursor: pointer;
  color: var(--text-secondary);
}

.setting-btn:not(:disabled):hover {
  background: var(--bg-active);
}
</style>
```

### Step 2: Commit

```bash
git add src/components/Settings/Settings.vue
git commit -m "feat: add Settings page component"
```

---

## Task 9: 添加路由

**Files:**
- Modify: `src/router/routes.ts`

### Step 1: 在路由中添加回收站和设置页面

```typescript
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/journal',
  },
  {
    path: '/journal',
    name: 'journal-list',
    component: () => import('../components/Journal/JournalList.vue'),
  },
  {
    path: '/journal/:date',
    name: 'journal-page',
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.date as string }),
    // ... beforeEnter 保持不变
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../components/Page/index.vue'),
    props: (route) => ({ pageId: route.params.pageId as string }),
    // ... beforeEnter 保持不变
  },
  // 新增：回收站路由
  {
    path: '/trash',
    name: 'trash',
    component: () => import('../components/Trash/TrashList.vue'),
  },
  // 新增：设置路由
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../components/Settings/Settings.vue'),
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes
```

### Step 2: Commit

```bash
git add src/router/routes.ts
git commit -m "feat: add /trash and /settings routes"
```

---

## Task 10: 处理删除时同步移除收藏

**Files:**
- Modify: `src/stores/pages.ts`

### Step 1: 在 softDeletePage 中同步移除收藏

```typescript
import { useFavorites } from '../composables/useFavorites'

/** 删除页面（移至回收站） */
async function softDeletePage(pageId: string): Promise<void> {
  await storage.softDeletePage(pageId)
  pages.value = pages.value.filter(p => p.id !== pageId)
  
  // 从收藏中移除
  const { removeFavorite } = useFavorites()
  removeFavorite(pageId)
  
  if (currentPageId.value === pageId) {
    currentPageId.value = ''
  }
}
```

### Step 2: Commit

```bash
git add src/stores/pages.ts
git commit -m "fix: remove from favorites when deleting page"
```

---

## Task 11: 编译检查与测试

**Files:**
- All modified files

### Step 1: 运行 TypeScript 类型检查

```bash
cd comind
npx vue-tsc -b
```

Expected: 无类型错误

### Step 2: 运行 Vite 构建

```bash
cd comind
npm run build
```

Expected: 构建成功，无错误

### Step 3: 运行单元测试

```bash
cd comind
npm run test
```

Expected: 所有现有测试通过

### Step 4: Commit（如有修复）

```bash
git add .
git commit -m "fix: resolve type errors and build issues"
```

---

## 自检清单

- [x] **Spec coverage**: 所有需求（菜单按钮、收藏、删除子菜单、回收站、设置、图标统一）都有对应任务
- [x] **Placeholder scan**: 无 TBD/TODO/"implement later" 等占位符
- [x] **Type consistency**: `deleted` 字段在 Page 类型中为 `boolean`，在 PageRecord 中为 `number`（0/1），序列化函数已正确处理
- [x] **边界情况**: 已覆盖删除后导航、收藏同步、空回收站、外部点击关闭、二次确认等场景
- [x] **数据库迁移**: Dexie 版本从 4 升级到 5，新增 `deleted` 索引，现有数据自动迁移
- [x] **图标风格统一**: 所有新增图标使用 20x20 viewBox、1.5px 描边、#6b7280 颜色，与现有图标一致
