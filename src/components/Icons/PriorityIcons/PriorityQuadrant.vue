<script setup lang="ts">
import { computed } from 'vue'

/**
 * 优先级图标 · 象限方格（ADR-0054 D3）
 *
 * 统一图元 = **2×2 四个圆角方格**：四档轮廓完全相同（方格几何、圆角、间隙一致），
 * 差别仅在**点亮哪一格** —— 点亮格实心填充，其余三格仅描边并降不透明度。
 * 位置本身即语义，读者无需记忆图例：
 *
 * 轴向：**横轴 = 紧急（向右递增）、纵轴 = 重要（向上递增）**，
 * 与 `QuadrantView` 四象限网格同一套读法（同一字段禁止两种轴向）：
 *   重要且紧急 → 右上  ·  重要但不紧急 → 左上
 *   不重要但紧急 → 右下  ·  都不重要不紧急 → 左下
 *
 * 「实心格所在位置」是**形状通道**（不依赖颜色即可分档），颜色（`--priority-*-fg`）
 * 作为辅助通道叠加在实心格上；家族相似性由四格完全相同的轮廓保证 ——
 * 不存在「四种不同形状」的风格参差。
 */
const props = withDefaults(defineProps<{
  /** 点亮格：tl=左上 tr=右上 bl=左下 br=右下 */
  quadrant: 'tl' | 'tr' | 'bl' | 'br'
  size?: number | string
  color?: string
  strokeWidth?: number | string
  /** 未点亮格的描边不透明度，默认 .45（弱于实心格，让档位读数落在实心格上） */
  inactiveOpacity?: number | string
}>(), {
  size: 20,
  color: 'currentColor',
  strokeWidth: 2,
  inactiveOpacity: 0.45,
})

/**
 * 几何以「外边界」为准分配四格（含描边），保证四格外尺寸与可见间隙一致。
 * 24 单位 viewBox 中：外边距 1、外格宽 10.5、外间隙 1。
 * 描边居中对齐 ⇒ 方格几何按 strokeWidth 内缩 sw/2，相邻两格的外边界恰好
 * 相隔 1 单位，实心格与描边格因此同尺寸、不互相吞并。
 */
const OUTER_MARGIN = 1
const OUTER_SIZE = 10.5
const OUTER_GAP = 1
const OUTER_R = 2.8

type Quad = 'tl' | 'tr' | 'bl' | 'br'
const CELLS: Quad[] = ['tl', 'tr', 'bl', 'br']

/** 方格几何（含 strokeWidth 内缩），随 strokeWidth prop 变化。 */
const cells = computed(() => {
  const sw = Number(props.strokeWidth) || 2
  const size = OUTER_SIZE - sw
  const step = OUTER_SIZE + OUTER_GAP
  const origin = OUTER_MARGIN + sw / 2
  const r = Math.max(0, OUTER_R - sw / 2)
  return CELLS.map((key) => {
    const col = key === 'tr' || key === 'br' ? 1 : 0
    const row = key === 'bl' || key === 'br' ? 1 : 0
    return { key, x: origin + col * step, y: origin + row * step, size, r }
  })
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    :stroke="color"
    :stroke-width="strokeWidth"
    stroke-linejoin="round"
  >
    <!-- 四格轮廓完全一致；仅点亮格实心，其余描边并降不透明度。
         pq-lit / pq-frame 供消费方降层级时定位：栅格（frame）是「点亮格位置」的
         参照系必须保持，强度只压点亮格（lit）——见 ADR-0054 D6 -->
    <rect
      v-for="c in cells"
      :key="c.key"
      :class="c.key === quadrant ? 'pq-lit' : 'pq-frame'"
      :x="c.x"
      :y="c.y"
      :width="c.size"
      :height="c.size"
      :rx="c.r"
      :fill="c.key === quadrant ? color : 'none'"
      :stroke-opacity="c.key === quadrant ? undefined : inactiveOpacity"
    />
  </svg>
</template>
