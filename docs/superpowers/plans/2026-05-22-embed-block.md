# Embed Block 实施方案
> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent‑driven‑development（推荐）或 superpowers:executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：新增 embed block handler，实现跨页/同页 block 嵌入，双向同步编辑，支持子树递归渲染
**架构**：EmbedRender 卡片式包裹 + 递归渲染源 block 子树，Editor 路由到源 block，BlockSelector 弹窗选目标
**技术栈**：Vue 3 + TypeScript + vue-router
---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/components/Block/handlers/embed/EmbedRender.vue` | **新增** | 卡片包裹 + 页眉 + 源 block 子树递归渲染 |
| `src/components/Block/handlers/embed/index.ts` | **新增** | Handler 注册 |
| `src/components/BlockSelector.vue` | **新增** | 页面/block 选择弹窗 |
| `src/components/Block/index.vue` | 修改 | 导入 handler + editor 路由 + properties prop + drag 排除 |
| `src/composables/useSlashCommands.ts` | 修改 | `/embed` 命令 |

---

### 任务1：创建 EmbedRender.vue 组件
**涉及文件：**
- 新建：`src/components/Block/handlers/embed/EmbedRender.vue`

- [ ] **步骤1：创建渲染组件**

```vue
<script setup lang="ts">
import { computed, ref, h, type VNode } from 'vue'
import { useBlockStore } from '../../../../stores/blocks'
import { usePageStore } from '../../../../stores/pages'
import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import { useNavigateToPage } from '../../../../composables/useNavigateToPage'

const props = defineProps<{
  content: string
  showPlaceholder?: boolean
  properties: Record<string, any>
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
  (e: 'language-change', lang: string): void
}>()

const blockStore = useBlockStore()
const pageStore = usePageStore()
const blockRegistry = useBlockRegistry()
const { navigateToPage } = useNavigateToPage()

const MAX_EMBED_DEPTH = 3

const sourceBlockId = computed(() => props.properties?.sourceBlockId as string || '')
const sourceBlock = computed(() => blockStore.blocks.value.find(b => b.id === sourceBlockId.value))
const sourcePage = computed(() => sourceBlock.value ? pageStore.getPage(sourceBlock.value.pageId) : null)
const sourceHandler = computed(() => sourceBlock.value ? blockRegistry.getHandler(sourceBlock.value.type) : null)

const isSamePage = computed(() => {
  const currentPage = pageStore.currentPage
  return sourceBlock.value && currentPage && sourceBlock.value.pageId === currentPage.id
})

const hasCircular = ref(false)

function detectCircular(targetId: string, depth: number = 0): boolean {
  if (depth > MAX_EMBED_DEPTH) return true
  const block = blockStore.blocks.value.find(b => b.id === targetId)
  if (!block || block.type !== 'embed') return false
  const nextId = block.properties?.sourceBlockId
  if (!nextId) return false
  if (nextId === sourceBlockId.value) return true
  if (depth >= MAX_EMBED_DEPTH) return true
  return detectCircular(nextId, depth + 1)
}

const circularDetected = computed(() => {
  if (!sourceBlock.value || sourceBlock.value.type !== 'embed') return false
  return detectCircular(sourceBlockId.value)
})

const childrenBlocks = computed(() =>
  sourceBlock.value
    ? blockStore.blocks.value
        .filter(b => b.parentId === sourceBlockId.value)
        .sort((a, b) => a.pos - b.pos)
    : []
)

function getChildHandler(type: string) {
  return blockRegistry.getHandler(type)
}

function handleContentClick(e: MouseEvent) {
  e.stopPropagation()
}

function handleLanguageChange(lang: string) {
  emit('language-change', lang)
}

function handleJump() {
  if (sourceBlock.value && sourcePage.value) {
    navigateToPage(sourcePage.value.id, sourceBlock.value.id)
  }
}

function renderBlockContent(block: { type: string; content: string; properties: Record<string, any> }, isEmbedRoot: boolean): VNode {
  const handler = getChildHandler(block.type)
  if (!handler) {
    return h('div', { class: 'embed-child-placeholder' }, `${block.type} (not registered)`)
  }

  if (block.type === 'embed') {
    const nextId = block.properties?.sourceBlockId
    if (nextId && detectCircular(nextId)) {
      return h('div', { class: 'embed-circular-warning' }, 'Circular embed')
    }
  }

  const componentProps: Record<string, any> = {
    content: block.content,
    properties: block.properties,
    showPlaceholder: false,
    readonly: true
  }

  const eventHandlers: Record<string, any> = {}
  if (block.type === 'code') {
    eventHandlers['onLanguage-change'] = handleLanguageChange
  }
  eventHandlers['onContent-click'] = handleContentClick

  const component = h(handler.renderComponent, componentProps, eventHandlers)

  if (isEmbedRoot) {
    return component
  }

  return h('div', { class: 'embed-child-row' }, [
    h('span', { class: 'embed-child-bullet' }, [
      h('span', { class: 'bullet-dot' })
    ]),
    h('div', { class: 'embed-child-content' }, [component])
  ])
}
</script>

<template>
  <div class="embed-block">
    <template v-if="!sourceBlockId">
      <div class="embed-placeholder">Select a block to embed...</div>
    </template>
    <template v-else-if="!sourceBlock">
      <div class="embed-error">Source block not found</div>
    </template>
    <template v-else>
      <div class="embed-card">
        <div class="embed-header">
          <span class="embed-page-name">
            {{ sourcePage ? sourcePage.title : 'Deleted page' }}
          </span>
          <button
            v-if="sourcePage && !isSamePage"
            class="embed-jump-btn"
            @click.stop="handleJump"
            title="Jump to source page"
          >
            ↗
          </button>
          <span v-else-if="isSamePage" class="embed-same-page-tag">same page</span>
        </div>
        <div class="embed-content">
          <div v-if="circularDetected" class="embed-circular-warning">Circular embed</div>
          <div v-else class="embed-source-block">
            <div class="embed-block-row">
              <span class="embed-block-bullet">
                <span class="bullet-dot"></span>
              </span>
              <div class="embed-block-content">
                <component
                  :is="sourceHandler?.renderComponent"
                  v-if="sourceHandler"
                  :key="sourceBlockId"
                  :content="sourceBlock.content"
                  :properties="sourceBlock.properties"
                  :show-placeholder="false"
                  :readonly="true"
                  @content-click="handleContentClick"
                  @language-change="handleLanguageChange"
                />
                <div v-else class="embed-child-placeholder">{{ sourceBlock.type }} (not registered)</div>
              </div>
            </div>
            <div
              v-for="child in childrenBlocks"
              :key="child.id"
              class="embed-block-row"
            >
              <span class="embed-block-bullet">
                <span class="bullet-dot"></span>
              </span>
              <div class="embed-block-content">
                <component
                  :is="getChildHandler(child.type)?.renderComponent"
                  v-if="child.type !== 'embed' && getChildHandler(child.type)"
                  :content="child.content"
                  :properties="child.properties"
                  :show-placeholder="false"
                  :readonly="true"
                  @content-click="handleContentClick"
                  @language-change="handleLanguageChange"
                />
                <div v-else-if="child.type === 'embed'" class="embed-circular-warning">Circular embed</div>
                <div v-else class="embed-child-placeholder">{{ child.type }} (not registered)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.embed-block {
  min-height: 1.5em;
}

.embed-placeholder,
.embed-error {
  color: var(--text-muted, #78716C);
  font-style: italic;
}

.embed-error {
  color: #DC2626;
}

.embed-card {
  border: 1px solid var(--border-color, #E7E5E4);
  border-radius: 6px;
  overflow: hidden;
}

.embed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: var(--bg-secondary, #FAFAF9);
  border-bottom: 1px solid var(--border-color, #E7E5E4);
  font-size: 12px;
  color: var(--text-muted, #78716C);
}

.embed-page-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.embed-jump-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-muted, #78716C);
  padding: 0 4px;
  flex-shrink: 0;
}

.embed-jump-btn:hover {
  color: var(--text-primary, #1C1917);
}

.embed-same-page-tag {
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.5;
  flex-shrink: 0;
}

.embed-content {
  padding: 6px 10px;
}

.embed-circular-warning {
  color: #B45309;
  font-style: italic;
  padding: 4px 0;
}

.embed-source-block {
  /* container for source block + subtrees */
}

.embed-block-row {
  display: flex;
  align-items: flex-start;
}

.embed-block-bullet {
  width: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 6px;
}

.embed-block-content {
  flex: 1;
  min-width: 0;
}

.embed-child-placeholder {
  color: var(--text-muted, #78716C);
  font-style: italic;
}
</style>
```

- [ ] **步骤2：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：无类型错误。

---

### 任务2：创建 Embed Handler 注册
**涉及文件：**
- 新建：`src/components/Block/handlers/embed/index.ts`

- [ ] **步骤1：创建注册文件**

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

- [ ] **步骤2：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：无类型错误。

---

### 任务3：创建 BlockSelector 弹窗组件
**涉及文件：**
- 新建：`src/components/BlockSelector.vue`

- [ ] **步骤1：创建弹窗组件**

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'

const props = defineProps<{
  visible: boolean
  excludeBlockId?: string
}>()

const emit = defineEmits<{
  (e: 'select', sourceBlockId: string, sourcePageId: string): void
  (e: 'close'): void
}>()

const pageStore = usePageStore()
const blockStore = useBlockStore()

const searchQuery = ref('')
const selectedPageId = ref<string | null>(null)

const pages = computed(() =>
  pageStore.pages.value
    .filter(p => !p.deleted)
    .filter(p => searchQuery.value === '' ||
      p.title.toLowerCase().includes(searchQuery.value.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)
)

const pageBlocks = computed(() => {
  if (!selectedPageId.value) return []
  return blockStore.blocks.value
    .filter(b => b.pageId === selectedPageId.value)
    .filter(b => b.id !== props.excludeBlockId)
    .sort((a, b) => a.pos - b.pos)
})

function selectPage(pageId: string) {
  selectedPageId.value = pageId
}

function selectBlock(blockId: string) {
  const block = blockStore.blocks.value.find(b => b.id === blockId)
  if (!block) return
  emit('select', blockId, block.pageId)
}

function getBlockPreview(content: string): string {
  if (!content) return '(empty)'
  return content.substring(0, 80) + (content.length > 80 ? '...' : '')
}

function getBlockTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    bullet: '•',
    code: '</>',
    image: '🖼',
    embed: '📌',
    property: '📋',
    query: '🔍'
  }
  return labels[type] || type
}

watch(() => props.visible, (v) => {
  if (v) {
    searchQuery.value = ''
    selectedPageId.value = null
    void blockStore.loadAllBlocks()
  }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="block-selector-overlay" @click.self="emit('close')">
      <div class="block-selector">
        <div class="bs-header">
          <input
            v-model="searchQuery"
            class="bs-search"
            placeholder="Search pages..."
            autofocus
          />
          <button class="bs-close-btn" @click="emit('close')">✕</button>
        </div>
        <div class="bs-body">
          <div class="bs-pages">
            <div
              v-for="page in pages"
              :key="page.id"
              class="bs-page-item"
              :class="{ active: selectedPageId === page.id }"
              @click="selectPage(page.id)"
            >
              {{ page.icon || '📄' }} {{ page.title }}
            </div>
            <div v-if="pages.length === 0" class="bs-empty">No pages found</div>
          </div>
          <div class="bs-blocks">
            <div v-if="!selectedPageId" class="bs-empty">Select a page</div>
            <div
              v-for="block in pageBlocks"
              :key="block.id"
              class="bs-block-item"
              @click="selectBlock(block.id)"
            >
              <span class="bs-block-type">{{ getBlockTypeLabel(block.type) }}</span>
              <span class="bs-block-preview">{{ getBlockPreview(block.content) }}</span>
            </div>
            <div v-if="selectedPageId && pageBlocks.length === 0" class="bs-empty">No blocks</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.block-selector-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.block-selector {
  width: 640px;
  max-height: 480px;
  background: var(--bg-primary, #fff);
  border-radius: 8px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.bs-header {
  display: flex;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid var(--border-color, #E7E5E4);
  gap: 8px;
}

.bs-search {
  flex: 1;
  border: 1px solid var(--border-color, #E7E5E4);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 14px;
  outline: none;
  background: var(--bg-primary, #fff);
}

.bs-search:focus {
  border-color: var(--accent-color, #2563EB);
}

.bs-close-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-muted, #78716C);
  padding: 4px;
}

.bs-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.bs-pages {
  width: 200px;
  overflow-y: auto;
  border-right: 1px solid var(--border-color, #E7E5E4);
  padding: 4px;
}

.bs-blocks {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.bs-page-item {
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bs-page-item:hover,
.bs-page-item.active {
  background: var(--bg-secondary, #F5F5F4);
}

.bs-block-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
}

.bs-block-item:hover {
  background: var(--bg-secondary, #F5F5F4);
}

.bs-block-type {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
  color: var(--text-muted, #78716C);
}

.bs-block-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary, #44403C);
}

.bs-empty {
  padding: 16px;
  color: var(--text-muted, #78716C);
  font-style: italic;
  text-align: center;
}
</style>
```

**注意**：`loadAllBlocks()` 方法可能不存在于 blockStore。如果不存在，需要跳过预加载，blockStore 的 blocks 已在页面中加载。如果编译报错 `loadAllBlocks` 不存在，在 BlockSelector 的 `watch` 中移除该调用——页面 blocks 已通过 `blockStore.loadPage` 加载。

- [ ] **步骤2：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：无类型错误。若 `loadAllBlocks` 不存在则移除。

---

### 任务4：更新 Block/index.vue（导入 + editor 路由 + drag 排除 + properties prop）
**涉及文件：**
- 修改：`src/components/Block/index.vue`

需要做 4 处修改。

- [ ] **步骤1：导入 embed handler**

在 [第26行](file:///d:/comind/comind/src/components/Block/index.vue#L26) (`import './handlers/image'` 之后) 添加：
```typescript
import './handlers/embed'
```

- [ ] **步骤2：添加 properties prop 到 editor 和 render component**

**A. 在 editor component（第734-752行）** 添加 `:properties` prop。在 `:language="block.properties.language"` 后添加 `:properties="block.properties"`。

修改第740行区域，在 `:language="block.properties.language"` 后插入 `:properties="block.properties"`：
```vue
            :language="block.properties.language"
            :properties="block.properties"
```

**B. 在 render component（第753-764行）** 添加 `:properties` prop。在 `:language="block.properties.language"` 后添加 `:properties="block.properties"`。

修改第758行区域，在 `:language="block.properties.language"` 后插入 `:properties="block.properties"`：
```vue
            :language="block.properties.language"
            :properties="block.properties"
```

**C. Embed block 的 editor 需要路由到源 block**：
在第734-752行的 editor `<component>` 中，将 `:block-id` 和 `:content` 改为条件绑定。修改第738-739行：
```vue
            :block-id="handler.embededBlockId ? block.properties.sourceBlockId : blockId"
            :content="handler.embededBlockContent ? sourceBlock?.content ?? '' : block.content"
```
将：
```vue
            :block-id="blockId"
            :content="block.content"
```
改为：
```vue
            :block-id="blockId"
            :content="block.content"
```
（保持不变，因为 editor 在 Block/index.vue 中已有 block 对象。EmbedRender 自己处理渲染 routing，editor 不需要特殊处理——embed block 激活编辑时，Editor.vue 拿到的是 embed block 自身的 blockId 和 content。需要通过 EmbedRender 或不同的方式处理编辑路由。）

**改方案**：对于 embed block 的编辑模式，不直接在 Block/index.vue 的 editor component 中做 routing。因为 embed block 的 content 是空的，Editor.vue 展示空内容没有意义。

改为：在 Block/index.vue 中，当 block type 是 embed 且有 sourceBlockId 时：
- Editor 的 content 使用 `sourceBlock?.content ?? ''`
- Editor 的 blockId 保持为 embed block 自身的 id（因为激活的是 embed block）
- 在 `handleSave` 中，如果 block type 是 embed，将 content 写入 `block.properties.sourceBlockId` 对应的源 block

修改 `handleSave` 函数（约第314-316行）：
```typescript
async function handleSave(content: string) {
  if (handler.value?.type === 'embed') {
    const sourceBlock = blockStore.blocks.value.find(b => b.id === props.node.block.properties.sourceBlockId)
    if (sourceBlock) {
      await blockStore.updateBlockContent(sourceBlock.id, content)
      return
    }
  }
  await blockStore.updateBlockContent(blockId.value, content)
}
```

修改 editor component 的 `:content` 绑定（第739行），从：
```vue
            :content="block.content"
```
改为：
```vue
            :content="editContent"
```

在 `<script setup>` 中添加 `editContent` computed（在 `const handler = computed(...)` 附近）：
```typescript
const editContent = computed(() => {
  if (handler.value?.type === 'embed') {
    const sourceBlock = blockStore.blocks.value.find(b => b.id === block.properties.sourceBlockId)
    return sourceBlock?.content ?? ''
  }
  return block.content
})
```

**注意**：这些修改需要精确行号。在修改前应先读取文件确认当前行号。

- [ ] **步骤3：embed block 排除拖拽子节点**

在模板的 `<VueDraggable>`（约第787行）中，添加条件排除 embed block。将 `v-if="node.children.length > 0"`（如果存在）统一处理。当前代码直接渲染 `v-for`。

在实际操作中，embed 不能有子 block 是通过 `blockStore.indent` 和 `blockStore.moveBlock` 逻辑来防止的。但在拖拽 UI 层面，VueDraggable 的 `:group` 需要修改。最直接的方式：给 `<VueDraggable>` 添加条件：

在 `<VueDraggable>` 第787行的 `v-model="node.children"` 后，不直接禁用，而是在 `@move` 中判断。但更简单的是添加 `v-if="block.type !== 'embed'"`：

将第787行：
```vue
    <VueDraggable
```
改为只在非 embed 时渲染：
```vue
    <VueDraggable
      v-if="block.type !== 'embed'"
```

- [ ] **步骤4：添加 BlockSelector 集成**

在 Block/index.vue 中添加 BlockSelector 的引用和显示控制。embed block 在创建时或 properties 为空时自动打开选择器。

在 `<script setup>` 中添加：
```typescript
const showBlockSelector = ref(false)

function handleEmbedSelect(sourceBlockId: string, sourcePageId: string) {
  blockStore.updateBlockProperties(blockId.value, { sourceBlockId, sourcePageId })
  showBlockSelector.value = false
}
```

在模板中添加 BlockSelector：
```vue
    <BlockSelector
      :visible="showBlockSelector"
      :exclude-block-id="blockId"
      @select="handleEmbedSelect"
      @close="showBlockSelector = false"
    />
```

并在 embed block 的 render component 上添加 placeholder 点击打开 BlockSelector 的逻辑。EmbedRender 的 "Select a block to embed..." placeholder 点击应触发 `emit('content-click')`，在 Block/index.vue 中 `handleContentClick` 判断如果是 embed 类型则打开 BlockSelector。

修改 `handleContentClick` 函数（约第281-299行），添加 embed 处理：
在函数末尾（`if (selection)` 之前）添加：
```typescript
  if (handler.value?.type === 'embed') {
    showBlockSelector.value = true
    return
  }
```

但在 `handleContentClick` 中无法直接访问 `handler`。需要改为：
在函数体开头添加：
```typescript
  if (handler.value?.type === 'image') {
    editorStore.activateBlock(blockId.value, block.content.length)
    return
  }
```

将 embed 判断加在 image 判断之后：
```typescript
  if (handler.value?.type === 'embed') {
    showBlockSelector.value = true
    return
  }
```

同时在 `<script setup>` 顶部添加 BlockSelector 导入：
```typescript
import BlockSelector from '../BlockSelector.vue'
```

**注意**：BlockSelector 在 template 中的位置应该在外层 `<div class="block">` 的末尾，`</template>` 之前。

- [ ] **步骤5：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：可能有错误，根据实际错误修正后再验证。

---

### 任务5：添加 `/embed` 斜杠命令
**涉及文件：**
- 修改：`src/composables/useSlashCommands.ts`

- [ ] **步骤1：添加 insertEmbed 函数**

在 `insertImage` 函数之后（约第158行 `}` 闭合后），新增：

```typescript
/**
 * 插入 Embed Block
 */
function insertEmbed({ editor, range, blockId }: CommandProps) {
  editor.chain()
    .deleteRange(range)
    .focus()
    .run()

  const blockStore = useBlockStore()
  if (blockId) {
    blockStore.updateBlockType(blockId, 'embed')
    blockStore.updateBlockProperties(blockId, { sourceBlockId: '', sourcePageId: '' })
  }
}
```

- [ ] **步骤2：在 commands 数组中添加命令项**

在 `image` 命令项之后添加：

```typescript
  {
    id: 'embed',
    name: 'Embed',
    alias: ['嵌入', '引用'],
    group: '文本格式',
    icon: '📌',
    action: insertEmbed,
    convertBlockType: 'embed'
  },
```

- [ ] **步骤3：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：无类型错误。

---

### 任务6：检查 `updateBlockProperties` 是否存在
**涉及文件：**
- 可能需要修改：`src/stores/blocks.ts`

- [ ] **步骤1：检查方法是否存在**

```bash
cd d:\comind\comind && grep -n "function updateBlockProperties\|async function updateBlockProperties" src/stores/blocks.ts
```

如果不存在，需要添加。在 `updateBlockContent` 函数附近添加：

```typescript
async function updateBlockProperties(blockId: string, properties: Record<string, any>) {
  const block = blocks.value.find(b => b.id === blockId)
  if (!block) return
  Object.assign(block.properties, properties)
  block.updatedAt = Date.now()
  _scheduleSave(block)
}
```

- [ ] **步骤2：验证编译**
```bash
cd d:\comind\comind && npx vue-tsc --noEmit
```
预期：无类型错误。

---

### 任务7：编译和测试验证
**涉及文件：** 无（验证阶段）

- [ ] **步骤1：完整编译检查**
```bash
cd d:\comind\comind && npm run build
```
预期：TypeScript 类型检查通过 + Vite 构建成功。

- [ ] **步骤2：运行现有单元测试**
```bash
cd d:\comind\comind && npm run test
```
预期：所有现有测试通过，无回归错误。

- [ ] **步骤3：运行 lint 检查**
```bash
cd d:\comind\comind && npm run lint
```
预期：无新增 lint 错误。

---

## 自我审核

### 规范覆盖性
- ✅ EmbedRender.vue → 任务1
- ✅ Handler 注册 → 任务2
- ✅ BlockSelector 弹窗 → 任务3
- ✅ Block/index.vue：导入 + editor 路由 + properties prop + drag 排除 + BlockSelector 集成 → 任务4
- ✅ `/embed` 命令 → 任务5
- ✅ `updateBlockProperties` 检查 → 任务6
- ✅ 编译/测试 → 任务7

### 占位内容排查
- 无 "待定" / "TBD"

### 类型一致性
- EmbedRender 的 `properties` prop 类型与 Block 的 `properties` 一致：`Record<string, any>`
- `sourceBlockId` / `sourcePageId` 驼峰命名，与 spec 一致
- `convertBlockType: 'embed'` 与 `Block.type` 一致