# 通用 Block 模板系统设计

> 版本：v1.0
> 日期：2026-06-05
> 状态：Draft（待审阅）
> 关联：产品愿景 §6.1 思维模型库 · 现有 Block 编辑器架构规范

---

## 背景

产品愿景 §6.1 提到思维模型库需"模板生成"能力（用 `{{user_input}}` 占位符为模型生成结构化 Block），但未扩展到通用 Block 模板系统。

需求：将模板能力**通用化**——
- 思维模型 + 主流工作模板统一走同一套机制
- 内置预设 + 用户可"另存为模板"
- 斜杠命令 `/template` 触发，零摩擦插入

业务价值：
- 重复结构（会议记录、复盘、决策记录）从"手写 5 分钟"压缩到"1 次命令"
- 思维模型从"知道"变成"立刻用"
- 用户的成熟工作流可沉淀为模板

## 范围

**做：**
- 内置 10 个模板（5 思维模型 + 5 工作模板）
- 斜杠命令 `/template` + `/template list`
- 占位符 `{{name}}`（可见文本）+ 预定义变量（date/time/iso_date/page_title/cursor/clipboard）
- 插入位置：当前 Block 后插入为后续兄弟
- Page 菜单"另存为模板"入口
- 独立 IndexedDB 表存储用户模板

**不做（明确边界）：**
- 模板嵌套/继承
- 模板变量作用域/条件分支
- 模板与 AI 联动（如根据上下文自动选模板）
- 模板共享/导出/导入
- 模板编辑 UI（仅支持"另存"，不允许在 App 内编辑已存模板内容）

---

## 方案选择

### 存储模型：独立 `templates` 表（推荐）

**理由**：
- 与 Page 完全隔离，不污染 Page 命名空间、搜索、关系、侧边栏
- 模板内容是序列化 Block 树 JSON，存储紧凑
- 模板生命周期与 Page 解耦（Page 删除不影响模板）

**不选 Page-as-Template（`type='template'`）的理由**：
- 模板污染 Page 命名空间，需特殊防护（防误编辑、误搜、误删）
- 模板编辑与 Page 编辑语义不同，需在 Page 渲染层加分支判断
- 未来若需批量管理模板，Page 路径过深

**不选 Page 菜单内联的理由**：
- 用户在 Page 树看到"模板"节点会增加认知负担
- 模板不是 Page，不应参与 WikiLink/Backlinks

### 占位符机制：纯文本保留（不弹窗）

**理由**：
- 弹窗是**高摩擦**路径，违背产品哲学（"3 秒内开始记录"）
- 模板使用场景多为"快速填骨架"，用户后续在 Block 中手动细化
- 文本保留 `{{name}}` 让用户**看见**需要填写的位置，比"插入后忘记"更可控

**未来增强**（不在本期）：
- `/template fill` 批量填写所有 `{{name}}` 占位符
- 插入时高亮 `{{name}}` + Tab 跳转（IntelliJ 模板风格）

### 触发方式：仅斜杠命令 `/template`

**理由**：
- 复用现有 `SlashCommandExtension` 与 `SlashCommandMenu`
- 键盘党友好，符合 comind"快速捕捉"哲学
- 不引入新 UI 入口（侧边栏/右键菜单会增加界面复杂度）

**"我的模板库"通过 `/template list` 触发**而非独立侧边栏：
- 模板管理是低频操作（每天 0-2 次）
- 复用现有菜单避免 UI 膨胀

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  UI 层                                          │
│  • SlashCommandMenu 显示模板列表（复用现有）       │
│  • Page 菜单 "另存为模板" 入口                     │
│  • 我的模板库视图（/template list 子菜单）         │
├─────────────────────────────────────────────────┤
│  引擎层                                          │
│  • TemplateRegistry: 合并内置 + 用户模板，统一查询  │
│  • TemplateRenderer: 展开变量 + 生成 Block 草稿     │
│  • PredefinedVars: 预定义变量求值器                │
│  • serializeBlockTree / deserializeBlockTree      │
├─────────────────────────────────────────────────┤
│  存储层                                          │
│  • builtin-templates.ts: 静态 JSON（代码内置）     │
│  • templates 表（IndexedDB/Dexie）: 用户另存       │
└─────────────────────────────────────────────────┘
```

**调用链**：
`/template` → SlashCommandMenu 触发 → TemplateRegistry 列出 → 用户选择 → TemplateRenderer.render(template, context, anchorBlock) → blocksStore.insertBlocksAfter(blockId, drafts) → editorStore.focusBlock(firstNewBlockId, cursorMarker)

**关键设计原则**：
- 模板不破坏现有 Block 树/Page/链接系统
- 内置与用户模板统一抽象（`BuiltinTemplate | UserTemplate → NormalizedTemplate`）
- 渲染过程纯函数化（输入：模板+上下文；输出：BlockDraft[]），便于测试

---

## 数据模型

### 类型定义（`src/types/template.ts`）

```typescript
// 模板块（树形结构，与 Block 解耦）
// 注：TemplateBlock 的 type 集合是 Block.type 的子集 + 特殊语义标记
//   - 'bullet'   → 普通 Block（type='bullet'），content 即为可见文本
//   - 'heading'  → 标题 Block（type='bullet'，format.type='heading'）
//   - 'property' → 属性 Block（type='property'，content 序列化为 `key:: value`）
export interface TemplateBlock {
  type: 'bullet' | 'heading' | 'property'
  content: string                  // 可包含 {{name}} 或 {{date}}
  headingLevel?: 1 | 2 | 3         // type=heading 时必填（写入 format.level）
  propertyKey?: string             // type=property 时必填（属性行 key 部分）
  children?: TemplateBlock[]       // 子块
}

// 内置模板（静态 JSON，无存储）
export interface BuiltinTemplate {
  id: string                       // 稳定 ID，如 'meeting-notes'
  name: string                     // 显示名，如 '会议记录'
  aliases?: string[]               // 搜索别名 ['meeting', '会议']
  category: 'thinking-model' | 'work' | 'journal' | 'review'
  description: string              // 一句话说明
  icon: string                     // emoji 或图标名
  blocks: TemplateBlock[]          // 模板内容
}

// 用户模板（IndexedDB 存储）
export interface UserTemplate {
  id: string                       // UUID
  name: string
  description?: string
  category: string                 // 自由分类（默认 'custom'）
  sourcePageId: string             // 来源页 ID（可追溯）
  blocks: TemplateBlock[]          // 序列化 Block 树
  createdAt: number
  updatedAt: number
}

// 归一化模板（运行时统一抽象）
export interface NormalizedTemplate {
  id: string
  name: string
  aliases?: string[]
  category: string
  description: string
  icon: string
  source: 'builtin' | 'user'
  blocks: TemplateBlock[]
}

// 预定义变量上下文
export interface TemplateContext {
  date: string                     // 2026年6月5日（本地化）
  time: string                     // 14:30
  isoDate: string                  // 2026-06-05
  pageTitle: string                // 当前页面标题
  cursor: '__CURSOR__'             // 特殊标记
  clipboard: string                // 剪贴板内容
  now: number                      // 时间戳
}

// Block 草稿（渲染产物，待入库）
export interface BlockDraft {
  pageId: string
  parentId: string | null
  pos: number                      // 基于 anchor 重新计算
  content: string                  // 已展开变量替换
  format: {                        // 严格的 format 结构
    type?: 'heading'
    level?: 1 | 2 | 3
  }
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
  properties: Record<string, any>
  cursorMarker?: '__CURSOR__' | null  // 来自 {{cursor}} 替换，渲染后定位用
}
```

**关键决策**：
- `TemplateBlock` 是**独立类型**，不直接复用 `Block`——因为模板需要序列化、延迟求值（变量替换）、且不携带 ID/timestamps/pos
- 渲染时 `TemplateRenderer` 才把 `TemplateBlock[]` 转换为 `BlockDraft[]`（分配 ID、计算 pos、写入 DB）
- `NormalizedTemplate` 让内置和用户模板走同一条渲染路径

### Dexie 表扩展（`src/storage/db.ts`）

```typescript
// 追加版本号到 4
db.version(4).stores({
  // ... 已有表保持不变
  templates: 'id, category, updatedAt, name',  // 索引
})
```

### 序列化行为契约（`serialize-block-tree`）

`serializeBlockTree(blocks, rootBlockId)` 必须显式处理以下 Block 字段：

| Block 字段 | 序列化策略 | 理由 |
|---|---|---|
| `id` | **丢弃** | 由 TemplateRenderer 重新生成 |
| `pageId` | **丢弃** | 渲染时基于 anchor 重新计算 |
| `parentId` | **丢弃** | 同上 |
| `pos` | **丢弃** | 同上 |
| `content` | **保留** | 直接写入 TemplateBlock.content |
| `type` | **保留 + 映射** | `property` → TemplateBlock.type='property'；`bullet` → TemplateBlock.type='bullet'；`query`/`embed`/`code`/`image` → 警告 + 退化为 `bullet`（模板不支持） |
| `format` | **部分保留** | `format.type='heading'` + `format.level` → TemplateBlock.type='heading' + headingLevel；其他 format 字段丢弃 |
| `properties` | **丢弃** | 模板不携带属性元数据 |
| `createdAt` / `updatedAt` | **丢弃** | 由新 Block 重新生成 |

**未支持的 Block 类型警告**：
- `query` / `embed` / `code` / `image` 在源 Page 出现时，序列化时**降级为 bullet** 并 `console.warn` 提示用户
- 后续若需支持，可在 TemplateBlock 增加对应 type（本期不做）

**Property Block 反序列化**：
- TemplateBlock `{ type: 'property', propertyKey: '时间', content: '{{date}}' }`
- 渲染为 BlockDraft `{ type: 'property', content: '时间:: {{date}}' }`
- 由 Block 渲染层基于 `key:: value` 格式自动解析（与现有机制一致）

---

## 内置模板清单

### 🎯 思维模型类（5 个）

| ID | 名称 | 分类 | 说明 |
|---|---|---|---|
| `second-order-thinking` | 二阶思维 | thinking-model | 引导追问"然后呢？" |
| `five-whys` | 5WHY 分析 | thinking-model | 连问 5 个为什么找根因 |
| `mece` | MECE 拆解 | thinking-model | 相互独立、完全穷尽地拆解问题 |
| `first-principles` | 第一性原理 | thinking-model | 剥离假设，回到基本事实 |
| `premortem` | 预先验尸 | thinking-model | 假设项目已失败，反推原因 |

### 💼 工作类（5 个）

| ID | 名称 | 分类 | 说明 |
|---|---|---|---|
| `meeting-notes` | 会议记录 | work | 时间/参与人/议题/决议/待办 |
| `weekly-review` | 每周复盘 | review | 5 个引导问题（对齐产品愿景 §2.2） |
| `daily-journal` | 今日记录 | journal | 心情/进展/卡点/明日计划 |
| `decision-record` | 决策记录 | work | 背景/选项/权衡/决定/复盘 |
| `reading-notes` | 阅读笔记 | work | 元信息/核心观点/我的启发/行动项 |

### 示例：会议记录模板结构

```typescript
{
  id: 'meeting-notes',
  name: '会议记录',
  aliases: ['meeting', '会议'],
  category: 'work',
  description: '结构化记录会议：时间/参与人/议题/决议/待办',
  icon: '📝',
  blocks: [
    { type: 'heading', headingLevel: 2, content: '会议: {{cursor}}' },
    { type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' },
    { type: 'property', propertyKey: '参与人', content: '' },
    { type: 'heading', headingLevel: 3, content: '议题' },
    { type: 'bullet', content: '' },
    { type: 'bullet', content: '' },
    { type: 'heading', headingLevel: 3, content: '决议' },
    { type: 'bullet', content: '' },
    { type: 'heading', headingLevel: 3, content: '待办' },
    { type: 'bullet', content: '' },
    { type: 'bullet', content: '' },
  ]
}
```

### 预定义变量清单

| 语法 | 含义 | 替换时机 | 示例输出 |
|---|---|---|---|
| `{{date}}` | 本地化日期 | 插入时 | `2026年6月5日` |
| `{{time}}` | 本地化时间 | 插入时 | `14:30` |
| `{{iso_date}}` | ISO 日期 | 插入时 | `2026-06-05` |
| `{{page_title}}` | 当前页面标题 | 插入时 | `产品愿景` |
| `{{cursor}}` | 光标落点标记 | 插入后定位 | `__CURSOR__`（隐藏） |
| `{{clipboard}}` | 剪贴板内容 | 插入时（异步） | 用户复制的内容 |
| `{{name}}` | 自定义占位符 | **保留为可见文本** | `{{name}}` 留在 Block 中 |

**关键决策**：
- `{{name}}` 形式的自定义占位符**不弹窗**（避免高摩擦），保留为可见文本，用户后续手动改写
- `{{cursor}}` 是约定变量，控制插入后光标位置（用于"标题填这里"场景）
- 未匹配任何预定义变量的 `{{xxx}}` 一律保留为可见文本（不报错）

---

## 触发与执行流程

### 与现有 SlashCommand 系统的集成策略

**复用现有 `Command` 注册机制**：
- 在 `useSlashCommands().commands` 列表中追加 Template 命令条目
- 每条命令的 `id` 形如 `template:meeting-notes`、`template:user:abc123`
- `name` 用模板显示名（如"会议记录"）
- `alias` 用模板别名 + 共享前缀 `['template', 'tpl', ...]`
- `group` 设为 `'template'`
- `icon` 用模板图标
- `action` 内部调用 `TemplateRenderer.execute(props.blockId, templateId)`

**与现有 `/template` 行为**：
- 用户输入 `/template` → 菜单过滤出 `group === 'template'` 的全部命令
- 用户输入 `/meeting` → 匹配 alias 含 `meeting` 的模板命令
- 用户输入 `/tpl` → 匹配共享前缀
- 与现有 `/h1`/`/todo` 等命令共存于同一菜单，通过 `group` 区分

**特殊命令：`/template list`**
- 不通过 Command 注册（Command 模型不天然支持子视图切换）
- 在 `useSlashCommands` 内部对 `query === 'template list'` 做特判
- 触发后切换 SlashCommandMenu 至"我的模板"子视图（详见 §模板管理 UI）

### 触发链路

```
用户输入 /template（或 /tpl / 模板别名）
    ↓
SlashCommandExtension 识别 → 打开 SlashCommandMenu
    ↓
菜单过滤出 group=template 的命令
    ↓
用户选中 → Enter
    ↓
SlashCommandMenu.executeCommand → Command.action
    ↓
TemplateRenderer.execute(blockId, templateId)
    ↓
TemplateRenderer.render(template, context, anchorBlock) → BlockDraft[]
    ↓
blocksStore.insertBlocksAfter(blockId, drafts)
    ↓
editorStore.focusBlock(firstNewBlockId, cursorMarker)
```

### 渲染管线

```typescript
// src/services/template-renderer.ts
export class TemplateRenderer {
  /**
   * 渲染模板为可插入的 Block 草稿
   * 纯函数，无副作用，便于测试
   */
  static render(
    template: NormalizedTemplate,
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[] {
    // 1. 递归展开 TemplateBlock 树
    // 2. 对每个 content 执行变量替换：{{date}} → 实际值
    // 3. 对每个 {{name}}（未匹配预定义变量）→ 保留为占位符文本
    // 4. 计算 pos：基于 anchorBlock.pos + (i+1) * 1000（gap 排序）
    // 5. 分配新 ID（生成 UUID）
    // 6. 返回 BlockDraft[]（不写库）
  }

  /**
   * 替换变量 + 占位符
   * {{date}} → context.date
   * {{name}} → 保留 '__PLACEHOLDER_name__'（带样式标记）
   * {{cursor}} → 保留 '__CURSOR__'（特殊标记）
   */
  static expandContent(
    content: string,
    context: TemplateContext
  ): { text: string; placeholders: PlaceholderMarker[] } {
    // ...
  }
}
```

### 插入实现

```typescript
// src/services/template-renderer.ts（接上面）
static insertAfter(
  anchorBlockId: string,
  drafts: BlockDraft[]
): string[] {
  // 1. 从 anchorBlock 读取 pageId, parentId, pos
  // 2. 倒序调用 blocksStore.insertBlockAt（保证 pos 递增）
  //    pos = anchor.pos + (i+1) * 1000
  // 3. 处理父子关系：父块的 children 数组更新
  // 4. 返回新创建 Block ID 列表（按文档顺序）
  // 5. 调用 editorStore 聚焦到第一个新 Block
  //    若第一个新 Block 含 {{cursor}} 标记，则定位到该标记
}
```

---

## 模板管理 UI

### "另存为模板" 入口

**位置**：Page 顶部菜单（`/page/:id` 路由的 PageHeader）新增按钮

**交互流程**：
```
点击 "另存为模板"
    ↓
弹出 Modal（复用现有 Modal 组件）
    ↓
表单字段：
  - 名称（必填，默认 = Page 标题）
  - 描述（可选）
  - 分类（可选，默认 'custom'）
  - 预览（只读，渲染当前 Page 的 Block 树）
    ↓
提交
    ↓
serializeBlocks(pageId) → TemplateBlock[]
    ↓
userTemplatesStore.create({ ... })
    ↓
Toast: "已保存为模板"
```

```typescript
// src/stores/user-templates.ts
export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates = ref<UserTemplate[]>([])

  async function loadAll() {
    templates.value = await db.templates.toArray()
  }

  async function createFromPage(pageId: string, meta: { name: string; description?: string; category?: string }) {
    const page = usePagesStore().getPage(pageId)
    const blocks = await useBlocksStore().loadBlocksForPage(pageId)
    const templateBlocks = serializeBlockTree(blocks, page.blockId)
    const record: UserTemplate = {
      id: generateId(),
      name: meta.name,
      description: meta.description,
      category: meta.category ?? 'custom',
      sourcePageId: pageId,
      blocks: templateBlocks,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await db.templates.put(record)
    await loadAll()
    return record
  }

  async function remove(id: string) { /* ... */ }
  async function rename(id: string, name: string) { /* ... */ }

  return { templates, loadAll, createFromPage, remove, rename }
})
```

### "我的模板库" 视图

**位置**：在 SlashCommandMenu 中通过 `/template list` 触发（不新增独立 UI 入口）

**交互流程**：
```
输入 /template list
    ↓
SlashCommandMenu 切换为 "我的模板" 子视图
    ↓
显示列表：分类分组，每行 = [icon] name | description | [×删除]
    ↓
点击行 → 等同于选中该模板并执行（重新触发 /template 流程）
点击 [×] → 弹出确认 Modal（复用 ConfirmDialog）→ 确认后删除
```

**删除二次确认细节**：
- 复用 `src/components/ConfirmDialog.vue`（已存在）
- 文案："确定删除模板「{name}」？此操作不可撤销。"
- 确认按钮 = "删除"（红色危险操作样式）
- 取消按钮 = "取消"

**为什么不独立侧边栏**：
- 模板管理是低频操作（创建/删除每天 0-2 次）
- 复用现有 SlashCommandMenu 避免 UI 膨胀
- 后续若高频使用，可升级为独立面板

### 模板命名冲突

- 用户模板与内置模板 **ID 空间隔离**（前缀 `user:` vs `builtin:`）
- 显示重名时：**用户模板优先**（最新创建的覆盖感更强）
- SlashCommandMenu 分组显示："我的模板" 在前，"内置模板" 在后
- 用户模板允许重名（ID 不同），按创建时间排序，UI 上加后缀 `(2)` 区分

---

## 边界与错误处理

| 场景 | 处理策略 |
|---|---|
| 模板不存在（输入 `/template foo` 无匹配） | SlashCommandMenu 显示"无匹配模板"，不执行任何操作 |
| 用户模板源 Page 被删除 | `sourcePageId` 保留为历史记录，模板仍可使用（blocks 已序列化） |
| 用户模板名称重复 | 允许重名（ID 不同），按创建时间排序，UI 上加后缀 `(2)` |
| 用户删除最后一个模板 | 允许，菜单回到只剩内置模板的状态 |
| 当前 Block 在折叠状态 | 正常插入为兄弟，**不自动展开**父级（避免意外展开） |
| 当前 Block 是页面根 | 允许插入，根 Block 下追加新兄弟 |
| `{{cursor}}` 出现在多个位置 | 仅第一个生效，忽略后续（避免定位歧义） |
| `{{clipboard}}` 读取失败（权限/空） | 替换为空字符串，**不报错**（保持插入流程不中断） |
| 模板内容超过 100 个 Block | 不限制（与现有 1000 Block 单页性能一致） |
| `{{name}}` 拼写错误（如 `{{naem}}`） | 保留为可见文本，由用户后续修正 |
| 同时启用 8+ 个变量 | 性能可控（纯字符串替换，<1ms） |
| 用户在不可编辑页面（system）调用模板 | 隐藏 `/template` 斜杠命令选项 |

**关键设计原则**：
- 模板执行是**尽力而为**：任何变量解析失败都不应阻塞插入
- 错误不向用户暴露技术细节（无 console.error 上抛）
- 模板操作是**幂等**的：同一模板连续调用 5 次，产出 5 份独立副本

---

## 实施步骤（高层）

> 本节为概要，详细计划由后续 `writing-plans` 阶段产出。

1. **基础设施**：新增 `src/types/template.ts` + Dexie v4 升级
2. **静态配置**：实现 `src/config/builtin-templates.ts`（10 个模板）
3. **序列化/反序列化**：`src/services/serialize-block-tree.ts`
4. **模板引擎**：`src/services/template-renderer.ts`（纯函数）
5. **模板注册表**：`src/composables/useTemplateRegistry.ts`（合并内置+用户）
6. **斜杠命令集成**：扩展 `SlashCommandExtension` + `SlashCommandMenu`
7. **用户模板 Store**：`src/stores/user-templates.ts`
8. **"另存为模板" Modal**：`src/components/Template/SaveAsTemplateModal.vue`
9. **Page 菜单入口**：扩展 `PageMenuButton.vue`
10. **测试**：单元 + 集成 + E2E 三层覆盖

---

## 测试策略

### 单元测试（Vitest）

| 文件 | 覆盖 | 关键测试点 |
|---|---|---|
| `template-renderer.test.ts` | TemplateRenderer.render / expandContent | 变量替换、占位符保留、树形结构、pos 计算 |
| `user-templates.test.ts` | userTemplatesStore CRUD | 创建/重命名/删除/序列化往返 |
| `template-registry.test.ts` | TemplateRegistry 合并/查询 | 内置+用户合并、重名时优先级、空查询 |
| `serialize-block-tree.test.ts` | Block 树 ↔ TemplateBlock[] 转换 | 属性保留、嵌套层级、特殊 Block 类型 |
| `builtin-templates.test.ts` | 静态配置完整性 | 所有 10 个模板 ID 唯一、blocks 非空、icon 非空 |

### 集成测试

| 文件 | 覆盖 | 关键测试点 |
|---|---|---|
| `slash-template-command.test.ts` | `/template` 触发链路 | 菜单显示模板列表、过滤、选中、触发插入 |
| `save-as-template.test.ts` | Page 菜单"另存为模板"流程 | 模态框、序列化、写入 db、Toast |
| `template-list-command.test.ts` | `/template list` | 显示我的模板、删除二次确认、删除后菜单刷新 |

### E2E 测试（Playwright）

| 文件 | 场景 |
|---|---|
| `template-e2e.spec.ts` | 完整闭环：打开 Page → 输入 `/template meeting` → 选中 → 验证新 Block 树结构与变量已替换 |
| `template-save-reuse.spec.ts` | 打开 A Page → 另存为模板 → 在 B Page 调用 → 验证 Block 树一致 |
| `template-placeholder.spec.ts` | 插入含 `{{name}}` 的模板 → 验证占位符以可见文本保留 |

### 验收清单

- [ ] `/template` 触发后菜单在 100ms 内显示模板列表
- [ ] 10 个内置模板全部可在 2 次输入内被检索到
- [ ] 用户模板在创建后立即出现在 `/template list` 中
- [ ] 模板插入 10 个 Block 在 200ms 内完成
- [ ] `{{date}}` 替换为调用时刻的本地化日期
- [ ] `{{cursor}}` 落点准确（±1 字符）
- [ ] 重启 App 后用户模板仍可使用
- [ ] 删除用户模板后菜单立即更新
- [ ] Lint + TypeScript + Vitest + Playwright 全绿

---

## 风险与权衡

| 风险 | 缓解 |
|---|---|
| 用户另存模板后，源 Page Block 变化时模板不变（已序列化） | 设计预期：模板是"快照"而非"引用"，保持稳定 |
| 10 个内置模板不够用 | 用户可另存自己的；后续可加"模板市场"（不做） |
| 序列化忽略某些 Block 字段 | 在 `serialize-block-tree` 中显式列出允许字段，抛错而非静默 |
| 模板插入性能问题（> 50 Block） | 按需 lazy expand；首期不实现 |
| Page 菜单"另存为模板"按钮位置冲突 | 沿用现有菜单分组，复用 PageItemMenu 模式 |

---

## 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-06-05 | 初始版本 |
