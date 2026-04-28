<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import MergeDialog from '../MergeDialog.vue'
import TagFilterPanel from '../TagFilterPanel.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import type { Page } from '../../types/page'

const props = withDefaults(defineProps<{
  pageId: string
  editableTitle?: boolean
}>(), {
  editableTitle: false
})

const pageStore = usePageStore()
const editorStore = useEditorStore()

/** 解析实际的 pageId：props 可能是 UUID 或 date title（journal-page 路由） */
const resolvedPageId = computed(() => {
  // 先尝试直接当作 UUID 查找
  const direct = pageStore.getPage(props.pageId)
  if (direct) return direct.id
  // 再尝试当作 title 查找（journal-page 路由传入的是 date 字符串）
  const byTitle = pageStore.getPageByTitle(props.pageId)
  if (byTitle) return byTitle.id
  // 都找不到，返回原始值（渲染时显示 comind 默认标题）
  return props.pageId
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.title ?? 'comind'
})

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

// 路由切换时清理编辑状态（SPEC.md §7 单编辑器原则）
onBeforeUnmount(() => {
  editorStore.deactivateBlock()
})

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}

async function startEditTitle() {
  if (!props.editableTitle) return
  editorStore.deactivateBlock()
  editingTitle.value = await currentPageTitle.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

async function saveTitle() {
  isEditingTitle.value = false
  const newTitle = editingTitle.value.trim()
  if (!newTitle || newTitle === await currentPageTitle.value) return

  const result = await pageStore.renamePage(await resolvedPageId.value, newTitle)
  if (result.duplicated) {
    editingTitle.value = newTitle
    showMergeDialog.value = true
    mergeTarget.value = result.duplicated
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false
  editingTitle.value = ''
}

async function handleMerge() {
  if (!mergeTarget.value) return
  const sourceId = await resolvedPageId.value
  const targetId = mergeTarget.value.id
  showMergeDialog.value = false
  mergeTarget.value = null
  await pageStore.mergePage(sourceId, targetId)
  await pageStore.openPage(targetId)
}

function handleCancelMerge() {
  showMergeDialog.value = false
  mergeTarget.value = null
  editingTitle.value = ''
}
</script>

<template>
  <div class="page-scroll-wrapper" @click="handleMainClick">
    <div class="page-body">
      <main class="main-content">
        <div class="page-header">
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

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
    </div>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />

    <TagFilterPanel />
    <SlashCommandMenu />
  </div>
</template>

<style scoped>
@import './styles.css';
</style>
