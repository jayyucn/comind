<script setup lang="ts">
// 阅读器窗口壳（票 03 / ADR-0040 D1/D4/D10）：独立 Tauri WebviewWindow 打开
// （/reader/:bookId，App.vue 对该路由不渲染主窗口壳）。顶栏 = 书名/章节名 +
// 目录 + 上/下章 + 窗口控制（无边框窗口自绘）；正文由 ChapterContent 渲染。
import { computed, onMounted, ref, shallowRef } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { EPUB, EPUBTOCItem } from 'foliate-js/epub.js'
import { formatLanguageMap, loadEpubFromStorage } from '../../services/epub-loader'
import { useWindowControls } from '../../app/useWindowControls'
import { isTauriEnvironment } from '../../wasm/tauri-platform'
import Icon from '../Icons/Icon.vue'
import ChapterContent from './ChapterContent.vue'
import TocDrawer, { type TocEntry } from './TocDrawer.vue'

const props = defineProps<{
  bookId: string
}>()

type Phase = 'loading' | 'ready' | 'error'

const phase = ref<Phase>('loading')
/** 原始加载错误（书文件缺失/损坏），错误态小字展示便于排查 */
const loadError = ref('')
const book = shallowRef<EPUB | null>(null)
const currentIndex = ref(0)
const tocOpen = ref(false)

const { isMaximized, startDragging, minimize, maximize, close } = useWindowControls()

const sections = computed(() => book.value?.sections ?? [])
const currentSection = computed(() => sections.value[currentIndex.value] ?? null)
const bookTitle = computed(() =>
  book.value ? formatLanguageMap(book.value.metadata?.title).trim() : '')

/** TOC 树 → 扁平列表（depth 控制缩进），href 经 book.resolveHref 定位 spine 下标 */
const flatToc = computed<TocEntry[]>(() => {
  const out: TocEntry[] = []
  const walk = (items: EPUBTOCItem[] | null | undefined, depth: number): void => {
    if (!items) return
    for (const item of items) {
      let index: number | null = null
      if (item.href) {
        const resolved = book.value?.resolveHref(item.href)
        if (resolved && resolved.index >= 0) index = resolved.index
      }
      out.push({ label: item.label?.trim() || '（未命名）', index, depth })
      walk(item.subitems, depth + 1)
    }
  }
  walk(book.value?.toc ?? null, 0)
  return out
})

/** 顶栏章节名：TOC 中首个指向当前 spine 下标的条目（无 TOC 时留空） */
const chapterTitle = computed(() =>
  flatToc.value.find(entry => entry.index === currentIndex.value)?.label ?? '')

const canPrev = computed(() => currentIndex.value > 0)
const canNext = computed(() => currentIndex.value < sections.value.length - 1)

function goTo(index: number): void {
  // 跳转或点击当前章都关闭抽屉；越界/重复章不变更内容
  tocOpen.value = false
  if (index < 0 || index >= sections.value.length || index === currentIndex.value) return
  currentIndex.value = index
}

function prev(): void {
  if (canPrev.value) goTo(currentIndex.value - 1)
}

function next(): void {
  if (canNext.value) goTo(currentIndex.value + 1)
}

onMounted(async () => {
  try {
    const loaded = await loadEpubFromStorage(props.bookId)
    if (!loaded.sections.length) throw new Error('本书没有可读的章节')
    book.value = loaded
    phase.value = 'ready'
    if (isTauriEnvironment()) {
      // 窗口标题栏从初始「阅读」更新为书名
      const title = bookTitle.value
      if (title) void getCurrentWindow().setTitle(title)
    }
  } catch (e) {
    // 票 01 已知让步：落盘失败不回滚 Page，书 Page 存在但文件缺失 → 此处兜底
    console.error('[reader] 加载书失败:', e)
    loadError.value = e instanceof Error ? e.message : String(e)
    phase.value = 'error'
  }
})
</script>

<template>
  <div class="reader-window">
    <header class="reader-topbar" @mousedown="startDragging">
      <div class="reader-title">
        <span class="book-title">{{ bookTitle }}</span>
        <span v-if="chapterTitle" class="chapter-name">{{ chapterTitle }}</span>
      </div>
      <div class="top-right-controls">
        <button class="topbar-btn" title="目录" @click="tocOpen = true">
          <Icon name="icon-menu" :size="16" />
        </button>
        <button class="topbar-btn" title="上一章" :disabled="!canPrev" @click="prev">
          <Icon name="icon-arrow-left" :size="16" />
        </button>
        <button class="topbar-btn" title="下一章" :disabled="!canNext" @click="next">
          <Icon name="icon-arrow-right" :size="16" />
        </button>
        <div v-if="isTauriEnvironment()" class="window-controls">
          <button class="window-control-btn" title="最小化" @click="minimize">
            <Icon name="icon-minimize" :size="18" />
          </button>
          <button class="window-control-btn" :title="isMaximized ? '还原' : '最大化'" @click="maximize">
            <Icon :name="isMaximized ? 'icon-square' : 'icon-maximize'" :size="18" />
          </button>
          <button class="window-control-btn close-btn" title="关闭" @click="close">
            <Icon name="icon-close" :size="18" />
          </button>
        </div>
      </div>
    </header>

    <main class="reader-body">
      <div v-if="phase === 'loading'" class="reader-placeholder">正在打开书…</div>

      <div v-else-if="phase === 'error'" class="reader-error">
        <p class="error-title">无法打开这本书</p>
        <p class="error-detail">书文件缺失或无法读取（可能导入时保存失败）。</p>
        <p class="error-detail">请删除这本书后重新导入。</p>
        <p class="error-raw">{{ loadError }}</p>
      </div>

      <ChapterContent
        v-else-if="book && currentSection"
        :key="currentSection.id"
        :book="book"
        :section="currentSection"
      />
    </main>

    <TocDrawer
      :open="tocOpen"
      :entries="flatToc"
      :current-index="currentIndex"
      @select="goTo"
      @close="tocOpen = false"
    />
  </div>
</template>

<style lang="scss" scoped>
.reader-window {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  overflow: hidden;
}

.reader-topbar {
  height: var(--nav-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 16px;
  flex-shrink: 0;
  user-select: none;
  border-bottom: 1px solid var(--border);
}

.reader-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.book-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-name {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.top-right-controls {
  display: flex;
  align-items: center;
  gap: 2px;
}

.topbar-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  height: 28px;
  min-width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: all 100ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &:disabled {
    color: var(--text-disabled);
    cursor: default;
  }
}

.window-controls {
  display: flex;
  align-items: center;
  margin-left: 8px;
}

.window-control-btn {
  width: 40px;
  height: var(--nav-height);
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: all 100ms ease;
  flex-shrink: 0;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.close-btn:hover {
  background: var(--color-error, #e81123);
  color: white;
}

.reader-body {
  flex: 1;
  min-height: 0;
}

.reader-placeholder,
.reader-error {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
}

.error-title {
  font-size: var(--text-lg);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
}

.error-detail {
  font-size: var(--text-sm);
}

.error-raw {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  word-break: break-all;
  max-width: 560px;
}
</style>
