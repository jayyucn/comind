# 全局搜索功能规格

> 版本：v1.0
> 日期：2026-06-27
> 状态：Phase 2 Sprint 3 已完成
> 依据：`core-layer.md` `storage-adapter.md`

***

## 1. 功能概述

comind 全局搜索提供快速、准确的全文检索能力，支持中英文混合搜索，可通过 `Ctrl+K` / `Cmd+K` 快捷键快速唤起。

### 1.1 核心特性

| 特性 | 说明 |
|------|------|
| **全文搜索** | 支持 Block 内容和 Page 标题的全文检索 |
| **中英文支持** | 英文使用 Lunr.js 自带分词器，中文使用 bigram 字符二元切分 |
| **增量索引** | 实时监听数据变化，自动更新搜索索引 |
| **类型过滤** | 支持按 Block 或 Page 类型过滤搜索结果 |
| **键盘导航** | 完整的键盘快捷键支持（上下箭头、Enter、Esc） |
| **结果高亮** | 搜索结果中高亮显示匹配文本 |

### 1.2 设计目标

| 目标 | 说明 |
|------|------|
| **快速** | 索引构建和搜索响应时间 < 100ms |
| **准确** | 支持模糊匹配和相关性排序 |
| **可扩展** | 框架无关的 Core Layer 设计，易于迁移到其他搜索引擎 |
| **可维护** | 增量索引机制，避免全量重建开销 |

***

## 2. 架构设计

### 2.1 模块结构

```
src/core/search/
├── index.ts              # 搜索模块导出
├── lunrSearch.ts         # Lunr.js 搜索引擎实现
├── indexManager.ts       # 索引管理器（增量更新）
└── searchService.ts      # 搜索服务（统一 API）
```

### 2.2 依赖关系

```
SearchService (UI Layer)
       ↓
SearchService (Core Layer)
       ↓
┌──────────────┬─────────────────┐
│              │                 │
IndexManager   LunrSearch    StorageAdapter
              (搜索引擎)      (数据源)
```

### 2.3 数据流

```
用户输入查询
    ↓
SearchPanel.vue
    ↓
SearchService.search(query)
    ↓
LunrSearch.search(query)
    ↓
返回 SearchResult[]
    ↓
渲染搜索结果面板
```

***

## 3. 核心模块

### 3.1 LunrSearch 搜索引擎

**位置：** `src/core/search/lunrSearch.ts`

**职责：**
- 构建和管理 Lunr.js 索引
- 实现中英文混合分词
- 提供搜索接口

**核心类型：**

```typescript
// 索引文档
interface IndexDocument {
  id: string
  type: 'block' | 'page'
  pageId?: string
  blockId?: string
  title?: string
  content: string
}

// 搜索结果
interface LunrSearchResult {
  id: string
  type: 'block' | 'page'
  pageId?: string
  blockId?: string
  title?: string
  content: string
  score: number
  matchedText: string
}
```

**中文分词策略：**

使用 bigram（字符二元切分）处理中文文本：

```typescript
tokenize(text: string): string[] {
  const tokens: string[] = []
  const chineseRegex = /[\u4e00-\u9fa5]/

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    // 英文单词分词
    if (/[a-zA-Z0-9]/.test(char)) {
      let word = char
      while (i + 1 < text.length && /[a-zA-Z0-9]/.test(text[i + 1])) {
        word += text[++i]
      }
      tokens.push(word.toLowerCase())
      continue
    }

    // 中文 bigram 分词
    if (chineseRegex.test(char)) {
      if (i + 1 < text.length && chineseRegex.test(text[i + 1])) {
        tokens.push(char + text[i + 1])
      }
      // 单字也作为 token
      tokens.push(char)
    }
  }

  return tokens
}
```

**索引配置：**

```typescript
this.index = lunr(function () {
  this.field('title', { boost: 10 })  // 标题权重更高
  this.field('content')
  this.ref('id')

  // 自定义分词器
  this.pipeline.reset()
  this.searchPipeline.reset()
  this.tokenizer = customTokenizer
})
```

### 3.2 IndexManager 索引管理器

**位置：** `src/core/search/indexManager.ts`

**职责：**
- 监听数据变化
- 维护增量索引
- 协调搜索引擎重建

**核心方法：**

```typescript
class IndexManager {
  // 构建完整索引
  async buildFullIndex(): Promise<void>

  // 添加文档到索引
  addDocument(doc: IndexDocument): void

  // 更新文档
  updateDocument(doc: IndexDocument): void

  // 删除文档
  removeDocument(id: string): void

  // 获取搜索引擎实例
  getSearchEngine(): LunrSearch
}
```

**增量更新策略：**

```typescript
// Debounce 延迟更新（避免频繁重建）
private debounceRebuild = debounce(() => {
  if (this.dirty) {
    this.rebuildIndex()
  }
}, 300)

// 标记脏数据
private markDirty(): void {
  this.dirty = true
  this.debounceRebuild()
}
```

### 3.3 SearchService 搜索服务

**位置：** `src/core/search/searchService.ts`

**职责：**
- 提供统一的搜索 API
- 封装索引管理逻辑
- 支持类型过滤

**核心接口：**

```typescript
class SearchService {
  // 初始化搜索服务
  async initialize(): Promise<void>

  // 搜索
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>

  // 增量索引更新
  async indexBlock(block: Block): Promise<void>
  async indexPage(page: Page): Promise<void>
  async removeIndex(id: string): Promise<void>
}

interface SearchOptions {
  limit?: number           // 结果数量限制（默认 20）
  type?: 'block' | 'page' | 'all'  // 类型过滤
}

interface SearchResult {
  id: string
  type: 'block' | 'page'
  pageId?: string
  blockId?: string
  title?: string
  content: string
  score: number
  matchedText: string
  highlights: { start: number; end: number }[]
}
```

***

## 4. UI 交互

### 4.1 SearchPanel 组件

**位置：** `src/components/SearchPanel.vue`

**快捷键：**

| 快捷键 | 行为 |
|--------|------|
| `Ctrl+K` / `Cmd+K` | 打开搜索面板 |
| `Esc` | 关闭搜索面板 |
| `↑` / `↓` | 在结果中导航 |
| `Enter` | 打开选中的结果 |
| 输入文本 | 实时搜索（防抖 200ms） |

**状态管理：**

```typescript
const query = ref('')
const results = ref<SearchResult[]>([])
const selectedIndex = ref(0)
const loading = ref(false)
const searchInitialized = ref(false)
```

**实时搜索：**

```typescript
// 防抖搜索
watch(query, debounce(async (newQuery) => {
  if (!newQuery.trim()) {
    results.value = []
    return
  }

  loading.value = true
  try {
    const core = getCore()
    const searchResults = await core.searchService.search(newQuery)
    results.value = searchResults
    selectedIndex.value = 0
  } finally {
    loading.value = false
  }
}, 200))
```

### 4.2 结果展示

**搜索结果项结构：**

```
┌─────────────────────────────────────────┐
│ [图标] 标题（Page 名称或 Block 预览）    │
│         内容片段（高亮匹配文本）          │
│         类型标签：Block / Page          │
└─────────────────────────────────────────┘
```

**高亮显示：**

```typescript
// 高亮匹配文本
function highlightMatch(text: string, highlights: { start: number; end: number }[]): string {
  let result = ''
  let lastEnd = 0

  for (const { start, end } of highlights) {
    result += text.slice(lastEnd, start)
    result += `<mark>${text.slice(start, end)}</mark>`
    lastEnd = end
  }

  result += text.slice(lastEnd)
  return result
}
```

### 4.3 导航行为

**打开搜索结果：**

```typescript
function navigateToResult(result: SearchResult) {
  if (result.type === 'page') {
    router.push({ name: 'page', params: { pageId: result.id } })
  } else {
    // Block 类型：跳转到所在页面，滚动到 Block
    router.push({
      name: 'page',
      params: { pageId: result.pageId },
      query: { blockId: result.blockId }
    })
  }
  emit('close')
}
```

***

## 5. 数据模型

### 5.1 索引文档结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 文档唯一标识（Block ID 或 Page ID） |
| `type` | 'block' \| 'page' | 文档类型 |
| `pageId` | string? | 所属页面 ID（仅 Block） |
| `blockId` | string? | Block ID（仅 Block） |
| `title` | string? | 标题（仅 Page） |
| `content` | string | 内容文本 |

### 5.2 搜索结果结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 文档 ID |
| `type` | 'block' \| 'page' | 文档类型 |
| `pageId` | string? | 所属页面 ID |
| `blockId` | string? | Block ID |
| `title` | string? | 标题 |
| `content` | string | 内容片段 |
| `score` | number | 相关性得分 |
| `matchedText` | string | 匹配的文本片段 |
| `highlights` | array | 高亮位置数组 |

***

## 6. 性能优化

### 6.1 索引构建优化

| 策略 | 说明 |
|------|------|
| **懒加载** | 首次搜索时才构建索引 |
| **增量更新** | 监听数据变化，局部更新索引 |
| **Debounce** | 延迟重建索引，避免频繁更新 |

### 6.2 搜索性能优化

| 策略 | 说明 |
|------|------|
| **结果限制** | 默认返回 20 条结果，避免过多数据传输 |
| **防抖搜索** | 200ms 防抖，避免频繁查询 |
| **预加载** | 应用启动时预初始化搜索服务 |

### 6.3 内存优化

| 策略 | 说明 |
|------|------|
| **文档 Map** | 使用 Map 存储文档，快速查找 |
| **索引复用** | Lunr.js Index 只读，可安全共享 |
| **按需加载** | 仅索引必要字段（id, type, content, title） |

***

## 7. 扩展性

### 7.1 搜索引擎抽象

当前使用 Lunr.js 实现，未来可替换为其他搜索引擎：

```typescript
// 搜索引擎接口
interface SearchEngine {
  search(query: string, limit: number): SearchResult[]
  addDocument(doc: IndexDocument): void
  removeDocument(id: string): void
  rebuild(): void
}
```

**可选方案：**

| 引擎 | 适用场景 | 优势 |
|------|---------|------|
| **Lunr.js** | 小型应用、浏览器端 | 轻量、无需服务器 |
| **FlexSearch** | 中型应用、浏览器端 | 更快的搜索速度 |
| **MeiliSearch** | 大型应用、服务器端 | 支持模糊搜索、拼写纠错 |
| **Elasticsearch** | 企业级应用 | 强大的全文搜索能力 |

### 7.2 索引策略扩展

**当前：** 全量索引 + 增量更新

**未来可选：**

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| **分区索引** | 按时间或类型分区 | 大量历史数据 |
| **异步索引** | Web Worker 后台构建 | 避免阻塞 UI |
| **持久化索引** | IndexedDB 存储索引 | 快速启动 |

***

## 8. 测试覆盖

### 8.1 单元测试

**测试文件：**
- `src/core/__tests__/lunrSearch.test.ts` - 搜索引擎测试
- `src/core/__tests__/searchService.test.ts` - 搜索服务测试

**测试用例：**

```typescript
describe('LunrSearch', () => {
  it('应该正确索引文档', () => {})
  it('应该支持英文搜索', () => {})
  it('应该支持中文 bigram 分词', () => {})
  it('应该支持中英文混合搜索', () => {})
  it('应该返回相关性得分', () => {})
})

describe('SearchService', () => {
  it('应该初始化搜索引擎', () => {})
  it('应该返回格式化的搜索结果', () => {})
  it('应该支持类型过滤', () => {})
  it('应该限制结果数量', () => {})
})
```

### 8.2 集成测试

**测试场景：**
- Block 创建后可被搜索到
- Block 更新后索引自动更新
- Block 删除后从索引中移除
- Page 标题搜索
- 中文模糊搜索
- 键盘导航交互

***

## 9. 已知限制

### 9.1 当前限制

| 限制 | 说明 | 计划 |
|------|------|------|
| **索引重建** | Lunr.js 索引只读，更新需要重建 | Sprint 4：探索增量索引方案 |
| **无持久化** | 索引存储在内存，刷新后需重建 | Sprint 4：IndexedDB 持久化 |
| **无模糊搜索** | 仅支持精确匹配 | Sprint 5：集成 FlexSearch |

### 9.2 性能边界

| 场景 | 性能指标 |
|------|---------|
| 1000 个 Block | 索引构建 < 200ms |
| 5000 个 Block | 索引构建 < 1s |
| 10000 个 Block | 索引构建 < 3s |
| 搜索响应 | < 50ms |

***

## 10. 未来规划

### 10.1 Sprint 4 计划

- [ ] 索引持久化（IndexedDB 存储）
- [ ] 后台索引构建（Web Worker）
- [ ] 搜索历史记录

### 10.2 Sprint 5+ 计划

- [ ] 模糊搜索和拼写纠错
- [ ] 搜索结果排序（按时间、相关性）
- [ ] 高级搜索语法（AND/OR/NOT）
- [ ] 搜索结果预览

***

## 11. 参考资料

### 11.1 相关文档

- [Core Layer 架构设计](../2-architecture/core-layer.md)
- [Storage Adapter 接口规范](../2-architecture/storage-adapter.md)
- [开发指南](../5-development/dev-guide.md)

### 11.2 外部资源

- [Lunr.js 文档](https://lunrjs.com/)
- [FlexSearch 文档](https://github.com/nextapps-de/flexsearch)
- [全文搜索最佳实践](https://www.algolia.com/blog/what-is-full-text-search/)

***

**文档更新记录：**

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-06-27 | 初始版本，完整搜索功能规格 |