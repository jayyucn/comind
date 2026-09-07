<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePageStore } from '../../stores/pages'
import { useFavorites } from '../../composables/useFavorites'
import { MoreVertical, Pencil, Star, Trash2 } from 'lucide-vue-next'
import ConfirmDialog from '../ConfirmDialog.vue'

const props = defineProps<{
  page: any
}>()

const emit = defineEmits<{
  rename: []
}>()

const router = useRouter()
const pageStore = usePageStore()
const { isFavorite, toggleFavorite } = useFavorites()

const isMenuOpen = ref(false)
const showDeleteConfirm = ref(false)

function toggleMenu(event: Event) {
  event.stopPropagation()
  isMenuOpen.value = !isMenuOpen.value
}

function closeMenu() {
  isMenuOpen.value = false
}

function handleToggleFavorite(event: Event) {
  event.stopPropagation()
  toggleFavorite(props.page.id)
  closeMenu()
}

function showSoftDeleteDialog(event: Event) {
  event.stopPropagation()
  closeMenu()
  showDeleteConfirm.value = true
}

function handleRename(event: Event) {
  event.stopPropagation()
  closeMenu()
  emit('rename')
}

async function handleDelete() {
  showDeleteConfirm.value = false
  await pageStore.softDeletePage(props.page.id)
  if (router.currentRoute.value.params.pageId === props.page.id) {
    router.push('/ideas')
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
      <MoreVertical :size="16" :stroke-width="1.75" />
    </button>

    <Transition name="menu">
      <div v-if="isMenuOpen" class="menu-dropdown" @click.stop>
        <button class="menu-item" @click="handleToggleFavorite">
          <Star :size="14" :stroke-width="1.75" />
          <span>{{ isFavorite(page.id) ? '取消收藏' : '收藏' }}</span>
        </button>

        <button v-if="page.type !== 'ideas'" class="menu-item" @click="handleRename">
          <Pencil :size="14" :stroke-width="1.75" />
          <span>重命名</span>
        </button>

        <button class="menu-item danger" @click="showSoftDeleteDialog">
          <Trash2 :size="14" :stroke-width="1.75" />
          <span>删除</span>
        </button>
      </div>
    </Transition>

    <ConfirmDialog
      :visible="showDeleteConfirm"
      title="删除页面"
      :message="`确定要将页面「${page.title || ''}」移至回收站吗？`"
      confirm-text="删除"
      cancel-text="取消"
      @confirm="handleDelete"
      @cancel="showDeleteConfirm = false"
    />
  </div>
</template>

<style scoped>
.page-item-menu {
  position: relative;
  flex-shrink: 0;
}

.menu-trigger {
  width: 0;
  height: 20px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--text-tertiary);
  opacity: 0;
  overflow: hidden;
  transition: all 80ms ease;
  flex-shrink: 0;
}

.page-item:hover .menu-trigger,
.page-item.active .menu-trigger {
  width: 20px;
  opacity: 1;
}

.menu-trigger:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  min-width: 140px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 4px;
  z-index: var(--z-dropdown);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  transition: background 80ms ease;
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--bg-hover);
}

.menu-item.danger {
  color: var(--error, #DC2626);
}

.menu-item.danger:hover {
  background: rgba(220, 38, 38, 0.08);
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
</style>
