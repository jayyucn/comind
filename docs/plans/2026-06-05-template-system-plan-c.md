# 模板系统 Plan 3：C UI 层 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：实现"另存为模板"Modal 与 Page 菜单入口；完成用户可见的 UI 流程闭环。
> **架构**：Page 菜单触发 → SaveAsTemplateModal 收集元数据 → 序列化当前 Page Block 树 → userTemplatesStore.create → Toast 反馈。
> **技术栈**：Vue 3 + TypeScript + Pinia + Vitest
>
> **前置依赖**：[Plan 1：A 核心引擎](docs/superpowers/plans/2026-06-05-template-system-plan-a.md) + [Plan 2：B 集成层](docs/superpowers/plans/2026-06-05-template-system-plan-b.md) 全部完成
>
> **相关文件：**
> - `docs/superpowers/specs/2026-06-05-template-system-design.md` — 设计文档
> - `docs/superpowers/plans/2026-06-05-template-system-plan-d.md` — 验证

---

## 文件结构

```
src/components/Template/
├── SaveAsTemplateModal.vue            # 新建：另存为模板 Modal
└── __tests__/
    └── SaveAsTemplateModal.test.ts    # 新建

src/components/Page/
├── PageMenuButton.vue                 # 修改：新增"另存为模板"入口
└── index.vue                          # 不修改（Modal 触发后无需挂载到此处）
```

---

## 任务 1：实现 `SaveAsTemplateModal.vue`

**涉及文件：**
- 新建：`comind/src/components/Template/SaveAsTemplateModal.vue`
- 新建：`comind/src/components/Template/__tests__/SaveAsTemplateModal.test.ts`

- [ ] **步骤 1：编写失败测试**

新建 `comind/src/components/Template/__tests__/SaveAsTemplateModal.test.ts`：

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'  // 视项目实际 i18n 情况调整
import SaveAsTemplateModal from '../SaveAsTemplateModal.vue'

// Mock 依赖
vi.mock('../../../composables/useTemplateRegistry', () => ({
  useTemplateRegistry: () => ({
    loadAll: vi.fn().mockResolvedValue(undefined),
    all: { value: [] },
  })
}))

vi.mock('../../../services/serialize-block-tree', () => ({
  serializeBlockTree: vi.fn().mockReturnValue([{ type: 'bullet', content: 'test' }])
}))

describe('SaveAsTemplateModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('visible=false 时不渲染', () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: false, pageId: 'p1' }
    })
    expect(wrapper.find('.save-template-overlay').exists()).toBe(false)
  })

  test('visible=true 时渲染 Modal', async () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    await flushPromises()
    expect(wrapper.find('.save-template-overlay').exists()).toBe(true)
    expect(wrapper.find('input[name="name"]').exists()).toBe(true)
  })

  test('默认名称为空，name 输入框为空', () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    const nameInput = wrapper.find('input[name="name"]')
    expect((nameInput.element as HTMLInputElement).value).toBe('')
  })

  test('点击取消触发 cancel 事件', async () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    await wrapper.find('.btn-cancel').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  test('名称为空时保存按钮禁用', async () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    const btn = wrapper.find('.btn-confirm')
    expect((btn.element as HTMLButtonElement).disabled).toBe(true)
  })

  test('名称非空时保存按钮启用', async () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    await wrapper.find('input[name="name"]').setValue('My Template')
    const btn = wrapper.find('.btn-confirm')
    expect((btn.element as HTMLButtonElement).disabled).toBe(false)
  })

  test('点击保存触发 confirm 事件并传递表单数据', async () => {
    const wrapper = mount(SaveAsTemplateModal, {
      props: { visible: true, pageId: 'p1' }
    })
    await wrapper.find('input[name="name"]').setValue('My Template')
    await wrapper.find('input[name="category"]').setValue('work')
    await wrapper.find('textarea[name="description"]').setValue('A test template')
    await wrapper.find('.btn-confirm').trigger('click')
    await flushPromises()
    const events = wrapper.emitted('confirm')
    expect(events).toBeTruthy()
    expect(events![0][0]).toMatchObject({
      name: 'My Template',
      category: 'work',
      description: 'A test template',
      pageId: 'p1',
    })
  })
})
```

> **注**：若项目无 vue-i18n 集成，移除 i18n 相关 import；本测试不依赖具体 i18n。

- [ ] **步骤 2：运行测试，验证执行失败**

执行命令：`cd comind && npx vitest run src/components/Template/__tests__/SaveAsTemplateModal.test.ts`

预期结果：测试因 `Cannot find module '../SaveAsTemplateModal.vue'` 失败。

- [ ] **步骤 3：实现 `SaveAsTemplateModal.vue`**

新建 `comind/src/components/Template/SaveAsTemplateModal.vue`：

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUserTemplatesStore } from '../../stores/user-templates'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'
import { serializeBlockTree } from '../../services/serialize-block-tree'

const props = defineProps<{
  visible: boolean
  pageId: string
}>()

const emit = defineEmits<{
  (e: 'confirm', payload: {
    name: string
    description: string
    category: string
    pageId: string
  }): void
  (e: 'cancel'): void
}>()

const name = ref('')
const description = ref('')
const category = ref('custom')
const error = ref('')
const submitting = ref(false)

const userTemplatesStore = useUserTemplatesStore()
const blockStore = useBlockStore()
const pageStore = usePageStore()

// 打开时重置表单（若 visible 由 false → true）
watch(() => props.visible, (isVisible) => {
  if (isVisible) {
    // 默认名称 = 当前页面标题
    const page = pageStore.getPage(props.pageId)
    name.value = page?.title ?? ''
    description.value = ''
    category.value = 'custom'
    error.value = ''
    submitting.value = false
  }
})

const isNameValid = () => name.value.trim().length > 0

async function handleConfirm() {
  if (!isNameValid() || submitting.value) return
  submitting.value = true
  error.value = ''

  try {
    // 1. 获取当前页面的所有 Block
    const allBlocks = blockStore.blocks
    const pageBlocks = allBlocks.filter(b => b.pageId === props.pageId)

    // 2. 找到根 Block（page.blockId 指向根 Block）
    const page = pageStore.getPage(props.pageId)
    if (!page) {
      error.value = '页面不存在'
      submitting.value = false
      return
    }
    const rootBlock = pageBlocks.find(b => b.id === page.blockId)
    if (!rootBlock) {
      error.value = '页面根 Block 不存在'
      submitting.value = false
      return
    }

    // 3. 序列化为 TemplateBlock 树
    const tmplBlocks = serializeBlockTree(pageBlocks, rootBlock.id)

    // 4. 写入 userTemplatesStore
    await userTemplatesStore.create({
      name: name.value.trim(),
      description: description.value.trim() || undefined,
      category: category.value.trim() || 'custom',
      sourcePageId: props.pageId,
      blocks: tmplBlocks,
    })

    // 5. 触发 confirm 事件
    emit('confirm', {
      name: name.value.trim(),
      description: description.value.trim(),
      category: category.value.trim() || 'custom',
      pageId: props.pageId,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败'
  } finally {
    submitting.value = false
  }
}

function handleCancel() {
  if (submitting.value) return
  emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="save-template-overlay" @click.self="handleCancel">
        <div class="save-template-dialog">
          <div class="save-template-title">另存为模板</div>
          <div class="save-template-desc">将此页面的 Block 结构保存为可复用的模板。</div>

          <div class="form-field">
            <label>名称 <span class="required">*</span></label>
            <input
              v-model="name"
              name="name"
              type="text"
              placeholder="例：会议记录 v2"
              maxlength="50"
              :disabled="submitting"
            />
          </div>

          <div class="form-field">
            <label>分类</label>
            <input
              v-model="category"
              name="category"
              type="text"
              placeholder="例：work / custom"
              maxlength="30"
              :disabled="submitting"
            />
          </div>

          <div class="form-field">
            <label>描述（可选）</label>
            <textarea
              v-model="description"
              name="description"
              placeholder="一句话说明这个模板的用途"
              maxlength="200"
              rows="2"
              :disabled="submitting"
            />
          </div>

          <div v-if="error" class="form-error">{{ error }}</div>

          <div class="form-actions">
            <button class="btn-cancel" :disabled="submitting" @click="handleCancel">取消</button>
            <button
              class="btn-confirm"
              :disabled="!isNameValid() || submitting"
              @click="handleConfirm"
            >
              {{ submitting ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.save-template-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay, rgba(0, 0, 0, 0.4));
  backdrop-filter: blur(4px);
}

.save-template-dialog {
  background: var(--color-paper, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 12px;
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
  box-shadow: var(--shadow-modal, 0 10px 40px rgba(0, 0, 0, 0.15));
}

.save-template-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink, #111827);
  margin-bottom: 4px;
}

.save-template-desc {
  font-size: 13px;
  color: var(--color-ink-secondary, #6b7280);
  margin-bottom: 20px;
}

.form-field {
  margin-bottom: 14px;
}

.form-field label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-ink, #111827);
  margin-bottom: 6px;
}

.required {
  color: var(--error, #ef4444);
}

.form-field input,
.form-field textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--color-border, #e5e7eb);
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  background: var(--color-bg, #fff);
  color: var(--color-ink, #111827);
  box-sizing: border-box;
}

.form-field input:focus,
.form-field textarea:focus {
  outline: none;
  border-color: var(--color-accent, #1890ff);
  box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
}

.form-field input:disabled,
.form-field textarea:disabled {
  background: var(--color-bg-muted, #f3f4f6);
  cursor: not-allowed;
}

.form-error {
  font-size: 12px;
  color: var(--error, #ef4444);
  margin-bottom: 12px;
  padding: 6px 10px;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 4px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.btn-cancel {
  padding: 7px 16px;
  background: transparent;
  color: var(--color-ink-secondary, #6b7280);
  border: 1px solid var(--color-border-light, #e5e7eb);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-cancel:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
}

.btn-confirm {
  padding: 7px 16px;
  background: var(--color-accent, #1890ff);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  transition: background 120ms ease;
}

.btn-confirm:hover:not(:disabled) {
  background: var(--color-accent-deep, #096dd9);
}

.btn-confirm:disabled,
.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 180ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **步骤 4：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run src/components/Template/__tests__/SaveAsTemplateModal.test.ts`

预期结果：所有测试通过（注意：若 `usePageStore` 或 `useBlockStore` 在测试环境下访问 IndexedDB 失败，可能需要 mock 简化；如有需要，在测试文件顶部添加 `vi.mock('../../../stores/blocks')` 等）。

- [ ] **步骤 5：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/components/Template/SaveAsTemplateModal.vue`

预期结果：无 lint 错误。

- [ ] **步骤 6：提交代码**

```bash
cd comind
git add src/components/Template/SaveAsTemplateModal.vue src/components/Template/__tests__/SaveAsTemplateModal.test.ts
git commit -m "feat(template): add SaveAsTemplateModal component"
```

---

## 任务 2：在 `PageMenuButton.vue` 中添加"另存为模板"入口

**涉及文件：**
- 修改：`comind/src/components/PageMenuButton.vue`

- [ ] **步骤 1：在 setup 中引入 SaveAsTemplateModal 与状态**

在 `comind/src/components/PageMenuButton.vue` 的 `<script setup>` 顶部追加 import：

```ts
import SaveAsTemplateModal from '../Template/SaveAsTemplateModal.vue'
```

在 setup 内（在 `const showPermanentDeleteConfirm = ref(false)` 之后）添加：

```ts
const showSaveAsTemplate = ref(false)
```

- [ ] **步骤 2：添加 handler 函数**

在 `handleNavigateToSettings` 函数之后追加：

```ts
function handleOpenSaveAsTemplate() {
  closeMenu()
  if (!currentPage.value) return
  showSaveAsTemplate.value = true
}
```

- [ ] **步骤 3：在模板中添加菜单项（"删除本页"divider 之后）**

在 `<div class="menu-divider"></div>` 之后（仍位于 `<template v-if="isOnPage && currentPage">` 块内）插入：

```vue
<button class="menu-item" @click="handleOpenSaveAsTemplate">
  <TaskIcon name="icon-bookmark" :size="16" />
  <span>另存为模板</span>
</button>

<div class="menu-divider"></div>
```

- [ ] **步骤 4：在 template 末尾（ConfirmDialog 之后）挂载 Modal**

在 `<ConfirmDialog ... />` 之后追加：

```vue
<SaveAsTemplateModal
  v-if="currentPage"
  :visible="showSaveAsTemplate"
  :page-id="currentPageId"
  @confirm="handleSaveAsTemplateConfirm"
  @cancel="showSaveAsTemplate = false"
/>
```

- [ ] **步骤 5：实现 handleSaveAsTemplateConfirm**

在 setup 中追加：

```ts
async function handleSaveAsTemplateConfirm() {
  showSaveAsTemplate.value = false
  // 简单的 toast 提示（项目若已有 toast 系统，替换为对应调用）
  // 简化处理：用 alert 作为兜底
  if (typeof window !== 'undefined') {
    // 轻量提示，2 秒后自动消失
    const toast = document.createElement('div')
    toast.textContent = '已保存为模板'
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:10px 20px;border-radius:6px;z-index:9999;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.15);'
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  }
}
```

> **注**：若项目已有 toast composable（如 `useToast`），应替换为对应调用。

- [ ] **步骤 6：运行 TypeScript 编译验证**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过。

- [ ] **步骤 7：运行 lint 验证**

执行命令：`cd comind && npm run lint -- src/components/PageMenuButton.vue`

预期结果：无 lint 错误。

- [ ] **步骤 8：运行全量测试，确保未破坏 PageMenuButton 已有测试**

执行命令：`cd comind && npx vitest run src/components/PageMenuButton`

预期结果：所有 PageMenuButton 相关测试通过。

- [ ] **步骤 9：提交代码**

```bash
cd comind
git add src/components/PageMenuButton.vue
git commit -m "feat(template): add 'Save as template' entry to Page menu"
```

---

## 任务 3：端到端验证（Plan 3 收尾）

- [ ] **步骤 1：运行全量单元测试**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过。

- [ ] **步骤 2：运行 TypeScript 编译**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过。

- [ ] **步骤 3：运行 lint**

执行命令：`cd comind && npm run lint`

预期结果：无 lint 错误。

- [ ] **步骤 4：手动 smoke test（在浏览器中）**

执行命令：`cd comind && npm run dev`

打开浏览器：
1. 进入任一 Page（非 journal 类型）
2. 点击 Page 顶部菜单 → 应出现"另存为模板"按钮
3. 点击 → 应弹出 Modal
4. 输入名称 → 点击"保存"
5. 验证：2 秒后出现"已保存为模板"提示
6. 输入 `/template list` → 应在"我的模板"列表中看到刚保存的模板
7. 点击该模板 → 验证插入的 Block 树与原 Page 一致

- [ ] **步骤 5：Plan 3 收尾提交（如有未提交文件）**

```bash
cd comind
git status
```

---

## 验收清单

- [ ] `SaveAsTemplateModal` 在 visible=false 时不渲染
- [ ] 默认名称 = 当前 Page 标题
- [ ] 名称为空时保存按钮禁用
- [ ] 点击保存触发 confirm 事件，payload 含 name/description/category/pageId
- [ ] Page 菜单中出现"另存为模板"按钮（仅在 normal/system 类型 Page 中显示，journal 隐藏）
- [ ] 提交后出现 2 秒 toast 反馈
- [ ] 提交后 `/template list` 立即显示新模板
- [ ] `npm run test` + `npx vue-tsc -b` + `npm run lint` 全绿

---

## 风险与注意

1. **`page.blockId` 字段**：本方案假设 `Page` 类型有 `blockId` 字段（指向根 Block）。若项目无此字段，需在 Plan 1 之前先补字段，或在序列化时取 `pos` 最小的 Block 作为根。
2. **journal Page 不应可"另存为模板"**：当前实现未过滤 journal 类型。后续可在 PageMenuButton 模板中增加 `v-if="currentPage?.type !== 'journal'"`。
3. **toast 系统简化**：本方案用原生 DOM 创建临时 toast。若项目已有 `useToast` composable，应替换为对应调用。
4. **空 Page 序列化**：若 Page 没有 Block 树（极端情况），`serializeBlockTree` 返回空数组，模板保存后内容为空——属于正常情况，UI 提示"模板内容为空"。

---

## 下一步

本方案产出物供 Plan 4（D 验证）使用：
- 完整的"另存为模板"UI 流程
- Page 菜单的"另存为模板"入口
- 模板创建后用户可立即在 `/template list` 中看到并使用

执行完本方案后，继续 [Plan 4：D 验证](docs/superpowers/plans/2026-06-05-template-system-plan-d.md)。
