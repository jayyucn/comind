<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { usePageStore } from '../../stores/pages'
import IdeasTodayPanel from './IdeasTodayPanel.vue'
import IdeasHistoryList from './IdeasHistoryList.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import FilterBuilder from '../query/FilterBuilder.vue'
import type { Page } from '../../types/page'
import { useBlockStore } from '@/stores/blocks'
import { getPageRegistry, PAGE_ENTITY } from '../../composables/usePageQueryRegistry'
import { runPageQuery } from '../../composables/usePageQueryEngine'
import type { ViewQuery } from '../../core/query'

defineOptions({ name: 'IdeasList' })

const pageStore = usePageStore()

// 通用查询引擎注册表（组合根单例，内置字段已注册）
const registry = getPageRegistry()

// 新引擎开关：默认关闭 → 旧 IdeasList 行为完全保留（并存期）
const useNewEngine = ref(false)
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})

// 新引擎模式下：对全部页面（pageStore.pages）经 runPageQuery 完成筛选/排序/分组
const pageGroups = computed(() => {
  if (!useNewEngine.value) return []
  return runPageQuery(pageStore.pages, viewQuery.value, registry, PAGE_ENTITY)
})

const todayPage = ref<Page | null>(null)
const loadingToday = ref(true)
const targetPageId = ref<string | undefined>(undefined)

onMounted(async () => {
  try {
    todayPage.value = await pageStore.ensureTodayIdeasPage()
    await useBlockStore().ensurePageBlocks(todayPage.value.id)
  } finally {
    loadingToday.value = false
  }
})

function handleTaskNavigate(pageId: string) {
  targetPageId.value = pageId
}
</script>

<template>
  <div class="ideas-page-root">
    <div class="engine-bar">
      <label class="engine-toggle">
        <input
          type="checkbox"
          :checked="useNewEngine"
          @change="useNewEngine = ($event.target as HTMLInputElement).checked"
        />
        新筛选引擎（通用查询）
      </label>
    </div>

    <!-- 新引擎模式：通用筛选/排序/分组，作用于全部页面 -->
    <template v-if="useNewEngine">
      <div class="ideas-newfilter">
        <FilterBuilder :registry="registry" :entity-type="PAGE_ENTITY" v-model="viewQuery" />
      </div>
      <div class="page-group-list">
        <div v-for="group in pageGroups" :key="group.key" class="page-group">
          <div class="page-group-label">{{ group.label || '全部' }}（{{ group.items.length }}）</div>
          <ul class="page-group-items">
            <li v-for="p in group.items" :key="p.id" class="page-group-item">
              <span class="page-title">{{ p.title }}</span>
              <span class="page-type">{{ p.type }}</span>
            </li>
          </ul>
        </div>
      </div>
    </template>

    <!-- 旧模式：IdeasList 原有行为，完全保留 -->
    <template v-else>
      <div class="ideas-split-view">
        <!-- 今日面板：Rust 端幂等创建，保证一定存在；loading 期间显示加载态 -->
        <IdeasTodayPanel v-if="todayPage" :page-id="todayPage.id" @navigate="handleTaskNavigate" />
        <div v-else-if="loadingToday" class="today-panel-placeholder"></div>

        <IdeasHistoryList :target-page-id="targetPageId" />
      </div>
    </template>
  </div>

  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.ideas-page-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.ideas-split-view {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  animation: fadeIn 200ms ease-out;
}

.engine-bar {
  display: flex;
  align-items: center;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border-color, #ddd);
  background: var(--bg-secondary, rgba(0, 0, 0, 0.02));
}

.engine-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-xs, 12px);
  color: var(--text-secondary, #444);
  cursor: pointer;
}

.ideas-newfilter {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #ddd);
  background: var(--bg-secondary, rgba(0, 0, 0, 0.02));
}

.page-group-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 16px;
}

.page-group-label {
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--text-secondary, #444);
  margin: 10px 0 4px;
}

.page-group-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.page-group-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: var(--text-sm, 13px);
  color: var(--text-primary, #222);
}

.page-type {
  font-size: var(--text-xs, 11px);
  color: var(--text-tertiary, #999);
}

.today-panel-placeholder {
  flex: 0 0 60%;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}
</style>
