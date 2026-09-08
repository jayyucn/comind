<script setup lang="ts">
// IdeasSnapshotPage - 历史 Ideas 页快照只读渲染（ADR-0042 T5）
//
// 只读渲染一张过期 ideas 页的 page_snapshots 内容：buildTree 复用既有树组装，
// 逐行复用 BulletRender（富文本/[[wiki]]）+ 只读图片缩放 + 当日 status/priority 视觉。
// 今日页/未过期页（守卫失败）不应经此组件渲染——父级负责按 isStaleIdeasPage 分流。
import { computed, nextTick, provide, reactive, ref, watch } from 'vue'
import { usePageStore } from '../../stores/pages'
import { buildTree } from '../../composables/useBlockTree'
import { isStaleIdeasPage } from '../../utils/ideas-snapshot'
import type { IdeasSnapshotData } from '../../utils/ideas-snapshot'
import {
  SNAPSHOT_PROPS_KEY,
  SNAPSHOT_TREE_KEY,
  type SnapshotPropsMap,
  type SnapshotTreeState,
} from './snapshotContext'
import IdeasSnapshotNode from './IdeasSnapshotNode.vue'

const props = defineProps<{
  pageId: string
}>()

const pageStore = usePageStore()

/** 守卫：仅历史 ideas 页在此渲染；否则空渲染（父级已分流，此处兜底）。
 * 标题取自快照（ideasSnapshots[pageId].title），不再依赖 Page（ADR-0042 整条链路去 getPage）。 */
const isSnapshotPage = computed(() => !!snapshot.value && isStaleIdeasPage(snapshot.value.title))

const snapshot = ref<IdeasSnapshotData | null>(null)
const loading = ref(false)
const loadError = ref(false)

// ── 折叠状态（页面级共享；仅折叠/展开，快照不可变无持久化）──
const collapsedIds = reactive(new Set<string>())
const treeState: SnapshotTreeState = {
  isCollapsed: (id) => collapsedIds.has(id),
  toggle: (id) => {
    if (collapsedIds.has(id)) collapsedIds.delete(id)
    else collapsedIds.add(id)
  },
}
provide<SnapshotTreeState>(SNAPSHOT_TREE_KEY, treeState)

const propsMap: SnapshotPropsMap = {
  propsByBlock: {},
  getBlockProps: (blockId) => snapshot.value?.properties[blockId] ?? [],
}
provide<SnapshotPropsMap>(SNAPSHOT_PROPS_KEY, propsMap)

// ── 快照读取（pages store 会话内缓存；快照不可变）──
watch(
  () => props.pageId,
  async (pageId) => {
    snapshot.value = null
    collapsedIds.clear()
    if (!pageId) return
    loading.value = true
    loadError.value = false
    try {
      snapshot.value = await pageStore.getIdeasSnapshot(pageId)
    } catch (err) {
      console.error('[IdeasSnapshotPage] 读取快照失败:', err)
      loadError.value = true
    } finally {
      loading.value = false
    }
    // 快照正文（含空态占位）已挂载：通知 Page/index 侧补一次 navigate-to-block 滚动定位
    // （历史页正文异步读取，首次 querySelector 往往为空，见 handleNavigateToBlockEvent）
    await nextTick()
    window.dispatchEvent(new Event('ideas-snapshot-mounted'))
  },
  { immediate: true },
)

const roots = computed(() => {
  if (!snapshot.value) return []
  return buildTree(snapshot.value.blocks, props.pageId, null)
})
</script>

<template>
  <div v-if="isSnapshotPage" class="snapshot-page" data-snapshot-view>
    <!-- 加载中骨架 -->
    <div v-if="loading" class="snapshot-loading">
      <div class="snapshot-line"></div>
      <div class="snapshot-line short"></div>
      <div class="snapshot-line"></div>
    </div>
    <!-- 读取失败：静默降级为空白占位（快照只读，无重试副作用） -->
    <div v-else-if="loadError" class="snapshot-empty">
      <span class="snapshot-empty-text">快照加载失败</span>
    </div>
    <!-- 有快照内容 → 只读树 -->
    <template v-else-if="snapshot">
      <template v-if="roots.length > 0">
        <IdeasSnapshotNode
          v-for="root in roots"
          :key="root.id"
          :node="root"
          :page-id="pageId"
          :depth="0"
        />
      </template>
      <div v-else class="snapshot-empty">
        <span class="snapshot-empty-text">当日无内容</span>
      </div>
    </template>
    <!-- 无快照（守卫放行但尚未物化，如启动竞态）：占位，不读活数据 -->
    <div v-else class="snapshot-empty">
      <span class="snapshot-empty-text">该页快照尚未生成</span>
    </div>
  </div>
</template>

<style scoped>
.snapshot-page {
  min-height: 40vh;
}

.snapshot-loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 0;
}

.snapshot-line {
  height: 10px;
  border-radius: 3px;
  background: var(--bg-base2);
}

.snapshot-line.short {
  width: 60%;
}

.snapshot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
}

.snapshot-empty-text {
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>
