# Phase 1.1 规划

> 版本：v0.2
> 日期：2026-04-22
> 状态：**进行中**

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
| `key:: value` 解析 | ⚪ 已回滚 | 已实现后用户决定放弃，代码已回滚 |
| 属性类型推断 | ⚪ 已回滚 | 已实现后用户决定放弃，代码已回滚 |
| 属性 UI 渲染 | ⚪ 已回滚 | 已实现后用户决定放弃，代码已回滚 |

**决策记录：**
- 2026-04-22：属性系统完整实现（propertyParser.ts、PropertyMap、BlockProperties.vue）
- 识别出 7 个交互问题后，用户决定放弃属性系统，回滚所有改动
- 属性 key 正则修复（支持中文 key）已保留在 parser.ts 中（`[\p{L}_][\p{L}\p{N}_]*`）

### 2.2 标签增强 ✅ 已完成

| 功能 | 状态 | 说明 |
|------|------|------|
| 排除规则补齐 | ✅ 已完成 | URL 锚点、邮箱、协议锚点全部排除 |
| 标签点击筛选 | ✅ 已完成 | 点击标签 → 筛选所有含该标签的 Block |
| 跨页搜索 | ✅ 已完成 | 从 IndexedDB 获取全量 Block 进行筛选 |
| 缓存失效 | ✅ 已完成 | Block 增删改时自动清除筛选缓存 |

**实现文件：**
- `src/composables/useTagFilter.ts`：筛选状态管理 + 跨页搜索 + 缓存失效
- `src/components/TagFilterPanel.vue`：筛选结果面板（按 Page 分组）
- `src/components/Block.vue`：标签点击事件 + mousedown 忽略防误触
- `src/stores/blocks.ts`：createBlock/deleteBlock/updateBlockContent 后调用 invalidateTagCache

**修复的 Bug：**
1. **竞态条件（P0）**：首次点击标签结果为空 → `activeTag` 在 `await` 后设置
2. **缓存过期（P1）**：新建/编辑块后搜索结果不更新 → 导出 `invalidateTagCache`
3. **大小写匹配**：正则匹配原始大小写 → parser.ts 与 useTagFilter 统一 toLowerCase()
4. **URL 锚点排除失效（P0）**：单字符 lookbehind 无法匹配 `://` → 新增 `isTagInUrlContext()` 代码层过滤
5. **属性 key 正则不匹配中文（P0）**：`gm` → `gmu`，补 `u` flag
6. **[[张三]] 被误判为 list（P0）**：page reference 检查移到 list 之前

**测试覆盖：**
- `parser.test.ts`：26 个测试用例，100% 通过

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

### 2.5 性能验证 ✅ 已测试

| 功能 | 状态 | 说明 |
|------|------|------|
| 100+ Block 流畅度测试 | ✅ 已测试 | 150 Block 测试完成，部分指标需优化 |

**测试环境：**
- 测试时间：2026-04-22 23:58
- Block 数量：150（100 顶级 + 50 嵌套）
- 测试工具：Playwright E2E

**测试结果：**

| 指标 | 结果 | 目标 | 状态 |
|------|------|------|------|
| 页面加载时间 | 541ms | <500ms | ⚠️ 略超 |
| 滚动响应时间 | 119ms | <50ms | ⚠️ 需优化 |
| Enter 操作延迟 | 65ms | <16ms | ⚠️ 需优化 |
| Backspace 操作延迟 | 62ms | <16ms | ⚠️ 需优化 |
| Block 数量正确性 | ✅ | - | ✅ 通过 |

**结论：**
- 功能正确性达标
- 性能基线建立（150 Block）
- 后续可优化点：滚动虚拟化、编辑器实例复用、渲染 memo 化

---

## 3. Phase 1.1 新增功能

### 3.1 斜杠命令面板（Slash Commands）

**优先级：⭐⭐⭐⭐⭐（最高）**

#### 3.1.1 功能定义

| 功能 | 说明 |
|------|------|
| 触发方式 | Block 内输入 `/` 字符 |
| 命令面板 | 弹出命令列表，模糊匹配命令名 |
| 插入型命令 | 执行后插入内容到当前光标位置 |
| 操作型命令 | 执行后对当前 Block/Page 生效 |
| 导航型命令 | 执行后跳转到目标位置 |

#### 3.1.2 命令列表

| 命令 | 类型 | 说明 |
|------|------|------|
| `/date` | 插入 | 插入当前日期 `[[2026-04-23]]` |
| `/time` | 插入 | 插入当前时间 `00:09` |
| `/page` | 导航 | 跳转到指定 Page |
| `/new` | 操作 | 创建新 Page 并跳转 |
| `/collapse` | 操作 | 折叠当前 Page 所有 Block |
| `/expand` | 操作 | 展开当前 Page 所有 Block |
| `/delete` | 操作 | 删除当前 Block |
| `/todo` | 插入 | 插入 `DONE` / `TODO` 状态 |
| `/link` | 插入 | 插入 `[[页面名]]` 链接模板 |

#### 3.1.3 UI 规范

- **触发位置**：当前 Block 光标处
- **面板位置**：Block 下方弹出，与 Block 左对齐
- **尺寸**：宽度 280px，最大高度 320px（约 8 条）
- **样式**：圆角 8px，阴影 `0 4px 16px rgba(0,0,0,0.15)`，背景白色
- **命令项**：图标 + 命令名 + 快捷键提示（如有）
- **交互**：
  - ↑↓ 键盘导航
  - Enter 执行
  - ESC 关闭面板
  - 点击外部关闭
  - 继续输入过滤命令

#### 3.1.4 实现方案

```
src/
├── components/
│   └── SlashCommandMenu.vue    # 命令菜单组件
├── composables/
│   └── useSlashCommand.ts      # 触发检测 + 命令执行
├── stores/
│   └── commands.ts             # 命令定义 + 注册
└── extensions/
    └── slashCommandExtension.ts # tiptap extension（可选）
```

**技术要点：**

1. **触发检测**：监听 Block 编辑器的 `input` 事件，检测 `/` 字符
   - 方案 A：Vue 层监听 `@input`
   - 方案 B：tiptap Extension（更精确的光标位置）

2. **命令匹配**：
   - 命令列表预定义在 `commands.ts`
   - 输入 `/da` → 模糊匹配 `/date`
   - 使用简单 `includes()` 或 Fuse.js

3. **执行逻辑**：
   - 插入型：替换 `/命令名` 为目标内容
   - 操作型：调用 blockStore/pageStore 方法
   - 导航型：调用 `pageStore.openPage()`

4. **光标处理**：
   - 执行后光标留在插入内容后
   - 或关闭面板后恢复编辑

**与原 Command Palette 对比：**

| 特性 | Command Palette（Ctrl+K） | Slash Commands（/） |
|------|---------------------------|---------------------|
| 触发方式 | 快捷键 | Block 内输入 |
| 上下文 | 全局 | 当前 Block |
| 学习成本 | 需记忆快捷键 | 自然发现 |
| 适用场景 | 页面跳转、全局操作 | 插入内容、Block 操作 |
| 实现复杂度 | 中 | 高（需编辑器集成） |

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

### Sprint 2：斜杠命令面板

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P2.1 | SlashCommandMenu.vue 组件骨架 | 2h | P0 |
| P2.2 | `/` 触发检测 + 面板定位 | 2h | P0 |
| P2.3 | 命令匹配逻辑（模糊搜索） | 2h | P0 |
| P2.4 | 命令注册 + 执行框架 | 3h | P0 |
| P2.5 | 核心命令实现（date/page/new） | 3h | P0 |
| P2.6 | 键盘导航 + ESC 关闭 | 2h | P1 |
| P2.7 | 光标处理 + 内容替换 | 2h | P1 |
| P2.8 | UI 细节（动画、样式） | 1h | P2 |

### Sprint 3：Journal

| 序号 | 任务 | 预估 | 优先级 |
|------|------|------|--------|
| P3.1 | useJournal composable | 1h | P0 |
| P3.2 | Sidebar 日记入口 | 1h | P0 |
| P3.3 | 自动模板注入 | 1h | P1 |

### Sprint 4：标签筛选 ✅ 已完成

| 序号 | 任务 | 预估 | 优先级 | 状态 |
|------|------|------|--------|------|
| P4.1 | 标签点击事件 | 1h | P1 | ✅ |
| P4.2 | TagFilter 面板组件 | 3h | P1 | ✅ |
| P4.3 | 筛选逻辑（跨 Page 聚合） | 2h | P1 | ✅ |
| P4.4 | 竞态修复 + 缓存失效 | 1h | P0 | ✅ |
| P4.5 | URL/邮箱排除修复 | 2h | P0 | ✅ |
| P4.6 | 单元测试覆盖 | 2h | P0 | ✅ |

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

### 5.2 斜杠命令面板

| 功能 | 验收标准 |
|------|----------|
| 触发 | Block 内输入 `/` 弹出命令面板，光标在 `/` 后 |
| 过滤 | 输入 `/da` 过滤显示 `/date` 命令 |
| 执行 date | 选择 `/date` 替换为 `[[2026-04-23]]`，光标在链接后 |
| 执行 page | 选择 `/page` 弹出页面搜索，选择后跳转 |
| 执行 new | 选择 `/new` 创建新 Page 并跳转 |
| 键盘导航 | ↑↓ 选择命令，Enter 执行，ESC 关闭面板 |
| 关闭 | 点击面板外部或 ESC 关闭，恢复编辑 |

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