# Embed Block 设计文档

日期: 2026-05-22

## 1. 概述

新增 `embed` 类型 Block 的 handler 实现。embed block 引用其他页面的某个具体 block，实现双向同步编辑——在当前位置编辑嵌入内容时，源 block 同步更新。

**注意**：`Block.type` 联合类型中 `'embed'` 已存在，无需修改类型定义。

## 2. 数据模型

### 2.1 结构
```
EmbedBlock {
  type: 'embed'
  content: ''            // 不使用，源 block.content 是唯一数据源
  properties: {
    sourceBlockId: string   // 源 block 的 ID
    sourcePageId: string    // 源 block 所在页面 ID
  }
}
```

### 2.2 同步策略
embed block 不存储内容副本。编辑时直接操作源 block 的 `content`，Vue 响应式系统保证同步。

**同页嵌入**：两个位置（源 block 位 + embed block 位）编辑同一个 `block.content` 引用，天然同步。两边同时打开编辑时，最后写入者胜出。

**跨页嵌入**：编辑时通过 `blockStore.updateBlockContent(sourceBlockId, content)` 直接更新源 block，embed block 通过 watch sourceBlock.content 自动更新渲染。

## 3. 组件设计

### 3.1 EmbedRender.vue（渲染模式）
**路径**: `src/components/Block/handlers/embed/EmbedRender.vue`

**功能**：
1. 从 `properties.sourceBlockId` 获取源 block
2. 源页面名从源 block 动态读取 `block.pageId → page.title`，不依赖 `properties.sourcePageId`（防源 block 被移走不匹配）
3. 使用 `useBlockRegistry().getHandler(sourceBlock.type)` 获取源 block 的 renderComponent
4. 渲染源 block + 递归渲染其子树（所有 `parentId === sourceBlockId` 的子 block）
5. 卡片式包裹：
   - **页眉**：显示源页面名称 + 跳转按钮
   - **同页**：跳转按钮灰显/隐藏
   - **内容区**：源 block 和子树渲染

**子树渲染**：
源 block 结构：
```
源 block (bullet)
├── 子 block 1 (bullet)
│   └── 孙 block (code)
├── 子 block 2 (image)
└── 子 block 3 (embed)
```

EmbedRender 从 `blockStore.blocks` 中查询 `parentId === sourceBlockId` 的所有子 block，按 `pos` 排序，使用各自 handler 的 `renderComponent` 递归渲染：

```typescript
const childrenBlocks = computed(() =>
  blockStore.blocks.value
    .filter(b => b.parentId === sourceBlockId)
    .sort((a, b) => a.pos - b.pos)
)
```

每个子 block 也用对应的 `renderComponent` 渲染，形成纯渲染的子树。

**Props**：
```typescript
{
  content: string                 // 不使用
  showPlaceholder?: boolean
  properties: Record<string, any>  // 包含 sourceBlockId, sourcePageId
}
```

**Events 透传**：
- `@language-change`：嵌入的 code block 语言切换事件路由到源 block handler
- `@content-click`：所有子 block 的 content-click 事件在此层拦截，不冒泡到 Block/index.vue（子 block 在嵌入中只读，不启动编辑）

**核心逻辑**：
```typescript
const blockStore = useBlockStore()
const pageStore = usePageStore()
const blockRegistry = useBlockRegistry()

const sourceBlock = computed(() => blockStore.blocks.value.find(b => b.id === props.properties.sourceBlockId))
const sourceHandler = computed(() => sourceBlock.value ? blockRegistry.getHandler(sourceBlock.value.type) : null)
const sourcePage = computed(() => sourceBlock.value ? pageStore.getPage(sourceBlock.value.pageId) : null)

const childrenBlocks = computed(() =>
  blockStore.blocks.value
    .filter(b => b.parentId === props.properties.sourceBlockId)
    .sort((a, b) => a.pos - b.pos)
)

function getChildHandler(type: string) {
  return blockRegistry.getHandler(type)
}
```

### 3.2 编辑器模式
复用 `Editor.vue`。embed block 被激活编辑时，Editor 实际操作的 blockId 是 `sourceBlockId`（源 block），而非 embed block 自身的 id。

**实现方式**：在 `Block/index.vue` 中，为编辑器 `<component>` 传入 editor 专属的 props。embed block 的 editor 绑定到源 block：
```
:editor-block-id="handler.type === 'embed' ? block.properties.sourceBlockId : blockId"
:editor-content="handler.type === 'embed' ? sourceBlock?.content : block.content"
```

这样 Editor.vue 内部操作的是源 block 的 content，双向同步自动生效。

### 3.3 Handler 注册
**路径**: `src/components/Block/handlers/embed/index.ts`

```typescript
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import EmbedRender from './EmbedRender.vue'

const { register } = useBlockRegistry()

register({
  type: 'embed',
  label: 'Embed',
  editorComponent: Editor,
  renderComponent: EmbedRender
})
```

## 4. 选择源 Block

用户需要一种方式选择要嵌入的 block。

### 4.1 斜杠命令 `/embed`
输入 `/embed` → 弹出 block 选择面板 → 选择目标页面 → 选择该页面下的 block → 创建 embed block。

行为：
1. 输入 `/embed` → 将当前 block 类型切换为 `embed`
2. 弹出 block 选择面板（弹窗）：
   - 左侧：页面列表（搜索过滤）
   - 右侧：选中页面的 block 列表（展示 content 预览）
3. 选中 block 后：
   - 设置 `properties.sourceBlockId` 和 `properties.sourcePageId`
   - close 面板

### 4.2 Block 选择面板
**新组件**: `src/components/BlockSelector.vue`

弹窗结构：
```
┌──────────────────────────────────────┐
│  🔍 搜索页面...                      │
├──────────────┬───────────────────────┤
│ 页面列表      │  Block 列表           │
│ - 项目文档    │  - # 产品需求         │
│ - 周报       │  - * 关键功能点        │
│ - meeting    │  - 设计稿链接          │
│ ...          │  ...                  │
└──────────────┴───────────────────────┘
```

Props:
```typescript
{
  visible: boolean        // 是否显示
  excludeBlockId?: string // 排除的 block（避免自引用）
}
```

Emits:
```typescript
{
  select: [sourceBlockId: string, sourcePageId: string]
  close: []
}
```

## 5. 斜杠命令更新

### 5.1 `/embed` 命令
在 `useSlashCommands.ts` 中添加：
```typescript
{
  id: 'embed',
  name: 'Embed',
  alias: ['嵌入', '引用'],
  group: '文本格式',
  icon: '📌',
  action: insertEmbed,
  convertBlockType: 'embed'
}
```

`insertEmbed` 函数：
1. 切换 block 类型为 `embed`
2. 打开 BlockSelector 弹窗
3. 用户选择后写入 properties

## 6. 边界场景处理

### 6.1 源 block 不存在
`properties.sourceBlockId` 指向已被删除的 block。EmbedRender 降级渲染为 "Source block not found" 占位符。

### 6.2 源页面被删除
源 block 存在但 `sourcePage` 不存在。页眉显示 "Deleted page"，隐藏跳转按钮。

### 6.3 源 block 被移到其他页面
`properties.sourcePageId` 可能变旧。EmbedRender 始终从源 block 动态读取 `block.pageId`，不依赖 `properties.sourcePageId`。

### 6.4 环路检测
embed block 嵌套可能引发死循环。三层防御：

1. **创建时**：BlockSelector 的 `excludeBlockId` 传入当前 embed block ID，防止自引用
2. **渲染时**：EmbedRender 递归渲染子 block 时，子 block 可能是 embed 类型。需要深度检测 `sourceBlockId` 链，发现环路时中断并显示 "Circular embed" 提示
3. **限制嵌入深度**：最大嵌套深度 3 层，超过后不再展开，显示链接代替

### 6.5 embed block 不能有子 block
embed 是纯引用节点，不承载子内容。在拖拽交互中：
- ✕ 不允许成为其他 block 的父节点（drag parent target 排除 embed）
- ✕ 自身不显示子缩进区域
- 如果用户需要在 embed 下写笔记，新建 sibling block

### 6.6 嵌入内子 block 只读
嵌入子树中的子 block 仅用于展示，不可编辑。点击嵌入内的子 block 不触发编辑模式（拦截 `@content-click` 事件）。

### 6.7 embed block 被复制
新 block 也引用同一源 block 和子树，合理行为，无需特殊处理。

### 6.8 渲染时 key 设置
由于 render component 和子 block 都依赖外部数据，需要正确的 key 绑定：
```vue
<component :is="sourceHandler?.renderComponent"
  :key="sourceBlockId"
  :content="sourceBlock.content"
  ...
/>
```

子 block 渲染 key 使用各自的 `blockId`。

## 7. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/Block/handlers/embed/EmbedRender.vue` | **新增** | 嵌入渲染组件 |
| `src/components/Block/handlers/embed/index.ts` | **新增** | Handler 注册 |
| `src/components/BlockSelector.vue` | **新增** | Block 选择弹窗 |
| `src/components/Block/index.vue` | 修改 | 导入 embed handler + editor 路由特殊处理 |
| `src/composables/useSlashCommands.ts` | 修改 | 添加 `/embed` 命令 |

## 8. 测试计划

### 单元测试
- EmbedRender 渲染测试（正常 + 源 block 不存在 + 源页被删除 + 同页/跨页）
- 子树渲染测试（子 block 递归渲染 + 深度限制 + 环路检测）
- 嵌入内子 block 只读测试（点击不触发编辑）
- BlockSelector 弹窗交互测试
- embed handler 注册测试

### 集成测试
- `/embed` 斜杠命令流程测试
- 同页嵌入双向同步测试
- 跨页嵌入编辑同步测试
- 源 block 删除后降级显示测试
- 源 block 移动后页眉更新测试
- embed block 不可作为拖拽父节点测试
- 环路检测测试

## 9. 验收标准

- [ ] `/embed` 斜杠命令可正常打开 block 选择面板
- [ ] 选择 block 后创建 embed block，显示卡片式嵌入
- [ ] 嵌入内容包含源 block + 所有子 block（子树递归渲染）
- [ ] 卡片页眉显示源页面名称
- [ ] 跨页嵌入时，跳转按钮可跳转到源页面；同页灰显
- [ ] 编辑 embed block 可双向同步到源 block
- [ ] 源 block 删除后，embed block 显示降级占位
- [ ] 源页面被删除后，页眉显示 "Deleted page"
- [ ] 源 block 移动到其他页面时，页眉更新为新页面名
- [ ] 嵌入内的子 block 点击不触发编辑（只读）
- [ ] embed block 不可拖入子节点
- [ ] 环路检测正常工作（嵌套 embed 深度 ≤ 3）
- [ ] 编译检查通过
- [ ] 测试通过