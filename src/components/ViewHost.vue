<script setup lang="ts">
import type { PaneView } from '../stores/panes'
import GraphPage from './GraphView/GraphPage.vue'
import Page from './Page/index.vue'
import PagesLibrary from './PagesLibrary/PagesLibrary.vue'
import TagAggregatePage from './Tags/TagAggregatePage.vue'
import TagsLibrary from './Tags/TagsLibrary.vue'
import TaskHub from './TaskHub/TaskHub.vue'
import TrashList from './Trash/TrashList.vue'

defineOptions({ name: 'ViewHost' })
defineProps<{ view: PaneView }>()
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
