<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useSettingsModal } from '../../composables/useSettingsModal'
import { pushModal, popModal } from '../../composables/useModalKeyboard'
import { useTheme } from '../../composables/useTheme'
import { X, Sun, Moon, Monitor } from 'lucide-vue-next'

const { isOpen, close } = useSettingsModal()

watch(isOpen, (visible) => {
  if (visible) {
    pushModal('settings-modal')
  } else {
    popModal('settings-modal')
  }
})

onUnmounted(() => popModal('settings-modal'))
const { theme, setTheme } = useTheme()

type Section = 'appearance' | 'editor' | 'data' | 'about'

const activeSection = ref<Section>('appearance')

const sections: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'editor', label: '编辑器' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' },
]

const themeOptions: { value: 'light' | 'dark' | 'system'; label: string; icon: any }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '暗色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

function handleOverlayClick() {
  close()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="settings-modal">
      <div v-if="isOpen" class="settings-modal-overlay" @click.self="handleOverlayClick">
        <div class="settings-modal">
          <div class="settings-modal-nav">
            <div class="nav-title">设置</div>
            <button
              v-for="section in sections"
              :key="section.key"
              class="nav-item"
              :class="{ active: activeSection === section.key }"
              @click="activeSection = section.key"
            >
              {{ section.label }}
            </button>
          </div>

          <div class="settings-modal-content">
            <div class="content-header">
              <h2 class="content-title">{{ sections.find(s => s.key === activeSection)?.label }}</h2>
              <button class="close-btn" @click="close">
                <X :size="16" :stroke-width="1.75" />
              </button>
            </div>

            <div class="content-body">
              <template v-if="activeSection === 'appearance'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">主题</span>
                    <span class="setting-desc">选择应用主题</span>
                  </div>
                  <div class="theme-selector">
                    <button
                      v-for="option in themeOptions"
                      :key="option.value"
                      class="theme-option"
                      :class="{ active: theme === option.value }"
                      @click="setTheme(option.value)"
                    >
                      <component :is="option.icon" :size="14" :stroke-width="1.75" />
                      {{ option.label }}
                    </button>
                  </div>
                </div>
              </template>

              <template v-if="activeSection === 'editor'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">字体大小</span>
                    <span class="setting-desc">调整编辑器字体大小（即将推出）</span>
                  </div>
                  <span class="setting-value">默认</span>
                </div>
              </template>

              <template v-if="activeSection === 'data'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导出数据</span>
                    <span class="setting-desc">将所有页面和块导出为 JSON（即将推出）</span>
                  </div>
                  <button class="setting-btn" disabled>导出</button>
                </div>
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">导入数据</span>
                    <span class="setting-desc">从 JSON 文件导入数据（即将推出）</span>
                  </div>
                  <button class="setting-btn" disabled>导入</button>
                </div>
              </template>

              <template v-if="activeSection === 'about'">
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">版本</span>
                    <span class="setting-desc">comind v0.1.0</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay);
  backdrop-filter: blur(4px);
}

.settings-modal {
  width: 960px;
  max-height: 85vh;
  min-height: 600px;
  background: var(--color-paper);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  box-shadow: var(--shadow-modal);
  display: flex;
  overflow: hidden;
}

.settings-modal-nav {
  width: 180px;
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
  padding: 0 10px;
}

.nav-item {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-family: inherit;
  text-align: left;
  transition: background 80ms ease, color 80ms ease;
}

.nav-item:hover {
  background: var(--bg-hover);
}

.nav-item.active {
  background: var(--bg-active);
  font-weight: 500;
  color: var(--text-primary);
}

.settings-modal-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.content-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  transition: background 80ms ease, color 80ms ease;
}

.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.content-body {
  flex: 1;
  padding: 20px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}

.setting-value {
  font-size: 13px;
  color: var(--text-secondary);
}

.setting-btn {
  padding: 6px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: not-allowed;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.setting-btn:not(:disabled) {
  cursor: pointer;
  color: var(--text-secondary);
}

.setting-btn:not(:disabled):hover {
  background: var(--bg-active);
}

.theme-selector {
  display: flex;
  gap: 4px;
  background: var(--bg-hover);
  border-radius: 6px;
  padding: 2px;
}

.theme-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-family: inherit;
  transition: background 80ms ease, color 80ms ease;
}

.theme-option:hover {
  color: var(--text-secondary);
}

.theme-option.active {
  background: var(--bg-base);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 180ms ease;
}

.settings-modal-enter-active .settings-modal,
.settings-modal-leave-active .settings-modal {
  transition: transform 180ms ease;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}

.settings-modal-enter-from .settings-modal {
  transform: translateY(8px);
}

@media (max-width: 768px) {
  .settings-modal {
    width: 95vw;
    flex-direction: column;
  }

  .settings-modal-nav {
    width: 100%;
    flex-direction: row;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 12px;
    overflow-x: auto;
  }

  .nav-title {
    display: none;
  }
}
</style>
