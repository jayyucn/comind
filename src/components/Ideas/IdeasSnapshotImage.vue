<script setup lang="ts">
// IdeasSnapshotImage - 快照中的 image 块只读渲染（ADR-0042 T5）
//
// 只读呈现图片本身（asset:// 或 url，经 assetStorage 解析）+ 当日 format
// （对齐 / 行内宽高 / 描述）。点击图片 → ImageLightbox 全屏缩放查看。
// 不依赖活 block store，不提供任何编辑/替换/裁剪通路。
import { computed, ref, watch } from 'vue'
import type { Block } from '../../types/block'
import { assetStorage } from '../../utils/asset'
import ImageLightbox from '../../Block/handlers/image/ImageLightbox.vue'

const props = defineProps<{
  block: Block
}>()

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/

const parsed = ref<{ alt: string; url: string } | null>(null)
const imgSrc = ref('')
const lightboxOpen = ref(false)

watch(
  () => props.block.content,
  async (content) => {
    const m = content.match(IMAGE_REGEX)
    parsed.value = m ? { alt: m[1] || '', url: m[2] || '' } : null
    if (!parsed.value) {
      imgSrc.value = ''
      return
    }
    if (parsed.value.url.startsWith('asset://')) {
      try {
        imgSrc.value = await assetStorage.loadUrl(parsed.value.url.slice(8))
      } catch {
        imgSrc.value = ''
      }
    } else {
      imgSrc.value = parsed.value.url
    }
  },
  { immediate: true },
)

const format = computed(() => props.block.format ?? {})
const align = computed<'left' | 'center' | 'right'>(() => (format.value.align as 'left' | 'center' | 'right') ?? 'left')
const justify = computed(() =>
  align.value === 'center' ? 'center' : align.value === 'right' ? 'flex-end' : 'flex-start',
)
const imgStyle = computed(() => {
  const f = format.value
  if (f.width && f.height) {
    return { width: `${f.width}px`, height: `${f.height}px`, maxWidth: 'none', maxHeight: 'none' }
  }
  return { maxWidth: '100%', maxHeight: '400px', width: 'auto', height: 'auto' }
})
const description = computed(() => format.value.description ?? '')

function openLightbox() {
  if (imgSrc.value) lightboxOpen.value = true
}
</script>

<template>
  <div class="snapshot-image" :style="{ justifyContent: justify }">
    <div class="snapshot-image-frame">
      <img
        v-if="imgSrc"
        class="snapshot-image-img"
        :src="imgSrc"
        :alt="parsed?.alt ?? ''"
        :style="imgStyle"
        draggable="false"
        @click="openLightbox"
      />
      <div v-else class="snapshot-image-empty">
        <span class="snapshot-image-empty-text">{{ parsed ? '图片加载失败' : '图片已清空' }}</span>
      </div>
    </div>
    <div v-if="description" class="snapshot-image-desc">{{ description }}</div>
    <ImageLightbox v-if="lightboxOpen" :src="imgSrc" :alt="parsed?.alt" @close="lightboxOpen = false" />
  </div>
</template>

<style scoped>
.snapshot-image {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.snapshot-image-frame {
  position: relative;
  display: inline-block;
  max-width: 100%;
  border-radius: var(--radius-sm, 6px);
  line-height: 0;
}

.snapshot-image-img {
  display: block;
  border-radius: var(--radius-sm, 6px);
  cursor: zoom-in;
  user-select: none;
  -webkit-user-drag: none;
}

.snapshot-image-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 160px;
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base2);
  color: var(--text-secondary);
  line-height: 1.4;
}

.snapshot-image-desc {
  margin-top: 6px;
  padding: 2px 4px;
  text-align: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.4;
  word-break: break-word;
  white-space: normal;
}
</style>
