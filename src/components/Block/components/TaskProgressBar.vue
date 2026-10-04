<script setup lang="ts">
/**
 * TaskProgressBar —— 子任务进度条
 *
 * 展示「子 block 中任务项」的完成进度：done/total（Canceled 不参与，
 * 由数据源 computeChildTaskProgress 剔除后传入）。
 *
 * 样式（2026-10-03 grill 意见）：胶囊容器（非全宽长条）、定宽轨道、
 * 左侧由父级对齐到上方任务图标右缘、图标 + 计数 + 百分比、渐变填充、
 * 全部完成时转绿换勾。布局归属由父级 class / inline style 控制。
 */
import { CheckCircle2, ListChecks } from 'lucide-vue-next';
import { computed } from 'vue';

const props = defineProps<{
  done: number
  total: number
}>()

const percent = computed(() => {
  if (props.total <= 0) return 0
  return Math.round((props.done / props.total) * 100)
})

/** 全部完成（done >= total）时换勾 + 绿色 */
const isComplete = computed(() => props.total > 0 && props.done >= props.total)
</script>

<template>
  <div
    class="task-progress"
    :class="{ 'is-complete': isComplete }"
    role="progressbar"
    :aria-valuenow="percent"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="`任务进度 ${done}/${total}`"
  >
    <CheckCircle2
      v-if="isComplete"
      class="task-progress-icon"
      :size="13"
      :stroke-width="2.5"
      aria-hidden="true"
    />
    <ListChecks
      v-else
      class="task-progress-icon"
      :size="13"
      :stroke-width="2"
      aria-hidden="true"
    />
    <div class="task-progress-track">
      <div
        class="task-progress-fill"
        :style="{ width: `${percent}%` }"
      />
    </div>
    <span class="task-progress-label">
      {{ done }}/{{ total }}<span class="task-progress-percent"> · {{ percent }}%</span>
    </span>
  </div>
</template>

<style lang="scss" scoped>
/* 胶囊容器：定宽短条而非全宽，贴块内容列的紧凑徽章 */
.task-progress {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 2px var(--space-2) 2px var(--space-1);
  border-radius: 999px;
  background: var(--surface-faint);
  color: var(--text-tertiary);
  user-select: none;
  -webkit-user-select: none;
}

.task-progress-icon {
  display: inline-flex;
  flex: none;
  color: var(--text-tertiary);
}

/* 定宽轨道（进度条不需要那么长） */
.task-progress-track {
  flex: none;
  width: 140px;
  max-width: 100%;
  height: 5px;
  border-radius: 999px;
  background: var(--bg-active);
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-hover));
  transition: width var(--dur-base) var(--ease-in-out);
}

.task-progress-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.task-progress-percent {
  opacity: 0.72;
}

/* 全部完成：图标与数字转绿（--success，与 status-done 任务图标同色）、填充渐变转绿 */
.task-progress.is-complete .task-progress-icon,
.task-progress.is-complete .task-progress-label {
  color: var(--success);
}

.task-progress.is-complete .task-progress-fill {
  background: linear-gradient(
    90deg,
    var(--success),
    color-mix(in srgb, var(--success) 60%, #ffffff)
  );
}
</style>
