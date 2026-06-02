<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useFavorites } from '../composables/useFavorites'
import { usePageStore } from '../stores/pages'
import { useSettingsModal } from '../composables/useSettingsModal'
import ConfirmDialog from './ConfirmDialog.vue'
import { TaskIcon } from './Icons'

const router = useRouter()
const route = useRoute()
const pageStore = usePageStore()
const { isFavorite, toggleFavorite } = useFavorites()
const { open: openSettings } = useSettingsModal()

const isMenuOpen = ref(false)
const isDeleteSubmenuOpen = ref(false)
const showPermanentDeleteConfirm = ref(false)

// 判断当前是否在页面路由中（有可操作的页面）
const isOnPage = computed(() => {
  return route.name === 'page' || route.name === 'journal-page'
})

// 获取当前页面ID
const currentPageId = computed(() => {
  if (!isOnPage.value) return ''
  const pageId = route.params.pageId
  const date = route.params.date
  return (Array.isArray(pageId) ? pageId[0] : pageId) || (Array.isArray(date) ? date[0] : date) || ''
})

const currentPage = computed(() => {
  if (!currentPageId.value) return null
  return pageStore.getPage(currentPageId.value) ?? pageStore.getPageByTitle(currentPageId.value)
})

const favorited = computed(() => currentPage.value ? isFavorite(currentPage.value.id) : false)

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
  if (currentPage.value) {
    toggleFavorite(currentPage.value.id)
  }
  closeMenu()
}

function toggleDeleteSubmenu() {
  isDeleteSubmenuOpen.value = !isDeleteSubmenuOpen.value
}

async function handleSoftDelete() {
  if (!currentPage.value) return
  closeMenu()
  await pageStore.softDeletePage(currentPage.value.id)
  // 从路由历史中移除当前页面记录，然后导航到首页
  if (router.options.history.state) {
    router.replace('/journal')
  } else {
    router.push('/journal')
  }
}

function handlePermanentDelete() {
  if (!currentPage.value) return
  closeMenu()
  showPermanentDeleteConfirm.value = true
}

async function confirmPermanentDelete() {
  if (!currentPage.value) return
  showPermanentDeleteConfirm.value = false
  await pageStore.permanentDeletePage(currentPage.value.id)
  // 从路由历史中移除当前页面记录，然后导航到首页
  if (router.options.history.state) {
    router.replace('/journal')
  } else {
    router.push('/journal')
  }
}

function handleNavigateToTrash() {
  closeMenu()
  router.push('/trash')
}

function handleNavigateToSettings() {
  closeMenu()
  openSettings()
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.page-menu-button')) {
    closeMenu()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('click', handleClickOutside)
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('click', handleClickOutside)
  }
})
</script>

<template>
  <div class="page-menu-button">
    <button class="menu-trigger" @click.stop="toggleMenu">
      <TaskIcon name="icon-menu" :size="16" />
    </button>

    <Transition name="menu">
      <div v-if="isMenuOpen" class="menu-dropdown">
        <!-- 页面相关功能仅在页面路由中显示 -->
        <template v-if="isOnPage && currentPage">
          <button class="menu-item" @click="handleToggleFavorite">
            <TaskIcon :name="favorited ? 'icon-star-filled' : 'icon-star'" :size="16" />
            <span>{{ favorited ? '取消收藏' : '添加收藏' }}</span>
          </button>

          <div class="menu-item has-submenu" @click="toggleDeleteSubmenu">
            <TaskIcon name="icon-trash2" :size="16" />
            <span>删除本页</span>
            <TaskIcon class="arrow-icon" :class="{ rotated: isDeleteSubmenuOpen }" name="icon-arrow-right" :size="16" />
          </div>

          <Transition name="submenu">
            <div v-if="isDeleteSubmenuOpen" class="submenu">
              <button class="menu-item submenu-item" @click="handleSoftDelete">
                <TaskIcon name="icon-trash2" :size="16" />
                <span>移至回收站</span>
              </button>
              <button class="menu-item submenu-item danger" @click="handlePermanentDelete">
                <TaskIcon name="icon-trash-permanent" :size="16" />
                <span>永久删除</span>
              </button>
            </div>
          </Transition>

          <div class="menu-divider"></div>
        </template>

        <!-- 全局功能始终显示 -->
        <button class="menu-item" @click="handleNavigateToTrash">
          <TaskIcon name="icon-trash" :size="16" />
          <span>回收站</span>
        </button>

        <button class="menu-item" @click="handleNavigateToSettings">
          <TaskIcon name="icon-settings" :size="16" />
          <span>设置</span>
        </button>
      </div>
    </Transition>

    <ConfirmDialog
      v-if="currentPage"
      :visible="showPermanentDeleteConfirm"
      title="永久删除页面"
      :message="`确定要永久删除页面「${currentPage.title || ''}」吗？此操作不可撤销。`"
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
  /* border: 1px solid var(--color-border-light); */
}

.menu-trigger:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border-light);
}

.menu-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 180px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  padding: 4px;
  z-index: 1001;
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
