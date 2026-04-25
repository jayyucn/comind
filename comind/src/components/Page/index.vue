<script setup lang="ts">
import { computed, ref, onMounted, nextTick } from 'vue'
import Block from '../Block/index.vue'
import Backlinks from '../Backlinks.vue'
import MergeDialog from '../MergeDialog.vue'
import TagFilterPanel from '../TagFilterPanel.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { useEditorStore } from '../../stores/editor'
import { useSortable } from '../../composables/useSortable'
import type { Page } from '../../types/page'

const props = withDefaults(defineProps<{
  pageId: string
  editableTitle?: boolean
}>(), {
  editableTitle: false
})

const pageStore = usePageStore()
const blockStore = useBlockStore()
const editorStore = useEditorStore()

const topLevelBlocks = computed(() => {
  return blockStore.blocks
    .filter(b => b.parentId === null && b.pageId === props.pageId)
    .sort((a, b) => {
      if (!a.leftId) return -1
      if (!b.leftId) return 1
      return a.leftId.localeCompare(b.leftId)
    })
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(props.pageId)
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

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}

function startEditTitle() {
  if (!props.editableTitle) return
  editorStore.deactivateBlock()
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

  const result = await pageStore.renamePage(props.pageId, newTitle)
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
  const sourceId = props.pageId
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
@import './styles.css';
</style>
