<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next'
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useFavorites } from '../composables/useFavorites'
import { useSettingsModal } from '../composables/useSettingsModal'
import { useTheme } from '../composables/useTheme'
import { usePageStore } from '../stores/pages'
import ConfirmDialog from './ConfirmDialog.vue'
import { Icon } from './Icons'

const router = useRouter()
const route = useRoute()
const pageStore = usePageStore()
const { isFavorite, toggleFavorite } = useFavorites()
const { open: openSettings } = useSettingsModal()
const { theme, setTheme } = useTheme()

const isMenuOpen = ref(false)
const isDeleteSubmenuOpen = ref(false)
const showPermanentDeleteConfirm = ref(false)

const themeIconMap = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const themeLabelMap: Record<string, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
}

// 判断当前是否在页面路由中（有可操作的页面）
const isOnPage = computed(() => {
  return route.name === 'page' || route.name === 'ideas-page'
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

const shouldDelete = computed(() => {
  if (!currentPage.value) return false
  if(currentPage.value.type == 'ideas') return false
  return currentPage.value.deleted ?? false
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

function handleSelectTheme(t: 'light' | 'dark' | 'system') {
  setTheme(t)
  isMenuOpen.value = false
}

async function handleSoftDelete() {
  if (!currentPage.value) return
  closeMenu()
  await pageStore.softDeletePage(currentPage.value.id)
  if (router.options.history.state) {
    router.replace('/ideas')
  } else {
    router.push('/ideas')
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
  if (router.options.history.state) {
    router.replace('/ideas')
  } else {
    router.push('/ideas')
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
      <Icon name="icon-menu" />
    </button>

    <Transition name="menu">
      <div v-if="isMenuOpen" class="menu-dropdown">
        <!-- 页面相关功能仅在页面路由中显示 -->
        <template v-if="isOnPage && currentPage">
          <button class="menu-item" @click="handleToggleFavorite">
            <Icon :name="favorited ? 'icon-star-filled' : 'icon-star'" :size="16" />
            <span>{{ favorited ? '取消收藏' : '添加收藏' }}</span>
          </button>

          <div v-if="shouldDelete" class="menu-item has-submenu" @click="toggleDeleteSubmenu">
            <Icon name="icon-trash2" :size="16" />
            <span>删除本页</span>
            <Icon class="arrow-icon" :class="{ rotated: isDeleteSubmenuOpen }" name="icon-arrow-right" :size="16" />
          </div>

          <Transition name="submenu">
            <div v-if="isDeleteSubmenuOpen" class="submenu">
              <button class="menu-item submenu-item" @click="handleSoftDelete">
                <Icon name="icon-trash2" :size="16" />
                <span>移至回收站</span>
              </button>
              <button class="menu-item submenu-item danger" @click="handlePermanentDelete">
                <Icon name="icon-trash-permanent" :size="16" />
                <span>永久删除</span>
              </button>
            </div>
          </Transition>

          <div class="menu-divider"></div>
        </template>

        <!-- 全局功能始终显示 -->
        <div class="theme-selector">
          <span class="theme-label">主题</span>
          <button
            v-for="t in (['light', 'dark', 'system'] as const)"
            :key="t"
            class="theme-option"
            :class="{ active: theme === t }"
            :title="themeLabelMap[t]"
            @click.stop="handleSelectTheme(t)"
          >
            <component :is="themeIconMap[t]" :size="15" :stroke-width="1.75" />
          </button>
        </div>

        <button class="menu-item" @click="handleNavigateToTrash">
          <Icon name="icon-trash" :size="16" />
          <span>回收站</span>
        </button>

        <button class="menu-item" @click="handleNavigateToSettings">
          <Icon name="icon-settings" :size="16" />
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

<style lang="scss" scoped>
.page-menu-button {
  position: relative;
}

.menu-trigger {
  width: 32px;
  height: 32px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  transition: background 120ms ease, color 120ms ease;
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
  // 局部语义：菜单困于 .sticky-header(z:10) 堆叠上下文内，此值只在本组件内部竞争，不参与全局量表（见 ADR-0012）
  z-index: var(--z-dropdown);
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
  justify-content: flex-start;
}

.menu-item.has-submenu span {
  flex: 1;
}

.theme-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  padding: 3px;
  margin: 4px 6px;
}

.theme-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding-left: 4px;
  padding-right: 4px;
  flex-shrink: 0;
  user-select: none;
}

.theme-option {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
  flex-shrink: 0;
}

.theme-option:hover {
  color: var(--text-secondary);
  background: var(--color-hover);
}

.theme-option.active {
  background: var(--bg-base);
  color: var(--accent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.arrow-icon {
  transition: transform 150ms ease;
  flex-shrink: 0;
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
