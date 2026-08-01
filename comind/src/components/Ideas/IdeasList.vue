<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useIdeas } from '../../composables/useIdeas'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import IdeasListItem from './IdeasListItem.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'
import { Icon } from '../Icons'

const router = useRouter()
const ideas = useIdeas()
const pageStore = usePageStore()
const blockStore = useBlockStore()

// 用于强制刷新的计数器
const refreshKey = ref(0)

// 所有点滴（按日期倒序）
// 兼容旧数据：'journal' 与 'ideas' 均视为点滴
const allIdeasPages = computed(() => {
  // 依赖refreshKey强制刷新
  refreshKey.value
  return pageStore.pages
    .filter(p => p.type === 'ideas')
    .sort((a, b) => b.title.localeCompare(a.title))
})

// 确保今天的点滴存在（先从 IDB 加载 pages，避免重复创建）
// 然后加载所有 ideas page 的 blocks
onMounted(async () => {
  await pageStore.loadAllPages()
  if (!ideas.todayIdeasExists.value) {
    await ideas.ensureTodayIdeasExists()
    await nextTick()
    refreshKey.value++
  }

  // 加载所有点滴 page 的 blocks 到 blockStore
  const ideasPageIds = pageStore.pages
    .filter(p => p.type === 'ideas')
    .map(p => p.id)
  if (ideasPageIds.length > 0) {
    await blockStore.loadMultiPageBlocks(ideasPageIds)
  }
})

function handleOpenPage(pageId: string) {
  const page = pageStore.getPage(pageId)
  if (page?.type === 'ideas') {
    router.push(`/ideas/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}
</script>

<template>
  <div class="ideas-list-view">
    <!-- 点滴条目列表 -->
    <div class="ideas-entries">
      <IdeasListItem
        v-for="ideasPage in allIdeasPages"
        :key="ideasPage.id"
        :page-id="ideasPage.id"
        @open-page="handleOpenPage"
      />

      <div v-if="allIdeasPages.length === 0" class="empty-state">
        <div class="empty-icon">
          <Icon name="icon-calendar" :size="40" color="var(--text-tertiary)" />
        </div>
        <div class="empty-text">暂无点滴</div>
      </div>
    </div>
  </div>

  <!-- SlashCommandMenu和PropertyQuickEditor、PropertyEditor放在IdeasList外层，确保页面只有一个实例 -->
  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.ideas-list-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.ideas-entries {
  display: flex;
  flex-direction: column;
}

.empty-state {
  text-align: center;
  padding: var(--space-8) 0;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: var(--text-4xl);
  margin-bottom: var(--space-4);
}

.empty-text {
  font-size: var(--text-sm);
}
</style>
