# Concept Block 实施方案
> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：实现 Concept Block 类型，支持折叠式四区卡片展示、内联编辑、/concept 命令触发
**架构**：复用现有 Block 类型系统，Concept Block 作为特殊的 `type: 'concept'` 块，四个子区域作为其 `parentId` 关联的子块；非激活时渲染为 ConceptRender 组件，激活时子块转为普通编辑态
**技术栈**：Vue 3, TypeScript, Scss, Tiptap（复用现有）

---

## 核心约定
- **Concept Block 的四个子类型**：`concept-definition`、`concept-boundary`、`concept-comparison`、`concept-example`
- **子块创建顺序**：创建 Concept Block 后，立即按顺序创建四个子块作为子节点
- **折叠状态存储**：每个 Concept Block 的 `format.conceptCollapsed` 记录各区域的折叠状态
- **边界内容格式**：`concept-boundary` 子块使用 `---` 分隔外延与禁区，例如：
  ```
  纯函数设计
  不可变数据流
  声明式数据处理
  ---
  "用函数写代码"≠FP
  函数式≠性能差
  不等同于Haskell
  ```

---

## 任务清单

### 任务 1：扩展 Block.type 类型定义
**涉及文件：**
- 修改：`src/types/block.ts`

- [ ] **步骤 1：更新 Block.type 联合类型**
  ```typescript
  // src/types/block.ts - Line 8
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image' | 'concept' | 'concept-definition' | 'concept-boundary' | 'concept-comparison' | 'concept-example'
  ```

---

### 任务 2：创建 Concept Block Handler 注册文件
**涉及文件：**
- 新建：`src/components/Block/handlers/concept/index.ts`

- [ ] **步骤 1：编写 handler 注册代码**
  ```typescript
  // src/components/Block/handlers/concept/index.ts
  import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
  import Editor from '../../../Editor.vue'
  import ConceptRender from './ConceptRender.vue'

  const { register } = useBlockRegistry()

  // 主 Concept Block
  register({
    type: 'concept',
    label: 'Concept',
    editorComponent: Editor,
    renderComponent: ConceptRender
  })

  // 四个子区域（用普通 bullet 编辑，无需自定义渲染）
  register({
    type: 'concept-definition',
    label: 'Concept Definition',
    editorComponent: Editor,
    renderComponent: Editor
  })

  register({
    type: 'concept-boundary',
    label: 'Concept Boundary',
    editorComponent: Editor,
    renderComponent: Editor
  })

  register({
    type: 'concept-comparison',
    label: 'Concept Comparison',
    editorComponent: Editor,
    renderComponent: Editor
  })

  register({
    type: 'concept-example',
    label: 'Concept Example',
    editorComponent: Editor,
    renderComponent: Editor
  })
  ```

---

### 任务 3：创建 ConceptRender 展示组件
**涉及文件：**
- 新建：`src/components/Block/handlers/concept/ConceptRender.vue`

- [ ] **步骤 1：编写 ConceptRender.vue 完整代码**
  ```vue
  <script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useBlockStore } from '../../../../stores/blocks'
  import ConceptSection from './ConceptSection.vue'
  import type { Block } from '../../../../types/block'

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

  // 获取当前 Concept Block ID（通过查找 parentId 为 null、type=concept、content 匹配的块）
  const conceptBlockId = computed(() => {
    const allBlocks = blockStore.blocks
    const match = allBlocks.find(
      b => b.type === 'concept' && b.content === props.content
    )
    return match?.id || ''
  })

  // 获取四个子块
  const childrenBlocks = computed(() => {
    const parentId = conceptBlockId.value
    if (!parentId) return []
    return blockStore.blocks
      .filter(b => b.parentId === parentId)
      .sort((a, b) => a.pos - b.pos)
  })

  // 按类型查找各子块
  const definitionBlock = computed(() => childrenBlocks.value.find(b => b.type === 'concept-definition'))
  const boundaryBlock = computed(() => childrenBlocks.value.find(b => b.type === 'concept-boundary'))
  const comparisonBlock = computed(() => childrenBlocks.value.find(b => b.type === 'concept-comparison'))
  const exampleBlock = computed(() => childrenBlocks.value.find(b => b.type === 'concept-example'))

  // 折叠状态存储在 conceptBlock.format.conceptCollapsed
  const conceptBlock = computed(() =>
    blockStore.blocks.find(b => b.id === conceptBlockId.value)
  )

  const collapsedState = computed(() => {
    const format = conceptBlock.value?.format?.conceptCollapsed || {}
    return {
      definition: format.definition ?? false,
      boundary: format.boundary ?? false,
      comparison: format.comparison ?? false,
      example: format.example ?? false
    }
  })

  function toggleSection(section: keyof typeof collapsedState.value) {
    const block = conceptBlock.value
    if (!block) return
    const newFormat = { ...block.format }
    if (!newFormat.conceptCollapsed) {
      newFormat.conceptCollapsed = {}
    }
    newFormat.conceptCollapsed[section] = !newFormat.conceptCollapsed[section]
    blockStore.updateBlockFormat(block.id, newFormat)
  }

  // 解析 boundary 内容：用 --- 分隔
  function parseBoundaryContent(content: string) {
    const parts = content.split('---')
    const extension = parts[0]?.trim() || ''
    const forbidden = parts[1]?.trim() || ''
    return { extension, forbidden }
  }

  // 解析 comparison 内容：按空行分隔成左右对比
  function parseComparisonContent(content: string) {
    const parts = content.split('\n\n')
    const left = parts[0]?.trim() || ''
    const right = parts[1]?.trim() || ''
    return { left, right }
  }

  // 解析 example 内容：按空行分隔成正向实例和落地用法
  function parseExampleContent(content: string) {
    const parts = content.split('\n\n')
    const examples = parts[0]?.trim() || ''
    const usage = parts[1]?.trim() || ''
    return { examples, usage }
  }
  </script>

  <template>
    <div class="concept-block" @mousedown.stop @click="emit('content-click', $event)">
      <template v-if="!content && showPlaceholder">
        <div class="concept-placeholder">概念名称...</div>
      </template>
      <template v-else>
        <div class="concept-header">
          <div class="concept-icon">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="white">
              <circle cx="8" cy="8" r="3" />
              <circle cx="8" cy="8" r="6.5" stroke="white" stroke-width="1.2" stroke-dasharray="2 2" fill="none" />
            </svg>
          </div>
          <div class="concept-title">{{ content || '未命名概念' }}</div>
          <div class="concept-tag">概念</div>
        </div>

        <!-- 01. 核心定义 -->
        <ConceptSection
          section="definition"
          :collapsed="collapsedState.definition"
          label="01 · 核心定义"
          label-color="#D97706"
          @toggle="toggleSection('definition')"
        >
          <div class="definition-content">
            <div class="definition-quote">
              {{ definitionBlock?.content || '一句话抓本质...' }}
            </div>
          </div>
        </ConceptSection>

        <!-- 02. 边界范围 -->
        <ConceptSection
          section="boundary"
          :collapsed="collapsedState.boundary"
          label="02 · 边界范围"
          label-color="#059669"
          @toggle="toggleSection('boundary')"
        >
          <div class="boundary-content">
            <div class="boundary-extension">
              <div class="boundary-label">✓ 外延</div>
              <div class="boundary-text">
                {{ parseBoundaryContent(boundaryBlock?.content || '').extension || '包含哪些事物...' }}
              </div>
            </div>
            <div class="boundary-forbidden">
              <div class="boundary-label">✗ 禁区</div>
              <div class="boundary-text">
                {{ parseBoundaryContent(boundaryBlock?.content || '').forbidden || '哪些不属于该概念...' }}
              </div>
            </div>
          </div>
        </ConceptSection>

        <!-- 03. 对标辨析 -->
        <ConceptSection
          section="comparison"
          :collapsed="collapsedState.comparison"
          label="03 · 对标辨析"
          label-color="#6366F1"
          @toggle="toggleSection('comparison')"
        >
          <div class="comparison-content">
            <div class="comparison-left">
              {{ parseComparisonContent(comparisonBlock?.content || '').left || '左侧对比...' }}
            </div>
            <div class="comparison-vs">VS</div>
            <div class="comparison-right">
              {{ parseComparisonContent(comparisonBlock?.content || '').right || '右侧对比...' }}
            </div>
          </div>
        </ConceptSection>

        <!-- 04. 实例与应用 -->
        <ConceptSection
          section="example"
          :collapsed="collapsedState.example"
          label="04 · 实例与应用"
          label-color="#7C3AED"
          @toggle="toggleSection('example')"
        >
          <div class="example-content">
            <div class="example-examples">
              <div class="example-label">正向实例</div>
              <div class="example-text">
                {{ parseExampleContent(exampleBlock?.content || '').examples || '2-3个正向实例...' }}
              </div>
            </div>
            <div class="example-usage">
              <div class="example-label">落地用法</div>
              <div class="example-text">
                {{ parseExampleContent(exampleBlock?.content || '').usage || '现实中什么时候用...' }}
              </div>
            </div>
          </div>
        </ConceptSection>
      </template>
    </div>
  </template>

  <style scoped>
  .concept-block {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }

  .concept-placeholder {
    color: var(--text-tertiary);
    font-style: italic;
    padding: 12px 16px;
  }

  .concept-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px 10px;
    border-bottom: 1px solid var(--border);
  }

  .concept-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: linear-gradient(135deg, #6366F1, #818CF8);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .concept-title {
    flex: 1;
    min-width: 0;
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .concept-tag {
    font-size: 10px;
    color: #6366F1;
    background: rgba(99, 102, 241, 0.08);
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 500;
  }

  /* 定义区域 */
  .definition-content {
    padding: 0;
  }

  .definition-quote {
    border-left: 3px solid #6366F1;
    padding: 10px 14px;
    background: rgba(99, 102, 241, 0.04);
    border-radius: 0 6px 6px 0;
    font-size: 14px;
    line-height: 1.7;
    color: var(--text-primary);
  }

  /* 边界区域 */
  .boundary-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .boundary-extension {
    background: rgba(5, 150, 105, 0.05);
    border: 1px solid rgba(5, 150, 105, 0.15);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .boundary-forbidden {
    background: rgba(220, 38, 38, 0.04);
    border: 1px solid rgba(220, 38, 38, 0.12);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .boundary-label {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .boundary-extension .boundary-label {
    color: #059669;
  }

  .boundary-forbidden .boundary-label {
    color: #DC2626;
  }

  .boundary-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-line;
  }

  /* 对比区域 */
  .comparison-content {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }

  .comparison-left {
    flex: 1;
    background: rgba(99, 102, 241, 0.08);
    border-radius: 6px;
    padding: 8px 12px;
    text-align: center;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-primary);
  }

  .comparison-vs {
    display: flex;
    align-items: center;
    font-size: 10px;
    color: var(--text-tertiary);
    font-weight: 500;
  }

  .comparison-right {
    flex: 1;
    background: rgba(217, 119, 6, 0.06);
    border-radius: 6px;
    padding: 8px 12px;
    text-align: center;
    font-size: 12px;
    line-height: 1.6;
    color: var(--text-primary);
  }

  /* 实例区域 */
  .example-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .example-examples {
    background: rgba(124, 58, 237, 0.05);
    border: 1px solid rgba(124, 58, 237, 0.12);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .example-usage {
    background: rgba(99, 102, 241, 0.04);
    border: 1px solid rgba(99, 102, 241, 0.10);
    border-radius: 6px;
    padding: 10px 12px;
  }

  .example-label {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 4px;
  }

  .example-examples .example-label {
    color: #7C3AED;
  }

  .example-usage .example-label {
    color: #6366F1;
  }

  .example-text {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    white-space: pre-line;
  }
  </style>
  ```

---

### 任务 4：创建 ConceptSection 折叠组件
**涉及文件：**
- 新建：`src/components/Block/handlers/concept/ConceptSection.vue`

- [ ] **步骤 1：编写 ConceptSection.vue 完整代码**
  ```vue
  <script setup lang="ts">
  import { computed } from 'vue'

  const props = defineProps<{
    section: string
    collapsed: boolean
    label: string
    labelColor: string
  }>()

  const emit = defineEmits<{
    (e: 'toggle'): void
  }>()

  function handleToggle() {
    emit('toggle')
  }
  </script>

  <template>
    <div class="concept-section">
      <div class="concept-section-header" @click="handleToggle">
        <div class="concept-section-label" :style="{ color: labelColor }">
          {{ label }}
        </div>
        <div class="concept-section-toggle" :class="{ collapsed }">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
      <div class="concept-section-body" :class="{ collapsed }">
        <slot />
      </div>
    </div>
  </template>

  <style scoped>
  .concept-section {
    border-bottom: 1px solid var(--border);
  }

  .concept-section:last-child {
    border-bottom: none;
  }

  .concept-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 6px;
    cursor: pointer;
    user-select: none;
  }

  .concept-section-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .concept-section-toggle {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary);
    transition: transform 0.15s ease;
  }

  .concept-section-toggle.collapsed {
    transform: rotate(-90deg);
  }

  .concept-section-body {
    padding: 0 16px 10px;
    overflow: hidden;
    transition: max-height 0.2s ease, opacity 0.2s ease;
    max-height: 1000px;
    opacity: 1;
  }

  .concept-section-body.collapsed {
    max-height: 0;
    opacity: 0;
    padding-top: 0;
    padding-bottom: 0;
  }
  </style>
  ```

---

### 任务 5：添加 /concept 斜杠命令
**涉及文件：**
- 修改：`src/composables/useSlashCommands.ts`

- [ ] **步骤 1：在 commands 数组中添加 concept 命令**
  ```typescript
  // src/composables/useSlashCommands.ts - 在 commands 数组中添加（建议放在 "embed" 命令后面）
  {
    id: 'concept',
    name: 'Concept',
    alias: ['概念', 'concept-block'],
    group: '文本格式',
    icon: '🧠',
    action: insertConcept,
    convertBlockType: 'concept'
  }
  ```

- [ ] **步骤 2：实现 insertConcept 函数（放在 insertEmbed 函数后面）**
  ```typescript
  // src/composables/useSlashCommands.ts - 在 insertEmbed 之后添加
  /**
   * 插入 Concept Block，并创建四个子区域
   */
  async function insertConcept({ editor, range, blockId }: { editor: any, range: { from: number, to: number }, blockId?: string }) {
    if (!blockId) return

    // 1. 清除斜杠命令文本
    editor.chain()
      .deleteRange(range)
      .focus()
      .run()

    const blockStore = useBlockStore()
    const editorStore = useEditorStore()

    // 2. 转换当前 Block 为 concept 类型
    await blockStore.updateBlockType(blockId, 'concept')

    // 3. 创建四个子块
    const anchor = blockStore.blocks.find(b => b.id === blockId)
    if (!anchor) return

    const pageId = anchor.pageId

    // 定义子块配置
    const childConfigs = [
      { type: 'concept-definition', content: '一句话抓本质...', posOffset: 1 },
      { type: 'concept-boundary', content: '包含哪些事物...\n---\n哪些不属于该概念...', posOffset: 2 },
      { type: 'concept-comparison', content: '左侧对比...\n\n右侧对比...', posOffset: 3 },
      { type: 'concept-example', content: '2-3个正向实例...\n\n现实中什么时候用...', posOffset: 4 }
    ]

    // 按倒序插入，保证 pos 递增
    const newChildIds: string[] = []
    for (let i = childConfigs.length - 1; i >= 0; i--) {
      const config = childConfigs[i]
      const child = await blockStore.createBlock({
        pageId,
        parentId: blockId,
        pos: anchor.pos + config.posOffset * 1000,
        content: config.content,
        type: config.type
      })
      newChildIds.unshift(child.id)
    }

    // 4. 激活第一个子块（definition）
    if (newChildIds.length > 0) {
      await nextTick()
      editorStore.activateBlock(newChildIds[0], 1)
    }
  }
  ```

- [ ] **步骤 3：添加 nextTick 导入**
  ```typescript
  // src/composables/useSlashCommands.ts - 在文件顶部添加
  import { nextTick } from 'vue'
  ```

---

### 任务 6：添加概念块样式
**涉及文件：**
- 修改：`src/styles/components/_block.scss`

- [ ] **步骤 1：在 _block.scss 文件末尾添加概念块样式**
  ```scss
  // src/styles/components/_block.scss - 在文件末尾添加
  /* Concept Block styles */
  .block[data-type="concept"] {
    .concept-block {
      margin: 4px 0;
    }
  }
  ```

---

### 任务 7：在 Block/index.vue 中导入 concept handler
**涉及文件：**
- 修改：`src/components/Block/index.vue`

- [ ] **步骤 1：添加 concept handler 导入**
  ```typescript
  // src/components/Block/index.vue - 在其他 handler 导入之后添加
  import './handlers/concept'
  ```

---

### 任务 8：确保 updateBlockFormat 存在（如果缺失则补充）
**涉及文件：**
- 修改：`src/stores/blocks.ts`

- [ ] **步骤 1：检查并添加 updateBlockFormat 函数**
  先检查该函数是否存在，如果不存在则添加：
  ```typescript
  // src/stores/blocks.ts - 在 updateBlockProperties 后面添加
  async function updateBlockFormat(blockId: string, format: Record<string, any>) {
    const block = blocks.value.find(b => b.id === blockId)
    if (!block) return

    block.format = { ...block.format, ...format }
    block.updatedAt = Date.now()
    _scheduleSave(block)
    structureVersion.value++
  }

  // 同时在 return 中导出
  return {
    // ... 现有导出项 ...
    updateBlockFormat,
    // ...
  }
  ```

---

## 验收测试
- [ ] 输入 `/concept` 创建 Concept Block，自动生成四个子区域
- [ ] 编辑概念名称和各区域内容
- [ ] 切换到其他块后，四个区域以折叠式卡片展示
- [ ] 点击区域标题可独立折叠/展开
- [ ] 再次点击激活编辑模式，内容正确显示
- [ ] 运行 `npm run build` 无类型错误
- [ ] 运行 `npm run test` 通过

---

## 自我审核清单
- [x] 所有任务均有完整代码，无占位符
- [x] 复用现有 Block 系统，未引入新数据表
- [x] 符合现有代码风格和架构
- [x] 考虑了深色/浅色主题（使用 CSS 变量）
- [x] 折叠状态持久化到 Block.format
