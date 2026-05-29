<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePageStore } from '../../stores/pages'
import { useFavorites } from '../../composables/useFavorites'
import { MoreVertical, Pencil, Trash2, ChevronRight } from 'lucide-vue-next'
import ConfirmDialog from '../ConfirmDialog.vue'

const props = defineProps<{
  page: any
}>()

const emit = defineEmits<{
  rename: []
}>()

const router = useRouter()
const pageStore = usePageStore()
const { removeFavorite } = useFavorites()

const isMenuOpen = ref(false)
const isDeleteSubmenuOpen = ref(false)
const showSoftDeleteConfirm = ref(false)
const showPermanentDeleteConfirm = ref(false)

function toggleMenu(event: Event) {
  event.stopPropagation()
  isMenuOpen.value = !isMenuOpen.value
  if (!isMenuOpen.value) {
    isDeleteSubmenuOpen.value = false
  }
}

function closeMenu() {
  isMenuOpen.value = false
  isDeleteSubmenuOpen.value = false
}

function startRename(event: Event) {
  event.stopPropagation()
  closeMenu()
  emit('rename')
}

function toggleDeleteSubmenu(event: Event) {
  event.stopPropagation()
  isDeleteSubmenuOpen.value = !isDeleteSubmenuOpen.value
}

function showSoftDeleteDialog(event: Event) {
  event.stopPropagation()
  closeMenu()
  showSoftDeleteConfirm.value = true
}

async function handleSoftDelete() {
  showSoftDeleteConfirm.value = false
  await pageStore.softDeletePage(props.page.id)
  removeFavorite(props.page.id)
  if (router.currentRoute.value.params.pageId === props.page.id) {
    router.push('/journal')
  }
}

function showPermanentDeleteDialog(event: Event) {
  event.stopPropagation()
  closeMenu()
  showPermanentDeleteConfirm.value = true
}

async function handlePermanentDelete() {
  showPermanentDeleteConfirm.value = false
  await pageStore.permanentDeletePage(props.page.id)
  removeFavorite(props.page.id)
  if (router.currentRoute.value.params.pageId === props.page.id) {
    router.push('/journal')
  }
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.page-item-menu')) {
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
  <div class="page-item-menu">
    <button class="menu-trigger" @click="toggleMenu">
      <MoreVertical :size="20" :stroke-width="1.75" />
    </button>

    <Transition name="menu">
      <div v-if="isMenuOpen" class="menu-dropdown" @click.stop>
        <button v-if="page.type !== 'journal'" class="menu-item" @click="startRename">
          <Pencil :size="16" />
          <span>重命名</span>
        </button>

        <div class="menu-item has-submenu" @click="toggleDeleteSubmenu">
          <Trash2 :size="16" />
          <span>删除</span>
          <ChevronRight class="arrow-icon" :class="{ rotated: isDeleteSubmenuOpen }" :size="16" />
        </div>

        <Transition name="submenu">
          <div v-if="isDeleteSubmenuOpen" class="submenu">
            <button class="menu-item submenu-item" @click="showSoftDeleteDialog">
              <Trash2 :size="16" />
              <span>移至回收站</span>
            </button>
            <button class="menu-item submenu-item danger" @click="showPermanentDeleteDialog">
              <Trash2 :size="16" />
              <span>永久删除</span>
            </button>
          </div>
        </Transition>
      </div>
    </Transition>

    <ConfirmDialog
      :visible="showSoftDeleteConfirm"
      title="移至回收站"
      :message="`确定要将页面「${page.title || ''}」移至回收站吗？`"
      confirm-text="移至回收站"
      cancel-text="取消"
      @confirm="handleSoftDelete"
      @cancel="showSoftDeleteConfirm = false"
    />

    <ConfirmDialog
      :visible="showPermanentDeleteConfirm"
      title="永久删除"
      :message="`确定要永久删除页面「${page.title || ''}」吗？此操作不可撤销。`"
      confirm-text="永久删除"
      cancel-text="取消"
      danger
      @confirm="handlePermanentDelete"
      @cancel="showPermanentDeleteConfirm = false"
    />
  </div>
</template>

<style lang="scss" scoped>
.page-item-menu {
  position: relative;
  flex-shrink: 0;
}

.menu-trigger {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: transparent;
  transition: all 80ms ease;
  flex-shrink: 0;
  opacity: 0.1;
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 160px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
  padding: 4px;
  z-index: 1000;

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

    &:hover {
      background: var(--color-hover);
    }

    &.danger {
      color: var(--error);

      &:hover {
        background: #FEE2E2;
      }
    }

    &.has-submenu {
      justify-content: space-between;

      span {
        flex: 1;
      }
    }

    &.submenu-item {
      padding: 6px 10px;
      font-size: var(--text-xs);
    }
  }

  .arrow-icon {
    transition: transform 150ms ease;

    &.rotated {
      transform: rotate(90deg);
    }
  }

  .submenu {
    padding-left: 8px;
    border-left: 2px solid var(--color-border);
    margin-left: 12px;
    margin-top: 2px;
    margin-bottom: 2px;
  }
}

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
