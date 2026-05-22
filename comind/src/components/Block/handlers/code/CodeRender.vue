<script setup lang="ts">
import { useCodeBlock, useLanguageMenu, useCopyButton } from './useCodeBlock'
import { ref } from 'vue'

const props = defineProps<{
  content: string
  language?: string
  showPlaceholder?: boolean
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'language-change', lang: string): void
}>()

const langButtonRef = ref<HTMLButtonElement | null>(null)

const { languages, currentLang, currentLangLabel, highlightedContent } = useCodeBlock({
  content: props.content,
  language: props.language,
})

const { showLangMenu, menuPosition, toggleMenu } = useLanguageMenu(langButtonRef)

const { showCopied, copyCode } = useCopyButton()

function selectLanguage(lang: string) {
  showLangMenu.value = false
  emit('language-change', lang)
}
</script>

<template>
  <div class="block-code" @click="$emit('content-click', $event)">
    <div class="code-lang-button-container">
      <button
        ref="langButtonRef"
        class="code-lang-button"
        @click.stop="toggleMenu"
      >
        {{ currentLangLabel }}
        <span class="dropdown-arrow">▼</span>
      </button>
      <Teleport to="body">
        <Transition name="fade">
          <div
            v-if="showLangMenu"
            class="lang-menu"
            :style="{ top: menuPosition.top + 'px', left: menuPosition.left + 'px' }"
            @click.stop
          >
            <div
              v-for="lang in languages"
              :key="lang.id"
              :class="['lang-item', { active: lang.id === currentLang }]"
              @click="selectLanguage(lang.id)"
            >
              {{ lang.label }}
            </div>
          </div>
        </Transition>
      </Teleport>
    </div>

    <div class="code-copy-button-container">
      <button
        class="code-copy-button"
        @click.stop="copyCode(content)"
        :title="showCopied ? 'Copied!' : 'Copy code'"
      >
        <span v-if="showCopied" class="copy-icon">✓</span>
        <span v-else class="copy-icon">📋</span>
      </button>
    </div>

    <div class="code-content">
      <span v-if="showPlaceholder && !content" class="block-placeholder">Enter code...</span>
      <pre v-else class="syntax-highlight" v-html="highlightedContent"></pre>
    </div>
  </div>
</template>

<style scoped>
.block-code {
  position: relative;
  font-family: 'Fira Code', 'Monaco', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.5;
  padding: 32px 12px 12px 12px;
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 4px;
  overflow-x: auto;
  min-height: 60px;
}

.code-lang-button-container {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.block-code:hover .code-lang-button-container {
  opacity: 1;
}

.code-lang-button {
  background: #333;
  color: #d4d4d4;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}

.code-lang-button:hover {
  background: #444;
  border-color: #666;
}

.dropdown-arrow {
  font-size: 10px;
  opacity: 0.7;
}

.code-copy-button-container {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.block-code:hover .code-copy-button-container {
  opacity: 1;
}

.code-copy-button {
  background: #333;
  color: #d4d4d4;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  min-width: 32px;
}

.code-copy-button:hover {
  background: #444;
  border-color: #666;
}

.copy-icon {
  font-size: 14px;
}

.lang-menu {
  position: fixed;
  background: #2d2d2d;
  border: 1px solid #555;
  border-radius: 4px;
  margin-top: 4px;
  min-width: 150px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  overflow: hidden;
}

.lang-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #d4d4d4;
  cursor: pointer;
  transition: background 0.1s ease;
}

.lang-item:hover {
  background: #3a3a3a;
}

.lang-item.active {
  background: #3d3d3d;
  border-left: 2px solid #569cd6;
  padding-left: 10px;
}

.code-content {
  min-height: 24px;
}

.syntax-highlight {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-size: 14px;
}

.syntax-highlight :deep(.hljs-keyword) {
  color: #569cd6;
}

.syntax-highlight :deep(.hljs-string) {
  color: #ce9178;
}

.syntax-highlight :deep(.hljs-number) {
  color: #b5cea8;
}

.syntax-highlight :deep(.hljs-function) {
  color: #dcdcaa;
}

.syntax-highlight :deep(.hljs-comment) {
  color: #6a9955;
  font-style: italic;
}

.syntax-highlight :deep(.hljs-variable) {
  color: #9cdcfe;
}

.syntax-highlight :deep(.hljs-type) {
  color: #4ec9b0;
}

.syntax-highlight :deep(.hljs-attr) {
  color: #9cdcfe;
}

.syntax-highlight :deep(.hljs-literal) {
  color: #b5cea8;
}

.block-placeholder {
  color: #666;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
