<script setup lang="ts" generic="T">
/**
 * 封面网格视图（generic 家族成员，票 08 / ADR-0040 D9）—— Entity-agnostic。
 * 卡片：封面图（item 的 cover 属性；asset:// 引用经 assetStorage 解析为 blob URL）、
 * 标题（title 字段，与 CalendarView 同款约定）、副标题（aliases 字段首个值——书 Page
 * 的作者按导入链路约定存 aliases[0]）、可选进度环（progress prop 注入 0~1 百分比）。
 * 卡片点击 emit navigate(itemId)——开阅读器/打开详情等跳转语义由消费方接线（业务层）。
 */
import { Book } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { FieldDescriptor } from '../../core/query'
import type { GalleryConfig } from '../../core/view'
import { assetStorage } from '../../utils/asset'

const props = defineProps<{
  /** 已过滤的扁平列表。实体无关。 */
  items: T[]
  /** 实体字段描述符（标题/副标题经字段取值）。 */
  fields: FieldDescriptor[]
  /** 封面网格布局配置（当前为空壳，预留将来附加元数据）。 */
  config: GalleryConfig
  /** 取记录 id 的字段名（默认 'id'）。 */
  idKey?: string
  /** 各记录进度百分比（itemId → 0~1）；缺省或无对应项时不渲染进度环。 */
  progress?: Record<string, number>
}>()

const emit = defineEmits<{
  navigate: [itemId: string]
}>()

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

/** 卡片标题字段：title（或首个 text 字段），与 CalendarView 约定一致。 */
const titleField = computed<FieldDescriptor | undefined>(
  () => props.fields.find((f) => f.key === 'title') ?? props.fields.find((f) => f.type === 'text'),
)

/** 卡片副标题字段：aliases（书 Page 的作者按票 01 导入约定存 aliases[0]）。 */
const subtitleField = computed<FieldDescriptor | undefined>(
  () => props.fields.find((f) => f.key === 'aliases'),
)

function titleOf(item: T): string {
  return titleField.value ? String(titleField.value.get(item) ?? '') : idOf(item)
}

function subtitleOf(item: T): string | null {
  if (!subtitleField.value) return null
  const v = subtitleField.value.get(item)
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0]) return v[0]
  return null
}

/** 进度（0~1，钳制）；无进度数据返回 null（不渲染进度环）。 */
function progressOf(item: T): number | null {
  const p = props.progress?.[idOf(item)]
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.min(p, 1) : null
}

/** 进度环周长（r=15 的 SVG 圆，viewBox 36×36）。 */
const RING_CIRCUMFERENCE = 2 * Math.PI * 15

/** 百分比 → stroke-dasharray（实段 + 空段）。 */
function ringDash(percent: number): string {
  const filled = RING_CIRCUMFERENCE * percent
  return `${filled} ${RING_CIRCUMFERENCE - filled}`
}

/** 已解析的封面 URL（itemId → blob/http URL）；asset:// 异步解析后填充。 */
const coverUrls = ref<Record<string, string>>({})

watch(
  () => props.items,
  async (items) => {
    for (const item of items) {
      const id = idOf(item)
      const cover = (item as Record<string, unknown>)['cover']
      if (typeof cover !== 'string' || !cover) continue
      if (cover.startsWith('asset://')) {
        try {
          coverUrls.value[id] = await assetStorage.loadUrl(cover.slice('asset://'.length))
        } catch {
          // 封面资产缺失：留空显示占位图标（导入链路已让步资产可能缺失）
        }
      } else {
        coverUrls.value[id] = cover
      }
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="gallery-view">
    <div v-if="items.length > 0" class="gallery-grid">
      <div
        v-for="item in items"
        :key="idOf(item)"
        class="gallery-card"
        @click="emit('navigate', idOf(item))"
      >
        <div class="card-cover">
          <img
            v-if="coverUrls[idOf(item)]"
            class="cover-img"
            :src="coverUrls[idOf(item)]"
            :alt="titleOf(item)"
            loading="lazy"
          />
          <Book v-else class="cover-placeholder" :size="36" />
        </div>
        <div class="card-meta">
          <div class="card-title" :title="titleOf(item)">{{ titleOf(item) }}</div>
          <div v-if="subtitleOf(item)" class="card-subtitle">{{ subtitleOf(item) }}</div>
          <div v-if="progressOf(item) !== null" class="card-progress">
            <svg class="progress-ring" viewBox="0 0 36 36" aria-hidden="true">
              <circle class="ring-bg" cx="18" cy="18" r="15" />
              <circle
                class="ring-fg"
                cx="18"
                cy="18"
                r="15"
                :stroke-dasharray="ringDash(progressOf(item)!)"
              />
            </svg>
            <span class="progress-text">{{ Math.round(progressOf(item)! * 100) }}%</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="gallery-empty">
      <!-- 空态内容由消费方注入（如书房的「导入 EPUB」入口，票 08） -->
      <slot name="empty">
        <p>暂无记录</p>
      </slot>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.gallery-view {
  height: 100%;
  overflow: auto;
  padding: 12px;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
  gap: 16px;
}

.gallery-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-base2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 100ms ease, transform 100ms ease, box-shadow 100ms ease;

  &:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
}

.card-cover {
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  overflow: hidden;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cover-placeholder {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.card-meta {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.card-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-subtitle {
  font-size: var(--text-xs, 0.75rem);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.progress-ring {
  width: 18px;
  height: 18px;
  flex: none;

  circle {
    fill: none;
    stroke-width: 4;
  }

  .ring-bg {
    stroke: var(--border);
  }

  .ring-fg {
    stroke: var(--accent);
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: center;
  }
}

.progress-text {
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
}

.gallery-empty {
  height: 100%;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
