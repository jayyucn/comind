<script setup lang="ts">
import { useJournal } from '../../composables/useJournal'

const emit = defineEmits<{
  'navigate': [pageId: string]
  'create-today': []
}>()

const { today, journalPages, todayJournalExists, createTodayJournal } = useJournal()

async function handleClick() {
  if (todayJournalExists.value) {
    const todayPage = journalPages.value.find(p => p.title === today.value)
    if (todayPage) {
      emit('navigate', todayPage.id)
    }
  } else {
    emit('create-today')
    await createTodayJournal()
  }
}
</script>

<template>
  <div class="journal-hero" @click="handleClick">
    <div class="journal-content">
      <div class="journal-icon">📓</div>
      <div class="journal-text">
        <div class="journal-title">今日日记</div>
        <div class="journal-date">{{ today }}</div>
      </div>
    </div>
    <div class="journal-arrow">
      <span>→</span>
    </div>
  </div>
</template>

<style scoped>
.journal-hero {
  height: 80px;
  background: var(--accent-subtle, #FEF3C7);
  border-radius: 8px;
  margin: var(--space-3) var(--space-3) var(--space-2);
  padding: 0 var(--space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  transition: all 150ms ease;
  box-sizing: border-box;
}

.journal-hero:hover {
  background: #FEF0C0;
}

.journal-hero:active {
  transform: scale(0.96);
}

.journal-content {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.journal-icon {
  font-size: 28px;
  line-height: 1;
}

.journal-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.journal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.journal-date {
  font-size: 12px;
  color: var(--text-secondary);
}

.journal-arrow {
  font-size: 16px;
  color: var(--text-tertiary);
  transition: transform 150ms ease;
}

.journal-hero:hover .journal-arrow {
  transform: translateX(4px);
  color: var(--text-secondary);
}
</style>