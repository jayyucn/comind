# WikiLink Menu 实时输入菜单设计方案

**日期：** 2026-05-26  
**状态：** 已批准

---

## 1. 概述

移除 WikiLink 菜单中的搜索框，实现编辑器内实时输入触发菜单的体验：
- 用户在编辑器输入 `[[` 触发菜单
- 菜单弹出后，光标**保留在编辑器**里
- 用户在编辑器里输入内容，菜单**实时根据输入内容筛选**选项
- 按 Enter 或点击菜单项选择；按 Escape 关闭
- 光标移出 `[[ ]]` 范围时菜单自动关闭

---

## 2. 架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│  Editor.vue                                                         │
│  └─ 监听 WikiLink 相关事件 (trigger/update/close)                   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │  事件通信
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│ WikiLinkTriggerExtension.ts (重构!)                                  │
│  ├─ handleKeyDown: 检测 [[ 触发                                      │
│  ├─ onTransaction: 实时检测光标位置和内容更新                        │
│  └─ 触发事件: wiki-link-trigger, wiki-link-update, wiki-link-close   │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              │
┌─────────────────────────────▼───────────────────────────────────────┐
│ PageLinkMenu.vue (简化!)                                              │
│  ├─ 无搜索输入框                                                      │
│  ├─ 接收 query 作为 prop 实时更新筛选                                 │
│  ├─ 键盘事件: ↑↓ 选择，Enter 确认，Escape 关闭                      │
│  └─ 暴露方法: selectNext, selectPrev, confirmSelect, close           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 组件职责

### 3.1 WikiLinkTriggerExtension.ts（核心改动）

**文件：** `src/extensions/WikiLinkTriggerExtension.ts`

**职责：**
- 检测 `[[` 输入 → 触发 `wiki-link-trigger` 事件
- **onTransaction 钩子：** 每次文档变化和光标移动时：
  - 检测光标是否在 `[[ ]]` 里
  - 如果是，提取内容，发送 `wiki-link-update` 事件（携带 query）
  - 如果**不在**，发送 `wiki-link-close` 事件

**触发的事件：**
```typescript
interface WikiLinkTriggerEvent {
  view: EditorView
  position: number
  range: { from: number; to: number }
}

interface WikiLinkUpdateEvent {
  query: string
}

interface WikiLinkCloseEvent {
  reason: 'cursor-move' | 'doc-change'
}
```

### 3.2 PageLinkMenu.vue（简化）

**文件：** `src/components/PageLinkMenu.vue`

**改动：**
- **移除** `<div class="wlm-header">` 和其中的搜索输入框
- `query` 从 props 接收（不再是组件内部状态）
- `updateQuery` 方法移除
- 调整样式（无 header）
- **暴露方法供 Editor 调用：**
  - `selectNext()`: 选中下一项
  - `selectPrev()`: 选中上一项
  - `confirmSelect()`: 确认选择当前项
  - `close()`: 关闭菜单

**保留功能：**
- 计算 `filteredPages` 和 `menuItems`
- 键盘事件处理逻辑
- 鼠标悬停高亮

### 3.3 Editor.vue（协调）

**文件：** `src/components/Editor.vue`

**职责：**
- 监听三种 WikiLink 事件：
  - `wiki-link-trigger`: 打开菜单
  - `wiki-link-update`: 更新 query 给菜单
  - `wiki-link-close`: 关闭菜单
- 在菜单打开时，拦截键盘事件并转发给菜单方法：
  - ↑ → menu.selectPrev()
  - ↓ → menu.selectNext()
  - Enter → menu.confirmSelect()
  - Escape → menu.close()
- 监听菜单 select/close 事件

---

## 4. 数据流向

1. **触发菜单**
   - 用户输入 `[[` → Extension 检测到 → 触发 `wiki-link-trigger` 事件
   - Editor 打开菜单，设置位置和初始 range

2. **实时更新**
   - 用户在编辑器继续输入 → `onTransaction` 检测内容变化
   - 发送 `wiki-link-update` 事件，携带当前 `[[ ]]` 里的文本
   - Menu 接收新 query，重新计算 `filteredPages`

3. **键盘导航**
   - 用户按 ↑↓ → Editor 拦截 → 调用 `menu.selectNext/Prev()`
   - 用户按 Enter → Editor 拦截 → 调用 `menu.confirmSelect()`
   - 用户按 Escape → Editor 拦截 → 调用 `menu.close()`

4. **自动关闭**
   - 用户移动光标出 `[[ ]]` 范围 → `onTransaction` 检测到
   - 发送 `wiki-link-close` 事件 → Editor 关闭菜单

5. **选择完成**
   - 用户按 Enter / 点击 → Menu 触发 `select` 事件
   - Editor 接收事件 → 替换 `[[ ]]` 内容为选中的页面名

---

## 5. 关键技术问题与处理

### 5.1 键盘事件处理

**问题：** 光标在编辑器，菜单也需要响应 ↑↓ ↵ ESC

**解决方案：**
- Editor.vue 在菜单打开时，监听键盘事件
- 根据按键类型：
  - 如果是 ↑↓ Enter Escape → 调用菜单方法，阻止默认行为
  - 其他键 → 正常输入到编辑器（不阻止）

**实现：**
```typescript
// Editor.vue
function handleKeyDown(event: KeyboardEvent) {
  if (!menuVisible.value) return

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault()
      menuRef.value?.selectNext()
      break
    case 'ArrowUp':
      event.preventDefault()
      menuRef.value?.selectPrev()
      break
    case 'Enter':
      event.preventDefault()
      menuRef.value?.confirmSelect()
      break
    case 'Escape':
      event.preventDefault()
      menuRef.value?.close()
      break
  }
}
```

### 5.2 光标位置检测

**问题：** 如何准确判断光标是否在 `[[ ]]` 范围内

**检测逻辑：**
- 获取当前光标位置 `pos`
- 向前扫描找 `[[`，向后扫描找 `]]`
- 如果找到配对的括号且 `pos` 在中间，则在范围内

---

## 6. 实现步骤

### 第 1 步：重构 WikiLinkTriggerExtension.ts

1. 增加 `onTransaction` 钩子
2. 实现光标位置检测逻辑
3. 发送三种事件：`wiki-link-trigger`, `wiki-link-update`, `wiki-link-close`

### 第 2 步：重构 PageLinkMenu.vue

1. 移除搜索框 HTML 和相关样式
2. `query` 改为 props：`defineProps<{ query: string }>()`
3. 移除内部 `query` 状态和 `updateQuery` 方法
4. 新增暴露方法：`selectNext`, `selectPrev`, `confirmSelect`, `close`
5. 调整 CSS（无 header）

### 第 3 步：重构 Editor.vue

1. 修改 `handleWikiLinkTrigger` → 只打开菜单，不调用 updateQuery
2. 新增 `handleWikiLinkUpdate` → 更新菜单 query
3. 新增 `handleWikiLinkClose` → 关闭菜单
4. 增加键盘事件拦截逻辑
5. 简化 `handleWikiLinkSelect`（已有）

---

## 7. 测试计划

1. **基础功能测试**
   - 输入 `[[` 菜单弹出
   - 菜单显示页面列表
   - 按 Enter 选择第一项

2. **实时筛选测试**
   - 输入 `[[` 触发菜单
   - 在编辑器输入 "test"
   - 菜单实时筛选包含 "test" 的页面

3. **键盘导航测试**
   - 菜单打开后按 ↑↓ 选择不同项
   - 鼠标悬停也改变选中项

4. **自动关闭测试**
   - 在 `[[test]]` 中输入内容触发菜单
   - 移动光标到 `[[` 前面
   - 菜单自动关闭

5. **边界情况测试**
   - `[[]]` 立即触发菜单
   - 输入 `]]` 关闭菜单（自动完成）
   - 创建新页面选项正常显示

---

## 8. 验收标准

- [ ] 输入 `[[` 立即弹出菜单
- [ ] 菜单无搜索框
- [ ] 在编辑器输入时菜单实时筛选
- [ ] ↑↓ 可导航，Enter 确认，Escape 关闭
- [ ] 光标移出 `[[ ]]` 范围时菜单自动关闭
- [ ] 选择页面后正确替换 `[[ ]]` 内容
- [ ] 无多余括号产生
- [ ] 编辑状态下 WikiLink 不可点击跳转

---

## 9. 相关文件

- `src/extensions/WikiLinkTriggerExtension.ts` - 重构
- `src/components/PageLinkMenu.vue` - 简化
- `src/components/Editor.vue` - 重构协调逻辑
