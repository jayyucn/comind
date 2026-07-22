<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'
import { usePageStore } from '../../../../stores/pages'
import { usePropertyStore } from '../../../../stores/property'
import { useNavigateToPage } from '../../../../composables/useNavigateToPage'
import SubtreeRenderer from './SubtreeRenderer'
import BlockSelector from '../../../BlockSelector.vue'
import type { SubtreeNode } from '../../../../types/block'
import type { Block } from '../../../../types/block'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  properties: Record<string, any>
  blockId: string
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'language-change', lang: string): void
}>()

const blockStore = useBlockStore()
const pageStore = usePageStore()
const propertyStore = usePropertyStore()
const { navigateToPage } = useNavigateToPage()

const MAX_EMBED_DEPTH = 3

const sourceBlockId = computed(() => props.properties?.sourceBlockId as string || '')
const sourcePageId = computed(() => props.properties?.sourcePageId as string || '')
const remoteBlock = ref<Block | null>(null)
const remoteBlocks = ref<Block[]>([])

async function loadSourceBlock() {
  const id = sourceBlockId.value
  if (!id) {
    remoteBlock.value = null
    remoteBlocks.value = []
    return
  }
  const local = blockStore.blocks.find(b => b.id === id)
  if (local) {
    remoteBlock.value = local
    remoteBlocks.value = blockStore.blocks.filter(b => b.pageId === local.pageId)
    return
  }
  try {
    const pageId = sourcePageId.value
    if (pageId) {
      await blockStore.loadPageBlocks(pageId)
      remoteBlocks.value = blockStore.blocks.filter(b => b.pageId === pageId)
      remoteBlock.value = remoteBlocks.value.find(b => b.id === id) ?? null
    } else {
      remoteBlock.value = null
      remoteBlocks.value = []
    }
  } catch {
    remoteBlock.value = null
    remoteBlocks.value = []
  }
}

watch(sourceBlockId, loadSourceBlock, { immediate: true })

// ── BlockSelector 状态（点击 placeholder 打开）──
const showBlockSelector = ref(false)

async function handleEmbedSelect(sourceBlockId: string, sourcePageId: string) {
  await blockStore.updateBlockProperties(props.blockId, { sourceBlockId, sourcePageId })
  showBlockSelector.value = false
}

const sourceBlock = computed(() => remoteBlock.value)
const sourcePage = computed(() => sourceBlock.value ? pageStore.getPage(sourceBlock.value.pageId) : null)

const isSamePage = computed(() => {
  return sourceBlock.value && sourceBlock.value.pageId === pageStore.currentPageId
})

function detectCircular(targetId: string, depth: number = 0): boolean {
  if (depth > MAX_EMBED_DEPTH) return true
  const block = blockStore.blocks.find(b => b.id === targetId) ?? remoteBlocks.value.find(b => b.id === targetId)
  if (!block || block.type !== 'embed') return false
  const nextId = getBlockPropertyValue(targetId, 'sourceBlockId')
  if (!nextId) return false
  if (nextId === sourceBlockId.value) return true
  if (depth >= MAX_EMBED_DEPTH) return true
  return detectCircular(nextId, depth + 1)
}

function getBlockPropertyValue(blockId: string, key: string): string | undefined {
  const prop = blockStore.blocks.find(b => b.id === blockId) 
    ? propertyStore.getBlockProperty(blockId, key)
    : undefined
  return prop?.value as string | undefined
}

const circularDetected = computed(() => {
  if (!sourceBlock.value || sourceBlock.value.type !== 'embed') return false
  return detectCircular(sourceBlockId.value)
})

const sourceSubtree = computed((): SubtreeNode | null => {
  if (!sourceBlock.value) return null
  return buildSubtree(sourceBlockId.value, 0)
})

function buildSubtree(blockId: string, depth: number): SubtreeNode | null {
  if (depth > MAX_EMBED_DEPTH) return null
  const block = remoteBlocks.value.find(b => b.id === blockId)
  if (!block) return null

  const children = remoteBlocks.value
    .filter(b => b.parentId === blockId)
    .sort((a, b) => a.pos - b.pos)
    .map(child => buildSubtree(child.id, depth + 1))
    .filter((n): n is SubtreeNode => n !== null)

  return { block, children }
}

function handleCardClick() {
  if (sourceBlock.value && sourcePage.value) {
    navigateToPage(sourcePage.value.title)
  }
}

function handleContentClick(e: MouseEvent) {
  e.stopPropagation()
}

function handleLanguageChange(lang: string) {
  emit('language-change', lang)
}
</script>

<template>
  <div class="embed-block" @mousedown.stop @click="emit('content-click', $event)">
    <template v-if="!sourceBlockId">
      <div class="embed-placeholder" @click="showBlockSelector = true">
        Select a block to embed...
      </div>
      <BlockSelector
        :visible="showBlockSelector"
        :exclude-block-id="blockId"
        @select="handleEmbedSelect"
        @close="showBlockSelector = false"
      />
    </template>
    <template v-else-if="!sourceBlock">
      <div class="embed-error">Source block not found</div>
    </template>
    <template v-else>
      <div class="embed-card" @click.stop="handleCardClick">
        <div class="embed-header">
          <span class="embed-page-name">
            {{ sourcePage ? sourcePage.title : 'Deleted page' }}
          </span>
          <span v-if="isSamePage" class="embed-same-page-tag">same page</span>
          <span class="embed-hint">click to jump</span>
        </div>
        <div class="embed-content">
          <div v-if="circularDetected" class="embed-circular-warning">Circular embed</div>
          <div v-else-if="sourceSubtree" class="embed-source-block">
            <SubtreeRenderer
              :node="sourceSubtree"
              :depth="0"
              @content-click="handleContentClick"
              @language-change="handleLanguageChange"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.embed-block {
  min-height: 1.5em;
}

.embed-placeholder {
  color: var(--text-tertiary);
  font-style: italic;
}

.embed-error {
  color: var(--error);
  font-style: italic;
}

.embed-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.embed-card:hover {
  border-color: var(--accent);
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
}

.embed-page-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.embed-same-page-tag {
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.5;
  flex-shrink: 0;
}

.embed-hint {
  font-size: 10px;
  opacity: 0;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.embed-card:hover .embed-hint {
  opacity: 0.5;
}

.embed-content {
  padding: 6px 10px;
}

.embed-circular-warning {
  color: var(--warning);
  font-style: italic;
  padding: 4px 0;
}

.embed-source-block {
  display: flex;
  flex-direction: column;
}
</style>
