<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'
import { usePageStore } from '../../../../stores/pages'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import { useNavigateToPage } from '../../../../composables/useNavigateToPage'
import { storage } from '../../../../storage/indexedDB'
import type { Block } from '../../../../types/block'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  properties: Record<string, any>
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'language-change', lang: string): void
}>()

const blockStore = useBlockStore()
const pageStore = usePageStore()
const blockRegistry = useBlockRegistry()
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
      const blocks = await storage.getBlockTree(pageId)
      remoteBlocks.value = blocks
      remoteBlock.value = blocks.find(b => b.id === id) ?? null
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

const sourceBlock = computed(() => remoteBlock.value)
const sourcePage = computed(() => sourceBlock.value ? pageStore.getPage(sourceBlock.value.pageId) : null)
const sourceHandler = computed(() => sourceBlock.value ? blockRegistry.getHandler(sourceBlock.value.type) : null)

const isSamePage = computed(() => {
  return sourceBlock.value && sourceBlock.value.pageId === pageStore.currentPageId
})

function detectCircular(targetId: string, depth: number = 0): boolean {
  if (depth > MAX_EMBED_DEPTH) return true
  const block = blockStore.blocks.find(b => b.id === targetId) ?? remoteBlocks.value.find(b => b.id === targetId)
  if (!block || block.type !== 'embed') return false
  const nextId = block.properties?.sourceBlockId
  if (!nextId) return false
  if (nextId === sourceBlockId.value) return true
  if (depth >= MAX_EMBED_DEPTH) return true
  return detectCircular(nextId, depth + 1)
}

const circularDetected = computed(() => {
  if (!sourceBlock.value || sourceBlock.value.type !== 'embed') return false
  return detectCircular(sourceBlockId.value)
})

const childrenBlocks = computed(() =>
  sourceBlock.value
    ? remoteBlocks.value
        .filter(b => b.parentId === sourceBlockId.value)
        .sort((a, b) => a.pos - b.pos)
    : []
)

function getChildHandler(type: string) {
  return blockRegistry.getHandler(type)
}

function handleContentClick(e: MouseEvent) {
  e.stopPropagation()
}

function handleLanguageChange(lang: string) {
  emit('language-change', lang)
}

function handleJump() {
  if (sourceBlock.value && sourcePage.value) {
    navigateToPage(sourcePage.value.title)
  }
}
</script>

<template>
  <div class="embed-block" @mousedown.stop @click="emit('content-click', $event)">
    <template v-if="!sourceBlockId">
      <div class="embed-placeholder">Select a block to embed...</div>
    </template>
    <template v-else-if="!sourceBlock">
      <div class="embed-error">Source block not found</div>
    </template>
    <template v-else>
      <div class="embed-card">
        <div class="embed-header">
          <span class="embed-page-name">
            {{ sourcePage ? sourcePage.title : 'Deleted page' }}
          </span>
          <button
            v-if="sourcePage && !isSamePage"
            class="embed-jump-btn"
            @click.stop="handleJump"
            title="Jump to source page"
          >
            ↗
          </button>
          <span v-else-if="isSamePage" class="embed-same-page-tag">same page</span>
        </div>
        <div class="embed-content">
          <div v-if="circularDetected" class="embed-circular-warning">Circular embed</div>
          <div v-else class="embed-source-block">
            <div class="embed-block-row">
              <span class="embed-block-bullet">
                <span class="bullet-dot"></span>
              </span>
              <div class="embed-block-content">
                <component
                  :is="sourceHandler?.renderComponent"
                  v-if="sourceHandler"
                  :key="sourceBlockId"
                  :content="sourceBlock.content"
                  :properties="sourceBlock.properties"
                  :show-placeholder="false"
                  :readonly="true"
                  @content-click="handleContentClick"
                  @language-change="handleLanguageChange"
                />
                <div v-else class="embed-child-placeholder">{{ sourceBlock.type }} (not registered)</div>
              </div>
            </div>
            <div
              v-for="child in childrenBlocks"
              :key="child.id"
              class="embed-block-row"
            >
              <span class="embed-block-bullet">
                <span class="bullet-dot"></span>
              </span>
              <div class="embed-block-content">
                <component
                  :is="getChildHandler(child.type)?.renderComponent"
                  v-if="child.type !== 'embed' && getChildHandler(child.type)"
                  :content="child.content"
                  :properties="child.properties"
                  :show-placeholder="false"
                  :readonly="true"
                  @content-click="handleContentClick"
                  @language-change="handleLanguageChange"
                />
                <div v-else-if="child.type === 'embed'" class="embed-circular-warning">Circular embed</div>
                <div v-else class="embed-child-placeholder">{{ child.type }} (not registered)</div>
              </div>
            </div>
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

.embed-placeholder,
.embed-error {
  color: var(--text-muted, #78716C);
  font-style: italic;
}

.embed-error {
  color: #DC2626;
}

.embed-card {
  border: 1px solid var(--border-color, #E7E5E4);
  border-radius: 6px;
  overflow: hidden;
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-secondary, #FAFAF9);
  border-bottom: 1px solid var(--border-color, #E7E5E4);
  font-size: 12px;
  color: var(--text-muted, #78716C);
}

.embed-page-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.embed-jump-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-muted, #78716C);
  padding: 0 4px;
  flex-shrink: 0;
}

.embed-jump-btn:hover {
  color: var(--text-primary, #1C1917);
}

.embed-same-page-tag {
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.5;
  flex-shrink: 0;
}

.embed-content {
  padding: 6px 10px;
}

.embed-circular-warning {
  color: #B45309;
  font-style: italic;
  padding: 4px 0;
}

.embed-block-row {
  display: flex;
  align-items: flex-start;
}

.embed-block-bullet {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 6px;
}

.embed-block-content {
  flex: 1;
  min-width: 0;
}

.embed-child-placeholder {
  color: var(--text-muted, #78716C);
  font-style: italic;
}
</style>