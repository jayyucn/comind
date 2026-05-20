<script setup lang="ts">
</script>

<template>
  <div class="settings-view">
    <div class="settings-header">
      <h1 class="settings-title">设置</h1>
    </div>

    <div class="settings-content">
      <div class="settings-section">
        <h2 class="section-title">外观</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">主题</span>
            <span class="setting-desc">选择应用主题（即将推出）</span>
          </div>
          <span class="setting-value">浅色</span>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="section-title">编辑器</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">字体大小</span>
            <span class="setting-desc">调整编辑器字体大小（即将推出）</span>
          </div>
          <span class="setting-value">默认</span>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="section-title">数据管理</h2>
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
      </div>

      <div class="settings-section">
        <h2 class="section-title">关于</h2>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">版本</span>
            <span class="setting-desc">comind v0.1.0</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: var(--max-width);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.settings-header {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.settings-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setting-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}

.setting-desc {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.setting-value {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.setting-btn {
  padding: 6px 16px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: not-allowed;
  font-size: var(--text-xs);
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
</style>
