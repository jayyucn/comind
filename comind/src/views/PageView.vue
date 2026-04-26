<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import Block from '../components/Block/index.vue'
import Backlinks from '../components/Backlinks.vue'
import MergeDialog from '../components/MergeDialog.vue'
import TagFilterPanel from '../components/TagFilterPanel.vue'
import SlashCommandMenu from '../components/SlashCommandMenu.vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { useSortable } from '../composables/useSortable'
import type { Page } from '../types/page'

const route = useRoute()
const pageStore = usePageStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

// 从路由参数获取 pageId
const pageId = computed(() => {
  // 如果是 journal-page 路由，通过 date 查找 pageId
  if (route.name === 'journal-page') {
    const page = pageStore.getPageByTitle(route.params.date as string)
    return page?.id ?? ''
  }
  // 否则直接使用 pageId 参数
  return route.params.pageId as string
})

const topLevelBlocks = computed(() => {
  return blockStore.blocks
    .filter(b => b.parentId === null && b.pageId === pageId.value)
    .sort((a, b) => {
      if (!a.leftId) return -1
      if (!b.leftId) return 1
      return a.leftId.localeCompare(b.leftId)
    })
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(pageId.value)
  return page?.title ?? 'comind'
})

const blockListRef = ref<HTMLElement | null>(null)

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

onMounted(() => {
  if (blockListRef.value) {
    useSortable(blockListRef.value)
  }
})

// 路由切换时清理编辑状态（SPEC.md §7 单编辑器原则）
onBeforeUnmount(() => {
  editorStore.deactivateBlock()
})

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}

function startEditTitle() {
  editingTitle.value = currentPageTitle.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

async function saveTitle() {
  isEditingTitle.value = false
  const newTitle = editingTitle.value.trim()
  if (!newTitle || newTitle === currentPageTitle.value) return

  const result = await pageStore.renamePage(pageId.value, newTitle)
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
  const sourceId = pageId.value
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
            class="page-title page-title--display page-title--editable"
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

        <div class="block-list" ref="blockListRef" data-parent-id="">
          <Block
            v-for="block in topLevelBlocks"
            :key="block.id"
            :block-id="block.id"
            :block="block"
          />
        </div>
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
@import '../components/Page/styles.css';
</style>
