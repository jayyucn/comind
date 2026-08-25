<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'
import { usePageStore } from '../../../../stores/pages'
import { usePropertyStore } from '../../../../stores/property'
import { useEditorStore } from '../../../../stores/editor'
import { useNavigateToPage } from '../../../../composables/useNavigateToPage'
import SubtreeRenderer from './SubtreeRenderer'
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
const editorStore = useEditorStore()
const { navigateToPage } = useNavigateToPage()

const MAX_EMBED_DEPTH = 3

// 直接从 propertyStore 响应式读取，确保 setProperty 后能立即更新（不依赖 props.properties 传递链）
const sourceBlockId = computed(() => {
  const p = propertyStore.getBlockProperty(props.blockId, 'sourceBlockId')
  return (p?.value as string) || ''
})
const sourcePageId = computed(() => {
  const p = propertyStore.getBlockProperty(props.blockId, 'sourcePageId')
  return (p?.value as string) || ''
})
const remoteBlock = ref<Block | null>(null)
const remoteBlocks = ref<Block[]>([])

// Bug 1: 点击嵌入卡片任意位置切换 .selected 态，与 hover 共享视觉。
const isClicked = ref(false)
/** 根元素引用：document 级监听据此判断点击是否落在本 embed 内 */
const rootRef = ref<HTMLElement | null>(null)

/**
 * 点击本 embed 外部任意位置 → 取消选中态。
 * capture 阶段监听：不受内部 @click.stop 影响（点自己内部时 contains 命中不取消）；
 * 点其它 embed / 普通 block / 留白 / sidebar 均取消，多个 embed 天然互斥。
 */
function handleDocClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null
  if (!target || !rootRef.value) return
  if (!rootRef.value.contains(target)) {
    isClicked.value = false
  }
}

/** 事件目标是否在可编辑输入区（input/textarea/contenteditable）——Backspace 交给控件自身 */
function isInEditableInput(e: { target: EventTarget | null }): boolean {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false
  if (target.closest('input, textarea')) return true
  const editable = target.closest('[contenteditable="true"]') as HTMLElement | null
  return !!editable && !editable.closest('.ProseMirror')
}

/**
 * embed 选中态下按 Backspace → 清空当前 block，恢复成空的 bullet block：
 * 删掉 embed 专属属性（sourceBlockId/sourcePageId）+ type 改 bullet + content 置空。
 */
function handleDocKeyDown(e: KeyboardEvent) {
  if (!isClicked.value || e.key !== 'Backspace') return
  if (isInEditableInput(e)) return
  // 已被 BlockList 消费（如 Ctrl+A 全选后删除）时不重复处理
  if (e.defaultPrevented) return
  e.preventDefault()
  e.stopPropagation()
  isClicked.value = false
  void clearToBullet()
}

async function clearToBullet() {
  const block = blockStore.blocks.find(b => b.id === props.blockId)
  if (!block) return
  // 1. 删除 embed 专属属性（deleteProperty 内部已刷新缓存）
  const propsList = propertyStore.getBlockProperties(props.blockId)
  for (const p of propsList) {
    if (p.key === 'sourceBlockId' || p.key === 'sourcePageId') {
      await propertyStore.deleteProperty(p.id, props.blockId)
    }
  }
  // 2. 恢复成空 bullet：改类型会触发 Block 重建（EmbedRender 卸载并移除监听）
  await blockStore.updateBlockType(props.blockId, 'bullet')
  await blockStore.updateBlockContent(props.blockId, '')
}

onMounted(() => {
  document.addEventListener('click', handleDocClick, true)
  document.addEventListener('keydown', handleDocKeyDown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocClick, true)
  document.removeEventListener('keydown', handleDocKeyDown)
})

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
      // 使用追加式的 loadMultiPageBlocks，避免覆盖当前页面的 blocks
      await blockStore.loadMultiPageBlocks([pageId])
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

function handleCardClick(e: MouseEvent) {
  // Bug 1 fix: 点击切换整体"选中"态。视觉与 hover 区分（见 CSS：selected 加底色 + hint 加粗常驻）。
  // 子树预览区点击也走 toggle —— Vue emit 链不再 stopPropagation，DOM 冒泡可达此处。
  isClicked.value = !isClicked.value

  // Bug 2 fix: click to jump 真正跳转。
  // - 跨页：路由跳转。
  // - 同页：router.push 同 URL 是 no-op，改派 navigate-to-block 滚动到源块。
  const target = e.target as HTMLElement
  if (target.closest('.embed-content')) {
    // 子树预览只读，点它只切选中不跳——避免误跳走
    return
  }
  jumpToSource()
}

function jumpToSource() {
  const block = sourceBlock.value
  const page = sourcePage.value
  if (!block || !page) return

  if (isSamePage.value) {
    // 同页：派 navigate-to-block 滚动到源块（Page/index.vue 监听并 scrollIntoView）
    window.dispatchEvent(new CustomEvent('navigate-to-block', {
      detail: { blockId: block.id }
    }))
    return
  }

  // 跨页：路由跳转，新页面挂载后滚动到目标块
  const targetBlockId = block.id
  const targetTitle = page.title
  navigateToPage(targetTitle).then(() => {
    window.dispatchEvent(new CustomEvent('navigate-to-block', {
      detail: { blockId: targetBlockId }
    }))
  })
}

function handleContentClick() {
  // 不 stopPropagation：让 click 继续 DOM 冒泡到外层 .embed-card 触发 toggle 选中。
  // 子树内的可点击元素（wiki-link/rel-type-label/date-ref）由所属 RenderComponent
  // 自带的 content-click emit + Block.onContentClick 默认分支处理，并不会
  // 误触发 .embed-card 的跳转：.embed-card 的 @click.stop 在 handleCardClick 之前先停泡，
  // 而 Block.onContentClick 走的是 Vue @content-click 链、仅当 .embed-block 自身被点时
  // 由 EmbedRender 的外层 @click 转发；子树点击路径不会经此处。
}

function handleLanguageChange(lang: string) {
  emit('language-change', lang)
}
</script>

<template>
  <div ref="rootRef" class="embed-block" @mousedown.stop @click="emit('content-click', $event)">
    <template v-if="!sourceBlockId">
      <div class="embed-placeholder" @click="editorStore.openBlockSelector(blockId)">
        Select a block to embed...
      </div>
    </template>
    <template v-else-if="!sourceBlock">
      <div class="embed-error">Source block not found</div>
    </template>
    <template v-else>
      <div class="embed-card" :class="{ selected: isClicked }" @click.stop="handleCardClick">
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
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

/* hover 仅作"预览"提示（轻微边框色）；selected 是持续选中态，叠加底色区分 */
.embed-card:hover:not(.selected) {
  border-color: var(--accent);
}

.embed-card.selected {
  border-color: var(--accent);
  background: var(--bg-base2);
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-sidebar);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.embed-page-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.embed-same-page-tag {
  font-size: var(--text-xs);
  text-transform: uppercase;
  opacity: 0.5;
  flex-shrink: 0;
}

.embed-hint {
  font-size: var(--text-xs);
  /* 常驻可见，让"click to jump"的语义始终传达出来 */
  opacity: 0.5;
  color: var(--text-secondary);
  transition: opacity 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.embed-card:hover:not(.selected) .embed-hint {
  opacity: 0.8;
}

/* 选中态：hint 突出显示，明确告诉用户"这就是触发跳转的区域" */
.embed-card.selected .embed-hint {
  opacity: 1;
  color: var(--accent);
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
