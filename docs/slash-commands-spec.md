# 斜杠命令面板功能规格

> 版本：v0.1
> 日期：2026-04-23
> 状态：📝 设计中

---

## 设计哲学

### 美学方向：静谧的工具卡片

> 命令面板像一张半透明的索引卡，从光标位置浮现，不抢戏但精准。

**视觉特点**：
- 背景：`--bg-base`（米白 #FAFAF8）
- 边框：`--border`（极淡灰 #E5E4DF）
- 选中项：`--accent-subtle` 背景 + 左侧 2px `--accent` 边框（呼应 Block 编辑态）
- 阴影：`0 4px 12px rgba(28, 25, 23, 0.08)`（柔和投影，不刺眼）
- 字体：Noto Sans SC + Geist，13px
- 动画：180ms cubic-bezier(0.4, 0, 0.2, 1) 淡入滑入

---

## 功能规格

### 1. 触发机制

**触发条件**：
- Block 处于编辑态（tiptap 已挂载）
- 光标在 Block 内容中（非开头、非结尾的特定位置）
- 输入 `/` 字符

**触发位置**：
- 面板在 `/` 字符下方弹出
- 左对齐光标位置
- 如果右侧空间不足，向左偏移

**不触发场景**：
- Block 开头输入 `/`（可能是代码路径）
- URL 中输入 `/`（`https://`）
- 已有面板打开时

### 2. 面板结构

```
┌─────────────────────────────────────────┐
│ 🔍 search commands...                   │ ← 搜索框（可选）
├─────────────────────────────────────────┤
│ 📅 日期时间                              │ ← 分组标题
│ ┌─────────────────────────────────────┐ │
│ │     📆 今天日期                      │ │ ← 命令项（选中态）
│ │     ⏰ 当前时间                      │ │
│ └─────────────────────────────────────┘ │
│ 📄 页面操作                              │
│ ┌─────────────────────────────────────┐ │
│ │     🔗 跳转页面                      │ │
│ │     ➕ 新建页面                      │ │
│ └─────────────────────────────────────┘ │
│ 📝 格式                                  │
│ ┌─────────────────────────────────────┐ │
│ │     ✓ 待办事项                      │ │
│ │     💬 引用块                        │ │
│ │     💻 代码块                        │ │
│ └─────────────────────────────────────┘ │
│ 🔗 链接                                  │
│ ┌─────────────────────────────────────┐ │
│ │     📎 插入链接                      │ │
│ │     🏷️ 插入标签                     │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**尺寸规格**：
- 宽度：280px
- 最大高度：320px（超出滚动）
- 命令项高度：32px
- 分组标题高度：28px
- 内边距：8px
- 圆角：6px

### 3. 命令列表（Phase 1.1 MVP）

#### 分组 1：日期时间

| 命令 | 插入内容 | 示例 |
|------|----------|------|
| `/date` / `/今天` | 今日日期链接 | `[[2026-04-23]]` |
| `/time` / `/时间` | 当前时间 | `00:22` |
| `/datetime` | 日期+时间 | `[[2026-04-23]] 00:22` |

#### 分组 2：页面操作

| 命令 | 功能 | 行为 |
|------|------|------|
| `/page` / `/跳转` | 跳转页面 | 弹出页面搜索，选择后跳转 |
| `/new` / `/新建` | 新建页面 | 创建新 Page 并跳转 |

#### 分组 3：格式

| 命令 | 功能 | 行为 |
|------|------|------|
| `/todo` / `/待办` | 待办事项 | 插入 `TODO` 标记 |
| `/doing` | 进行中 | 插入 `DOING` 标记 |
| `/done` | 已完成 | 插入 `DONE` 标记 |
| `/quote` / `/引用` | 引用块 | 将当前 Block 转为引用块 |
| `/code` / `/代码` | 代码块 | 将当前 Block 转为代码块 |

#### 分组 4：链接

| 命令 | 功能 | 行为 |
|------|------|------|
| `/link` / `/链接` | 插入链接 | 插入 `[[|]]` 模板，光标在中间 |
| `/tag` / `/标签` | 插入标签 | 插入 `#` 字符 |

### 4. 搜索与过滤

**模糊匹配算法**：
```typescript
function filterCommands(query: string, commands: Command[]): Command[] {
  const lowerQuery = query.toLowerCase()
  return commands.filter(cmd => {
    const name = cmd.name.toLowerCase()
    const alias = cmd.alias?.map(a => a.toLowerCase()) || []
    
    // 前缀匹配优先
    if (name.startsWith(lowerQuery)) return true
    if (alias.some(a => a.startsWith(lowerQuery))) return true
    
    // 包含匹配次之
    if (name.includes(lowerQuery)) return true
    if (alias.some(a => a.includes(lowerQuery))) return true
    
    // 拼音匹配（Phase 2）
    // if (pinyinMatch(name, lowerQuery)) return true
    
    return false
  })
}
```

**匹配优先级**：
1. 前缀匹配（`/da` → `/date`）
2. 别名匹配（`/今天` → `/date`）
3. 包含匹配（`/ate` → `/date`）
4. 拼音匹配（Phase 2）

### 5. 键盘导航

| 按键 | 行为 |
|------|------|
| `↑` | 选择上一命令 |
| `↓` | 选择下一命令 |
| `Enter` | 执行选中命令 |
| `Esc` | 关闭面板，恢复编辑 |
| `Tab` | 关闭面板，焦点回到编辑器 |
| `Backspace`（空查询时） | 关闭面板 |

**循环导航**：
- 第一个命令按 `↑` → 跳到最后一个
- 最后一个命令按 `↓` → 跳到第一个

### 6. 执行行为

#### 命令执行流程

```
用户输入 `/` → 面板弹出 → 用户过滤/选择 → 按 Enter
    ↓
1. 获取当前光标位置
2. 删除 `/` 及其后的查询文本
3. 执行命令逻辑
4. 更新编辑器内容
5. 关闭面板
6. 焦点回到编辑器
```

#### 特殊命令处理

**`/date` 命令**：
1. 删除 `/date`
2. 插入 `[[2026-04-23]]`
3. 光标定位在 `]]` 后

**`/page` 命令**：
1. 删除 `/page`
2. 关闭斜杠面板
3. 打开页面搜索面板
4. 用户选择页面后跳转

**`/link` 命令**：
1. 删除 `/link`
2. 插入 `[[|]]`
3. 光标定位在 `|` 位置（选中状态）

### 7. 关闭条件

**自动关闭**：
- 点击面板外部
- 按 `Esc`
- 按 `Tab`（焦点转移）
- 执行命令后
- Block 失去焦点

**不关闭**：
- 面板内滚动
- 面板内 hover

---

## 技术实现（方案 B：tiptap Extension）

### 1. Extension 结构

```typescript
// src/extensions/SlashCommand.ts
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from 'prosemirror-state'
import SlashCommandMenu from '@/components/SlashCommandMenu.vue'

export interface SlashCommandOptions {
  commands: Command[]
}

export interface Command {
  id: string
  name: string
  alias?: string[]
  group: string
  icon: string
  action: (props: CommandProps) => void
}

export interface CommandProps {
  editor: Editor
  range: { from: number; to: number }
  command: Command
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',
  
  addOptions() {
    return {
      commands: [],
    }
  },
  
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('slashCommand'),
        props: {
          handleTextInput(view, from, to, text) {
            // 检测 `/` 输入
            if (text === '/') {
              const { state } = view
              const $from = state.doc.resolve(from)
              
              // 检查是否在 Block 开头
              const textBefore = $from.nodeBefore?.text || ''
              if (textBefore.length === 0) {
                return false // Block 开头不触发
              }
              
              // 检查是否在 URL 中
              if (isInURL(state.doc, from)) {
                return false
              }
              
              // 触发斜杠命令面板
              this.showSlashMenu(view, from)
            }
            return false
          },
        },
      }),
    ]
  },
  
  showSlashMenu(view, position) {
    // 发送事件给 Vue 层
    const event = new CustomEvent('slash-command-trigger', {
      detail: { view, position }
    })
    window.dispatchEvent(event)
  },
})
```

### 2. Vue 组件架构

```vue
<!-- src/components/SlashCommandMenu.vue -->
<template>
  <Teleport to="body">
    <Transition name="slash-menu">
      <div
        v-if="visible"
        class="slash-menu"
        :style="menuStyle"
        @click.stop
      >
        <!-- 分组列表 -->
        <div class="slash-menu-groups" ref="groupsRef">
          <div
            v-for="group in groupedCommands"
            :key="group.name"
            class="slash-menu-group"
          >
            <div class="slash-menu-group-title">
              {{ group.icon }} {{ group.name }}
            </div>
            <div class="slash-menu-items">
              <button
                v-for="(cmd, idx) in group.commands"
                :key="cmd.id"
                class="slash-menu-item"
                :class="{ 'is-selected': isSelected(cmd) }"
                @click="executeCommand(cmd)"
                @mouseenter="selectedIndex = idx"
              >
                <span class="slash-menu-item-icon">{{ cmd.icon }}</span>
                <span class="slash-menu-item-name">{{ cmd.name }}</span>
                <span v-if="cmd.alias" class="slash-menu-item-alias">
                  {{ cmd.alias.join(', ') }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { Command } from '@/extensions/SlashCommand'

const visible = ref(false)
const query = ref('')
const selectedIndex = ref(0)
const position = ref({ x: 0, y: 0 })

// 命令列表
const commands = ref<Command[]>([
  // 日期时间
  { id: 'date', name: '今天日期', alias: ['date', '今天'], group: '日期时间', icon: '📆', action: insertDate },
  { id: 'time', name: '当前时间', alias: ['time', '时间'], group: '日期时间', icon: '⏰', action: insertTime },
  
  // 页面操作
  { id: 'page', name: '跳转页面', alias: ['page', '跳转'], group: '页面操作', icon: '🔗', action: jumpToPage },
  { id: 'new', name: '新建页面', alias: ['new', '新建'], group: '页面操作', icon: '➕', action: createNewPage },
  
  // 格式
  { id: 'todo', name: '待办事项', alias: ['todo', '待办'], group: '格式', icon: '✓', action: insertTodo },
  { id: 'quote', name: '引用块', alias: ['quote', '引用'], group: '格式', icon: '💬', action: insertQuote },
  { id: 'code', name: '代码块', alias: ['code', '代码'], group: '格式', icon: '💻', action: insertCode },
  
  // 链接
  { id: 'link', name: '插入链接', alias: ['link', '链接'], group: '链接', icon: '📎', action: insertLink },
  { id: 'tag', name: '插入标签', alias: ['tag', '标签'], group: '链接', icon: '🏷️', action: insertTag },
])

// 过滤后的命令
const filteredCommands = computed(() => {
  if (!query.value) return commands.value
  return filterCommands(query.value, commands.value)
})

// 分组命令
const groupedCommands = computed(() => {
  const groups = new Map<string, { name: string; icon: string; commands: Command[] }>()
  
  filteredCommands.value.forEach(cmd => {
    if (!groups.has(cmd.group)) {
      groups.set(cmd.group, {
        name: cmd.group,
        icon: getGroupIcon(cmd.group),
        commands: [],
      })
    }
    groups.get(cmd.group)!.commands.push(cmd)
  })
  
  return Array.from(groups.values())
})

// 位置样式
const menuStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
}))

// 监听 tiptap Extension 触发
onMounted(() => {
  window.addEventListener('slash-command-trigger', handleTrigger)
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('slash-command-trigger', handleTrigger)
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleKeyDown)
})

function handleTrigger(event: CustomEvent) {
  const { view, position: pos } = event.detail
  // 计算 DOM 位置
  const coords = view.coordsAtPos(pos)
  position.value = { x: coords.left, y: coords.bottom + 8 }
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
}

function handleKeyDown(event: KeyboardEvent) {
  if (!visible.value) return
  
  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      selectPrevious()
      break
    case 'ArrowDown':
      event.preventDefault()
      selectNext()
      break
    case 'Enter':
      event.preventDefault()
      executeSelectedCommand()
      break
    case 'Escape':
      closeMenu()
      break
  }
}

function executeCommand(cmd: Command) {
  cmd.action({ editor, range, command: cmd })
  closeMenu()
}

function closeMenu() {
  visible.value = false
  query.value = ''
}
</script>
```

### 3. 样式规范

```css
/* SlashCommandMenu.vue */
.slash-menu {
  position: fixed;
  width: 280px;
  max-height: 320px;
  overflow-y: auto;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(28, 25, 23, 0.08);
  padding: 8px 0;
  z-index: 1000;
  font-family: 'Noto Sans SC', 'Geist', system-ui, sans-serif;
  font-size: 13px;
}

.slash-menu-group-title {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.slash-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: none; /* 瞬时响应 */
}

.slash-menu-item:hover,
.slash-menu-item.is-selected {
  background: var(--accent-subtle);
  border-left-color: var(--accent);
}

.slash-menu-item-icon {
  width: 20px;
  font-size: 14px;
}

.slash-menu-item-name {
  flex: 1;
  color: var(--text-primary);
  text-align: left;
}

.slash-menu-item-alias {
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: 'JetBrains Mono', monospace;
}

/* 动画 */
.slash-menu-enter-active,
.slash-menu-leave-active {
  transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1),
              transform 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.slash-menu-enter-from,
.slash-menu-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
```

---

## 验收标准

### 功能验收

| 功能 | 验收标准 |
|------|----------|
| 触发 | Block 内输入 `/` 弹出面板，位置正确 |
| 过滤 | 输入 `/da` 过滤显示 `/date` 命令 |
| 执行 date | 选择 `/date` 替换为 `[[2026-04-23]]`，光标在链接后 |
| 执行 page | 选择 `/page` 弹出页面搜索，选择后跳转 |
| 执行 link | 选择 `/link` 插入 `[[|]]`，光标在 `|` 位置 |
| 键盘导航 | ↑↓ 选择命令，Enter 执行，ESC 关闭 |
| 关闭 | 点击外部或 ESC 关闭，恢复编辑 |

### 性能验收

| 指标 | 目标 |
|------|------|
| 面板弹出延迟 | < 50ms |
| 过滤响应时间 | < 16ms |
| 命令执行时间 | < 100ms |

---

## Phase 2 扩展

- 拼音搜索支持
- 自定义命令
- 模板系统
- 最近使用命令
- 命令快捷键（如 `/d` 直接执行 `/date`）

---

*文档 v0.1，设计中。*
