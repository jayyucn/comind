<script setup lang="ts">
// 单章滚动容器（票 03 / ADR-0040 D1/D10）：EPUB section → createDocument 取章节
// XHTML → 书内图片资源替换为 blob: URL → 严格 sanitize → 注入主文档（非 iframe）。
// 组件由 ReaderView 以 :key=section.id 重建（每章一个实例），objectURL 在卸载时统一回收。
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { EPUB, EPUBSection } from 'foliate-js/epub.js'
import { sanitizeChapterContent } from '../../services/epub-sanitize'

const props = defineProps<{
  book: EPUB
  section: EPUBSection
}>()

const containerRef = ref<HTMLElement | null>(null)

/** 本章经 URL.createObjectURL 创建的资源链接（卸载时 revoke，防泄漏） */
let objectUrls: string[] = []
/** 渲染代数：组件重建竞态兜底（异步渲染期间被卸载则丢弃结果） */
let renderGeneration = 0

/** 相对 URI 是否带协议头（http:/https:/data: 等，即书外资源；与 foliate isExternal 一致） */
function isExternalUri(uri: string): boolean {
  return /^(?!blob)\w+:/i.test(uri)
}

/** 章节内相对引用 → zip 内路径（与 foliate resolveURL 的 zip 分支一致） */
function resolveZipPath(uri: string, relativeTo: string): string {
  const root = 'https://invalid.invalid/'
  const obj = new URL(uri.replace(/%2c/, ','), root + relativeTo)
  obj.search = ''
  return decodeURI(obj.href.replace(root, ''))
}

/**
 * 章节图片：书内资源经 book.loadBlob 取 blob → blob: URL 替换 src；
 * 外链（http/data 等）与缺失资源直接剥掉 src（sanitize 是第二道防线）。
 */
async function resolveImages(doc: Document): Promise<void> {
  const images = Array.from(doc.querySelectorAll('img[src]'))
  for (const img of images) {
    const src = img.getAttribute('src') ?? ''
    if (isExternalUri(src)) {
      img.removeAttribute('src')
      continue
    }
    let blob: Blob | null = null
    try {
      blob = await props.book.loadBlob(resolveZipPath(src, props.section.id))
    } catch {
      blob = null
    }
    if (!blob || blob.size === 0) {
      img.removeAttribute('src')
      continue
    }
    const url = URL.createObjectURL(blob)
    objectUrls.push(url)
    img.setAttribute('src', url)
  }
}

function releaseObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls = []
}

/** 取章节正文根（XML 解析的 XHTML Document 未必有 .body 属性，按 localName 兜底） */
function getBody(doc: Document): Element {
  return doc.getElementsByTagName('body')[0] ?? doc.documentElement
}

function replaceContent(fragment: DocumentFragment): void {
  const el = containerRef.value
  if (!el) return
  el.replaceChildren(fragment)
  el.scrollTop = 0
}

function showPlainMessage(message: string): void {
  const el = containerRef.value
  if (el) el.textContent = message
}

async function render(): Promise<void> {
  const myGen = ++renderGeneration
  releaseObjectUrls()

  let doc: Document
  try {
    doc = await props.section.createDocument()
  } catch (e) {
    console.error('[reader] 章节解析失败:', e)
    if (myGen === renderGeneration) showPlainMessage('本章内容无法解析')
    return
  }

  await resolveImages(doc)
  if (myGen !== renderGeneration) return

  // 注意：以 chapter 的 body 为根做 sanitize（head 里的 title/style 等不进正文）
  const fragment = sanitizeChapterContent(getBody(doc))
  if (myGen !== renderGeneration) return
  replaceContent(fragment)
}

onMounted(() => {
  void render()
})

onBeforeUnmount(() => {
  renderGeneration++
  releaseObjectUrls()
})
</script>

<template>
  <div ref="containerRef" class="chapter-content"></div>
</template>

<style lang="scss" scoped>
.chapter-content {
  height: 100%;
  overflow-y: auto;
  padding: 32px 24px 96px;
  // 舒适行宽：正文阅读排版（字号/行距等排版参数票 04 再做）
  max-width: 720px;
  margin: 0 auto;
  color: var(--text-primary);

  @for $i from 1 through 6 {
    :deep(h#{$i}) {
      font-size: var(--heading-#{$i});
      font-weight: var(--heading-#{$i}-weight);
      line-height: var(--leading-tight);
      margin: 1.2em 0 0.5em;
    }
  }

  :deep(p) {
    margin: 0.75em 0;
    line-height: var(--leading-relaxed);
  }

  :deep(img) {
    max-width: 100%;
    height: auto;
  }

  :deep(blockquote) {
    margin: 1em 0;
    padding-left: 1em;
    border-left: 3px solid var(--border-strong);
    color: var(--text-secondary);
  }

  :deep(ul), :deep(ol) {
    margin: 0.75em 0;
    padding-left: 1.8em;
  }

  :deep(li) {
    margin: 0.25em 0;
    line-height: var(--leading-relaxed);
  }

  :deep(table) {
    border-collapse: collapse;
    margin: 1em 0;
  }

  :deep(th), :deep(td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }

  :deep(figure) {
    margin: 1em 0;
  }

  :deep(figcaption) {
    margin-top: 6px;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-align: center;
  }

  :deep(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2em 0;
  }

  :deep(pre) {
    background: var(--bg-hover);
    border-radius: var(--radius-md);
    padding: 12px;
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
}
</style>
