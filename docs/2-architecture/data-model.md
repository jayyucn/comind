# 数据模型设计

> 版本：v0.4
> 日期：2026-04-24
> 状态：✅ 已确认（评审通过）

---

## 1. 核心设计决策

### 1.1 统一模型 vs 独立 Page 表

**决策：引入独立 Page 表**

理由：
- `PageMeta` 只对 `type==page` 的 Block 有意义，空值污染 Block 表
- Page 分 `normal` 和 `journal` 两种类型，独立表查询更清晰
- 语义上 Page 是 Block 的容器，不是 Block 的角色

### 1.2 Block.type 枚举化

**决策：`Block.type` 使用枚举替代 `isPage` 布尔值**

```typescript
enum BlockType {
  bullet = 'bullet',      // 默认类型，折叠显示
  property = 'property',  // 属性块（key:: value）
  query = 'query',        // 查询块（未实现）
  embed = 'embed'         // 嵌入块（未实现）
}
```

支持未来扩展 `query`/`embed` 等类型。

---

## 2. 数据模型

### 2.1 Page 表（独立实体）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `blockId` | string | FK → Block.id, UNIQUE, NOT NULL | 关联根 Block，1:1 |
| `title` | string | NOT NULL | 页面标题 |
| `type` | string | NOT NULL, CHECK IN ('normal', 'journal') | 页面类型 |
| `icon` | string | NULL | Emoji 图标 |
| `cover` | string | NULL | 封面图路径 |
| `aliases` | string | NULL | 别名列表，JSON 数组 |
| `filePath` | string | NULL | 关联文件路径（外部链接时） |
| `childrenCount` | integer | DEFAULT 0 | 直接子 Block 数量 |
| `wordCount` | integer | DEFAULT 0 | 页面总字数 |
| `createdAt` | integer | NOT NULL | 创建时间戳（毫秒） |
| `updatedAt` | integer | NOT NULL | 更新时间戳（毫秒） |

**说明：**
- `blockId` 建立 Page 与根 Block 的 1:1 关联
- `title` 独立存储，不依赖 Block.content
- `type` 区分普通页面和日记页面

### 2.2 Block 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `pageId` | string | FK → Page.id, NOT NULL | 所属页面，必须非空 |
| `parentId` | string | FK → Block.id, NULL | 父 Block（NULL = 根 Block） |
| `leftId` | string | FK → Block.id, NULL | 左侧同级 Block（排序用） |
| `content` | string | NOT NULL | 块内容（纯文本） |
| `format` | string | NOT NULL, DEFAULT 'plain' | 格式：`plain` / `markdown` / `org` |
| `type` | string | NOT NULL, DEFAULT 'bullet' | 块类型 |
| `properties` | string | NULL | 附加属性，JSON 对象 |
| `createdAt` | integer | NOT NULL | 创建时间戳 |
| `updatedAt` | integer | NOT NULL | 更新时间戳 |

**说明：**
- `pageId` 必须非空，每个 Block 必须属于某个 Page
- `leftId` 实现同级排序（GAP 逻辑）
- `properties` 存储 Property、Tag、Link 解析后的结构化数据

### 2.3 Link 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `sourceBlockId` | string | FK → Block.id, NOT NULL | 源 Block |
| `targetPageId` | string | FK → Page.id, NULL | 目标页面（内部链接） |
| `displayText` | string | NOT NULL | 显示文本 |
| `type` | string | NOT NULL | 链接类型 |
| `createdAt` | integer | NOT NULL | 创建时间戳 |

**说明：**
- 外部链接 `targetPageId` 为 NULL
- 内部链接同时存储 `targetPageId` 和 `displayText`

### 2.4 Tag 表

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string | PK, UUID | 唯一标识 |
| `name` | string | UNIQUE, NOT NULL | 标签名（不含 #） |
| `createdAt` | integer | NOT NULL | 创建时间戳 |

---

## 3. Page ↔ Block 联动规则

### 3.1 创建 Page

```
1. 创建根 Block（parentId = NULL）
2. 创建 Page，填充 blockId 指向根 Block
3. 回填 Block.pageId 指向 Page
```

### 3.2 删除 Page

```
事务内：
  1. 查询 Page 所有 Block.id（递归）
  2. 删除这些 Block 的所有 Link
  3. 删除这些 Block
  4. 删除 Page
```

### 3.3 更新 Page.title

```
仅修改 Page.title，不动 Block.content
```

### 3.4 删除 Block

```
级联删除：
  1. 递归删除所有子 Block 及其 Link
  2. 同步更新 Page 的 childrenCount/wordCount
```

### 3.5 更新 Block.content

```
延迟同步 Page 统计（childrenCount/wordCount）
可批量异步更新，避免每次编辑都触发布局计算
```

---

## 4. 视图层抽象

### 4.1 usePageStore

代码层面通过 `usePageStore` 抽象 Page 和 Block 的联动：

```typescript
// 伪代码
interface PageStore {
  // Page 级别操作
  createPage(title: string, type: 'normal' | 'journal'): Promise<Page>
  deletePage(pageId: string): Promise<void>
  updatePageTitle(pageId: string, title: string): Promise<void>
  
  // Block 级别操作（挂载在 Page 上下文）
  createBlock(pageId: string, content: string): Promise<Block>
  deleteBlock(blockId: string): Promise<void>
  moveBlock(blockId: string, targetParentId: string): Promise<void>
}
```

**原则：** UI 层不直接感知 `isPage` 或 Block 底层结构，通过 Store 统一接口操作。

---

## 5. Phase 适用说明

| Phase | 存储方案 | Page 表 | Block 表 | Link 表 | Tag 表 |
|-------|----------|---------|----------|---------|--------|
| Phase 1 | LocalStorage | ✅ | ✅ | ✅ | ✅ |
| Phase 2 | Markdown + SQLite | ✅ | ✅ | ✅ | ✅ |
| Phase 3 | Tauri + rusqlite | ✅ | ✅ | ✅ | ✅ |

**Phase 1 特殊处理：**
- LocalStorage 不支持事务，通过 `batchUpdate` 模拟
- 统计信息（childrenCount/wordCount）可延迟更新

---

## 6. 待定事项

- [ ] 冲突处理策略
- [ ] 文件监听机制
- [ ] 全文搜索实现
- [ ] 数据加密选项