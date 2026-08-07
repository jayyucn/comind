<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { getCoreClient } from '../../wasm/client'
import { parseDateRefs } from '../../utils/date-ref'
import { usePropertyStore } from '../../stores/property'
import type { IncompleteTask } from '../../wasm/types'
import BlockTaskItem from './BlockTaskItem.vue'

const emit = defineEmits<{
  navigate: [pageId: string, pageTitle: string]
}>()

const propertyStore = usePropertyStore()
const tasks = ref<IncompleteTask[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const client = getCoreClient()
    if (!client) throw new Error('Core client not initialized')
    tasks.value = await client.queryIncompleteTasks()
    // 预加载 property（status）用于排序
    await propertyStore.loadMultiBlockProperties(tasks.value.map(t => t.id))
  } catch (e) {
    console.error('[BlockTaskList] load failed:', e)
  } finally {
    loading.value = false
  }
})

function todayStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const sortedTasks = computed(() => {
  const today = todayStr()
  return [...tasks.value].sort((a, b) => {
    const aRefs = parseDateRefs(a.content)
    const bRefs = parseDateRefs(b.content)
    const aDeadline = aRefs.find(r => r.kind === 'deadline')
    const bDeadline = bRefs.find(r => r.kind === 'deadline')
    const aSchedule = aRefs.find(r => r.kind === 'schedule')
    const bSchedule = bRefs.find(r => r.kind === 'schedule')

    // 1. Overdue deadline 最优先
    const aOverdue = aDeadline && aDeadline.iso < today ? 1 : 0
    const bOverdue = bDeadline && bDeadline.iso < today ? 1 : 0
    if (aOverdue !== bOverdue) return bOverdue - aOverdue

    // 2. 未到期 deadline
    if (aDeadline && !bDeadline) return -1
    if (!aDeadline && bDeadline) return 1
    if (aDeadline && bDeadline) return aDeadline.iso.localeCompare(bDeadline.iso)

    // 3. 有 schedule
    if (aSchedule && !bSchedule) return -1
    if (!aSchedule && bSchedule) return 1
    if (aSchedule && bSchedule) return aSchedule.iso.localeCompare(bSchedule.iso)

    // 4. 同组 Doing > Todo
    const aStatus = propertyStore.getBlockProperty(a.id, 'status')?.value || 'Todo'
    const bStatus = propertyStore.getBlockProperty(b.id, 'status')?.value || 'Todo'
    if (aStatus !== bStatus) return aStatus === 'Doing' ? -1 : 1

    // 5. 创建时间
    return a.created_at - b.created_at
  })
})

const isEmpty = computed(() => !loading.value && sortedTasks.value.length === 0)

function handleNavigate(pageId: string, pageTitle: string) {
  emit('navigate', pageId, pageTitle)
}
</script>

<template>
  <div v-if="!isEmpty" class="block-task-list">
    <div class="task-list-header">任务</div>
    <div class="task-list-body">
      <BlockTaskItem
        v-for="task in sortedTasks"
        :key="task.id"
        :task="task"
        @navigate="handleNavigate"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.block-task-list {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--app-border, #e5e7eb);
}

.task-list-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--app-text-secondary, #6b7280);
  margin-bottom: 8px;
  padding: 0 4px;
}

.task-list-body {
  max-height: 400px;
  overflow-y: auto;
}
</style>
