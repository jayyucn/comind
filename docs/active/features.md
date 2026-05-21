# comind 功能规格

> 版本：v1.0
> 日期：2026-05-21
> 状态：活跃
> 来源：合并自 link-spec.md + slash-commands-spec.md + slash-commands-logseq-reference.md + functional-design-spec.md

---

## 1. 链接系统

### 1.1 内部链接（WikiLink）

**语法：** `[[页面名]]` 或 `[[页面名|显示文本]]`

**解析规则：**
- 正则：`/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g`
- `targetTitle`：链接指向的页面标题
- `displayText`：显示文本（默认等于 targetTitle）
- `position`：在 content 中的字符偏移

**链接生命周期：**

| 阶段 | 行为 |
|------|------|
| 输入时 | `[[` 触发链接补全弹出框 |
| 保存时 | 解析 content 中的 `[[...]]`，写入 Link 表 |
| 显示时 | `[[...]]` 渲染为高亮链接 |
| 点击时 | 跳转到目标 Page |

### 1.2 悬空链接

- 目标 Page 不存在时，链接仍可显示
- 点击悬空链接时，创建新 Page 并跳转
- 目标 Page 被删除后，链接变为"悬空"状态，显示删除线样式

### 1.3 外部链接

- 语法：`https://...` 或 `http://...`
- 识别规则：匹配 URL 正则
- 点击时：浏览器打开新标签页

### 1.4 反向链接（Backlinks）

- 自动收集所有指向当前 Page 的 Link
- 显示在页面底部，可折叠
- 每条 Backlink 显示源 Block 内容和来源页面

---

## 2. 斜杠命令

### 2.1 MVP 命令列表

| 命令 | 中文别名 | 说明 |
|------|---------|------|
| `/h1` | `/标题1` | 设置为一级标题 |
| `/h2` | `/标题2` | 设置为二级标题 |
| `/h3` | `/标题3` | 设置为三级标题 |
| `/bullet` | `/列表` | 设置为圆点列表 |
| `/numbered` | `/编号` | 设置为编号列表 |
| `/todo` | `/待办` | 设置为待办事项 |
| `/text` | `/文本` | 设置为普通文本 |
| `/quote` | `/引用` | 设置为引用块 |
| `/divider` | `/分割线` | 插入分割线 |
| `/property` | `/属性` | 插入属性块 |
| `/query` | `/查询` | 插入查询块 |
| `/embed` | `/嵌入` | 嵌入其他页面内容 |
| `/page` | `/页面` | 创建新页面并链接 |
| `/journal` | `/日记` | 创建/跳转到今日日记 |
| `/link` | `/链接` | 插入外部链接 |
| `/tag` | `/标签` | 插入标签 |
| `/collapse` | `/折叠` | 折叠当前 Block |
| `/expand` | `/展开` | 展开当前 Block |

### 2.2 命令执行流程

1. 用户输入 `/` → 弹出命令选择框
2. 用户选择或输入命令 → 按 Enter 执行
3. 命令替换当前 Block 的 `format.type`
4. 命令选择框消失

### 2.3 命令注册机制

```typescript
interface SlashCommand {
  id: string
  label: string
  aliases: string[]
  description: string
  execute: (blockId: string) => void
}

const slashCommands: SlashCommand[] = [
  { id: 'h1', label: '标题1', aliases: ['/h1'], description: '设置为一级标题', execute: (id) => setBlockFormat(id, { type: 'heading', level: 1 }) },
  // ...
]
```

---

## 3. 功能设计

### 3.1 页面类型

| 类型 | 说明 | 创建方式 |
|------|------|---------|
| `normal` | 普通页面 | 用户手动创建 |
| `journal` | 日记页面 | 自动创建（按日期） |

### 3.2 Block 类型

| 类型 | 说明 | 格式 |
|------|------|------|
| `bullet` | 圆点列表项 | 默认类型 |
| `property` | 属性行 | `key:: value` 格式 |
| `query` | 查询块 | 查询其他 Block 并显示 |
| `embed` | 嵌入块 | 嵌入其他页面内容 |

### 3.3 Block 操作

| 操作 | 触发方式 | 效果 |
|------|---------|------|
| 创建 | Enter / 新页面 | 创建新 Block |
| 编辑 | 点击 Block | 进入编辑态 |
| 删除 | Backspace（空 Block） | 删除 Block |
| 拆分 | Enter（光标在中间） | 拆分为两个 Block |
| 合并 | Backspace（光标在开头） | 与上一个 Block 合并 |
| 缩进 | Tab | 变为前一个兄弟的子节点 |
| 反缩进 | Shift+Tab | 提升层级 |
| 拖拽 | 拖拽 bullet | 调整顺序和层级 |
| 折叠 | 点击折叠图标 | 隐藏子 Block |

### 3.4 内容解析

**解析顺序：**
1. Property 行（`key:: value`）
2. WikiLink（`[[...]]`）
3. 标签（`#...`）
4. 外部链接（`https://...`）

**解析时机：** 保存时解析（非输入时实时解析）

---

*本文档由 4 个功能规格文档合并而成，版本 v1.0*
