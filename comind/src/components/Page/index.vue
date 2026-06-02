<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import ConceptGraph from '../ConceptGraph.vue'
import MergeDialog from '../MergeDialog.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import type { Page } from '../../types/page'

const props = defineProps<{
  pageId: string
}>()

const router = useRouter()
const pageStore = usePageStore()
const editorStore = useEditorStore()

/** 解析实际的 pageId：props 可能是 UUID 或 date title（journal-page 路由） */
const resolvedPageId = computed(() => {
  const direct = pageStore.getPage(props.pageId)
  if (direct) return direct.id
  const byTitle = pageStore.getPageByTitle(props.pageId)
  if (byTitle) return byTitle.id
  return props.pageId
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.title ?? 'comind'
})

const isTitleEditable = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.type !== 'journal'
})

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

onBeforeUnmount(() => {
  editorStore.deactivateBlock()
})

async function startEditTitle() {
  if (!isTitleEditable.value) return
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
  router.push(`/page/${targetId}`)
}

function handleCancelMerge() {
  showMergeDialog.value = false
  mergeTarget.value = null
  editingTitle.value = ''
}
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
              :class="{ 'page-title--editable': isTitleEditable }"
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
        </div>

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
      <ConceptGraph />
    </div>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />

    <SlashCommandMenu />
    <PropertyQuickEditor />
    <PropertyEditor />
  </div>
</template>

<style scoped lang="scss">
</style>
