<script setup lang="ts">
import { provide } from 'vue'

import type { PaneView } from '../stores/panes'
import GraphPage from './GraphView/GraphPage.vue'
import Page from './Page/index.vue'
import PagesLibrary from './PagesLibrary/PagesLibrary.vue'
import TagAggregatePage from './Tags/TagAggregatePage.vue'
import TagsLibrary from './Tags/TagsLibrary.vue'
import TaskHub from './TaskHub/TaskHub.vue'
import TrashList from './Trash/TrashList.vue'

defineOptions({ name: 'ViewHost' })
const props = defineProps<{ view: PaneView; paneId: string }>()

// 向子树（Page → BlockList → Block）下发所属 pane id，供 Block 按 pane 作用域化活动块，
// 修复双 pane 同页点击激活错位。
provide('paneId', props.paneId)
</script>

<template>
  <Page
    v-if="view.kind === 'page'"
    :page-id="view.ref!"
  />
  <GraphPage v-else-if="view.kind === 'graph'" />
  <TaskHub v-else-if="view.kind === 'tasks'" />
  <TagAggregatePage
    v-else-if="view.kind === 'tags' && view.ref"
    :tag-id="view.ref"
  />
  <TagsLibrary v-else-if="view.kind === 'tags'" />
  <PagesLibrary v-else-if="view.kind === 'pages'" />
  <TrashList v-else-if="view.kind === 'trash'" />
</template>
