# Phase 1.1 规划

> 版本：v0.1
> 日期：2026-04-22
> 状态：**规划中**

---

## 1. 背景

Phase 1（MVP）核心功能已完成约 **64%**（28/44 功能点），但仍有部分功能缺口需要补齐以达到完整 MVP 体验。

Phase 1.1 定位为 **MVP 完善 + 效率增强**，核心目标：
1. 补齐 Phase 1 遗留缺口
2. 引入命令面板，大幅提升操作效率
3. 引入日记流（Journal）功能

---

## 2. Phase 1 遗留任务

> 以下为 Phase 1 规范中已定义但尚未实现的功能，需要在 Phase 1.1 完成。

### 2.1 属性系统（Property）

| 功能 | 状态 | 说明 |
|------|------|------|
| `key:: value` 解析 | 🔴 未实现 | 正则解析 → Block.properties JSON |
| 属性类型推断 | 🔴 未实现 | string / number / date / boolean / list / page |
| 属性 UI 渲染 | 🔴 未实现 | Property 区块显示 |

**实现方案：**
- 在 `saveBlock` 时调用 `parseProperties(block.content)` 提取属性
- 解析规则：以 `key:: value` 开头（行首）的文本块
- 渲染位置：Block 内容下方，展开/折叠图标右侧

### 2.2 标签增强

| 功能 | 状态 | 说明 |
|------|------|------|
| 排除规则补齐 | ⚠️ 部分实现 | 需排除 URL 锚点（`https://...#section`）、邮箱 |
| 标签点击筛选 | 🔴 未实现 | 点击标签 → 筛选所有含该标签的 Block |

**实现方案：**
- 排除规则：在 `renderContent()` 中补充正则排除
- 标签筛选：新增 `TagFilter.vue` 组件，点击标签时显示筛选面板

### 2.3 外部链接

| 功能 | 状态 | 说明 |
|------|------|------|
| `[[https://...]]` 编辑态高亮 | 🔴 未实现 | Display 态已实现，编辑态需接入 tiptap 插件 |

### 2.4 UI 细节

| 功能 | 状态 | 说明 |
|------|------|------|
| Placeholder 文案对齐 | ⚠️ 部分 | 当前 "Type something..."，规范要求 "输入文字，或使用 [[链接]] 或 #标签..." |
| 窄屏响应式 | 🔴 未实现 | ≥1024px 适配、Sidebar 折叠 |
| 空状态 UI | 🔴 未实现 | Sidebar 无页面时的空状态提示 |

### 2.5 性能验证

| 功能 | 状态 | 说明 |
|------|------|------|
| 100+ Block 流畅度测试 | 🔴 未实现 | Phase 1 验收标准中明确要求 |

---

## 3. Phase 1.1 新增功能

### 3.1 命令面板（Command Palette）

**优先级：⭐⭐⭐⭐⭐（最高）**

#### 3.1.1 功能定义

| 功能 | 说明 |
|------|------|
| 触发快捷键 | `Ctrl+K`（Windows） / `Cmd+K`（macOS） |
| 搜索框 | 模糊匹配页面名、Block 内容、操作命令 |
| 页面快速跳转 | 输入页面名 → 跳转到对应 Page |
| 快速操作 | 输入命令名 → 执行操作（如 "折叠全部"、"新建页面"） |

#### 3.1.2 命令列表

| 命令 | 快捷键 | 说明 |
|------|--------|------|
| 跳转页面 | `Ctrl+G` | 快速跳转到指定 Page |
| 新建页面 | `Ctrl+N` | 创建新 Page |
| 折叠全部 | - | 折叠当前 Page 所有 Block |
| 展开全部 | - | 展开当前 Page 所有 Block |
| 删除当前 Block | `Ctrl+Backspace` | 删除 active Block |
| 当前日期 | `Ctrl+D` | 插入当天日期 `[[2026-04-22]]` |

#### 3.1.3 UI 规范

- **位置**：屏幕居中，宽度 500px，最大高度 60vh
- **背景**：毛玻璃效果（`backdrop-filter: blur(12px)`）
- **阴影**：多层投影营造悬浮感
- **输入框**：顶部，大字号，无边框
- **结果列表**：键盘 ↑↓ 导航，Enter 确认
- **显示逻辑**：
  - 空输入 → 显示最近操作 / 最近页面
  - 有输入 → 模糊匹配页面名 > Block 内容 > 命令

#### 3.1.4 实现方案

```
src/
├── components/
│   └── CommandPalette.vue    # 面板主组件
├── composables/
│   └── useCommandPalette.ts  # 状态管理 + 快捷键绑定
└── stores/
    └── commands.ts           # 命令定义 + 注册
```

**技术要点：**
- 使用 `Teleport` 挂载到 `body`
- 搜索算法：Fuse.js 模糊匹配
- 快捷键监听：Vue 全局事件或 `useEventListener`

---

### 3.2 Journal（日记流）

**优先级：⭐⭐⭐⭐（高）**

#### 3.2.1 功能定义

| 功能 | 说明 |
|------|------|
| 自动日记页面 | 每天自动创建以日期命名的 Page（如 `2026-04-22`） |
| 快速入口 | Sidebar 新增 "今日日记" 快捷按钮 |
| 模板注入 | 新建日记 Page 时自动插入当日日期 Block |

#### 3.2.2 UI 规范

- **Sidebar 入口**：`journal` 图标 + "今天" 文字
- **日期格式**：ISO 8601（`YYYY-MM-DD`）
- **模板内容**：
  ```
  [[2026-04-22]]
  
  ```
  第一行自动插入日期链接作为标题

#### 3.2.3 实现方案

```typescript
// composables/useJournal.ts
export function useJournal() {
  // 获取今天的日期字符串
  const today = computed(() => new Date().toISOString().slice(0, 10))
  
  // 打开或创建今日日记
  async function openTodayJournal() {
    const page = pageStore.getPageByTitle(today.value)
    if (page) {
      await pageStore.openPage(page.id)
    } else {
      const newPage = await pageStore.createPage(today.value)
      // 注入模板
      await blockStore.updateBlockContent(newPage.id, today.value)
      await pageStore.openPage(newPage.id)
    }
  }
}
```

---

### 3.3 标签筛选面板

**优先级：⭐⭐⭐（中）**

#### 3.3.1 功能定义

| 功能 | 说明 |
|------|------|
| 点击标签触发筛选 | Block 中 `#标签` 可点击 |
| 筛选面板 | 侧边弹窗，显示所有含该标签的 Block |
| 清除筛选 | 点击面板外部或关闭按钮清除 |

#### 3.3.2 UI 规范

- **位置**：右侧滑出面板，宽度 300px
- **标题**：`#标签名`（可点击跳转源 Block）
- **列表**：包含该标签的所有 Block（按 Page 分组）
- **操作**：点击任意项 → 跳转到对应 Page + 激活该 Block

---

## 4. 任务清单

### Sprint 1：Phase 1 遗留收尾

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P1.1 | 属性解析 `key:: value` → properties | 3h | P0 |
| P1.2 | 属性类型推断 | 2h | P0 |
| P1.3 | 属性 UI 渲染 | 2h | P0 |
| P1.4 | 标签排除规则补齐（URL 锚点、邮箱） | 1h | P1 |
| P1.5 | 外部链接编辑态高亮 | 1h | P1 |
| P1.6 | Placeholder 文案对齐 | 0.5h | P1 |
| P1.7 | 窄屏响应式 + Sidebar 折叠 | 3h | P2 |
| P1.8 | 空状态 UI | 1h | P2 |
| P1.9 | 100+ Block 性能测试 | 2h | P1 |

### Sprint 2：命令面板

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P2.1 | CommandPalette.vue 组件骨架 | 2h | P0 |
| P2.2 | 快捷键绑定（Ctrl+K） | 1h | P0 |
| P2.3 | 页面搜索（模糊匹配） | 3h | P0 |
| P2.4 | Block 内容搜索 | 2h | P1 |
| P2.5 | 命令注册 + 执行 | 3h | P0 |
| P2.6 | UI 细节（键盘导航、毛玻璃、动画） | 2h | P1 |

### Sprint 3：Journal

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P3.1 | useJournal composable | 1h | P0 |
| P3.2 | Sidebar 日记入口 | 1h | P0 |
| P3.3 | 自动模板注入 | 1h | P1 |

### Sprint 4：标签筛选

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P4.1 | 标签点击事件 | 1h | P1 |
| P4.2 | TagFilter 面板组件 | 3h | P1 |
| P4.3 | 筛选逻辑（跨 Page 聚合） | 2h | P1 |

---

## 5. 验收标准

### 5.1 Phase 1 遗留

| 功能 | 验收标准 |
|------|----------|
| 属性解析 | 输入 `状态:: 进行中` → 保存后 properties 存储 `{ "状态": "进行中" }` |
| 属性类型推断 | `true` / `false` 解析为 boolean，`2026-04-22` 解析为 date |
| 属性 UI | Block 下方显示属性行，折叠/展开可交互 |
| 标签排除 | URL `https://example.com#section` 中的 `#section` 不高亮 |
| 外部链接 | 编辑态 `[[https://...]]` 显示可点击样式 |
| Placeholder | 空 Block 显示 "输入文字，或使用 [[链接]] 或 #标签..." |
| 响应式 | 宽度 <1024px 时 Sidebar 折叠为图标 |
| 性能 | 100 Block 页面加载 <200ms，拖拽操作 <16ms |

### 5.2 命令面板

| 功能 | 验收标准 |
|------|----------|
| 触发 | Ctrl+K 打开面板，ESC 关闭 |
| 搜索 | 输入 "数据" 能匹配到 "数据模型设计" 页面 |
| 跳转 | 选择页面后跳转到对应 Page，第一个 Block 自动激活 |
| 折叠全部 | 执行后所有 Block 折叠，视觉反馈清晰 |

### 5.3 Journal

| 功能 | 验收标准 |
|------|----------|
| 入口 | Sidebar 显示 "今天" 入口，点击可跳转 |
| 自动创建 | 首次访问当日日记时自动创建 Page |
| 模板 | 新建日记自动插入 `[[YYYY-MM-DD]]` 标题 |

### 5.4 标签筛选

| 功能 | 验收标准 |
|------|----------|
| 点击筛选 | 点击 Block 中 `#标签` 打开筛选面板 |
| 显示正确 | 面板列出所有含该标签的 Block（按 Page 分组） |
| 跳转 | 点击面板中任意项跳转到源 Block |

---

## 6. 技术约束

| 约束 | 说明 |
|------|------|
| 搜索性能 | Block 内容搜索需防抖，1000+ Block 时限制结果数量 |
| 面板层级 | CommandPalette 使用 `Teleport`，z-index > 1000 |
| 状态隔离 | 筛选状态独立于主编辑区，不影响 activeBlockId |
| 移动端 | Phase 1.1 不考虑移动端适配 |

---

## 7. 不纳入 Phase 1.1 的功能

| 功能 | 原因 |
|------|------|
| 富文本（加粗、斜体） | Phase 2 考虑 |
| Graph 可视化 | 远期规划 |
| 全文搜索 | Phase 2 引入 |
| 多设备同步 | 远期规划 |
| 图片/附件 | Phase 2 考虑 |

---

*文档 v0.1，规划中，持续更新。*