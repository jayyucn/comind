# Tag 设计规范（已废弃 → 统一到 Page Link）

> 版本：v0.3
> 日期：2026-05-18
> 状态：**已废弃** — Tag 概念已删除，#tag 统一为 Page 链接

## 摘要

comind 不再维护独立的 Tag 概念。原 `#tag` 语法现在渲染为指向 Page 的链接，与 `[[WikiLink]]` 共享同一套数据模型和交互逻辑。

```
#设计   →  <span class="block-link block-tag" data-page="设计">#设计</span>
[[设计]] →  <span class="block-link" data-page="设计">设计</span>
```

两者都指向同一个 Page（`title = "设计"`），区别仅在于渲染样式。

---

## 1. 设计决策

### 1.1 为什么删除独立 Tag

已有机制已覆盖 Tag 的使用场景：

| 已有机制 | 覆盖的场景 |
|---------|------------|
| `[[WikiLink]]` 双向链接 | 关联任意 Page |
| Page 表 | 持久化 Page 元信息 |
| Block 树状层级（parent/children） | 结构化组织 |
| `project` / `area` 属性 | 分类维度 |

独立的 Tag 表/属性是冗余概念，增加维护成本且无额外表达能力。

### 1.2 Logseq 的先例

Logseq 中 `#foo` 和 `[[foo]]` 在底层是同一个链接，仅渲染风格不同。comind 采用相同策略。

---

## 2. 新行为

### 2.1 解析（parser.ts）

`parser.ts` 不再提取 `tags` 字段：
- 移除 `TAG_REGEX`、`TAG_PATTERN`、`isTagInUrlContext()`
- `ParseResult.tags` 字段保留（空数组），保持接口兼容

`#tag` 的识别由 `useContentRenderer.ts` 在渲染层完成（正则匹配 → 生成 `block-link` DOM）。

### 2.2 渲染（useContentRenderer.ts）

```typescript
// #tag → 渲染为 Page 链接
const TAG_REGEX = /(?<![\\/|>|@])#([\p{L}_][\p{L}\p{N}_]*(?:\/[\p{L}_][\p{L}\p{N}_]*)*)/gu

// 渲染结果
<span class="block-link block-tag" data-page="tag名">#tag名</span>
```

CSS 区分样式：
```css
.block-link.block-tag {
  /* tag 风格：带 # 前缀、背景色 */
  color: var(--tag-color, #0366d6);
  background: var(--tag-bg, rgba(3, 102, 214, 0.1));
  padding: 0 4px;
  border-radius: 3px;
}
.block-link:not(.block-tag) {
  /* WikiLink 风格：无 # 前缀 */
}
```

### 2.3 点击行为

点击 `#tag` → 调用 `navigateToPage(tag名)` → 导航到对应 Page

与 `[[WikiLink]]` 行为完全一致。

### 2.4 Slash Command

| 命令 | 状态 | 说明 |
|------|------|------|
| `/tag` | ✅ 保留 | 插入 `#` 字符，后续输入即 Page 名 |
| `/tags`（属性编辑器） | ❌ 已删除 | 不再有独立的 tags 属性 |

---

## 3. 迁移指南

如果你在文档中看到旧的 Tag 相关描述，按以下方式理解：

| 旧概念 | 新等价物 |
|--------|----------|
| `parser.ts` 提取的 `tags` 数组 | 渲染层正则匹配，不单独提取 |
| `useTagFilter.ts` 过滤视图 | 使用 Page 反向链接（Backlinks）面板 |
| `property.ts` 的 `tags` 属性 | 删除，用 `project` / `area` 属性或直接在正文写 `#tag` |
| `TagFilterPanel.vue` 组件 | 已删除 |

---

## 4. 相关文档

- `link-spec.md` — WikiLink 语法和规范（#tag 现在复用此规范）
- `property-spec.md` — 属性规范（tags 属性已移除）
- `slash-commands-spec.md` — Slash 命令规范（`/tags` 已移除）
- `useContentRenderer.ts` — 渲染层实现（#tag 解析逻辑在此）
- `parser.ts` — 解析层（tags 提取已移除）

---

*本文档替代原 v0.2 tag-spec.md。原文档描述的独立 Tag 系统已实现并随后废弃。*
