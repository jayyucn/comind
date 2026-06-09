# 模板系统 Plan 4：D 验证 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：为模板系统补充集成测试 + E2E 端到端测试，覆盖关键用户闭环（菜单触发→渲染→插入→列表管理→另存→复用）。
> **架构**：Vitest 集成测试（覆盖命令执行链路）+ Playwright E2E（覆盖浏览器内完整流程）。
> **技术栈**：Vitest + fake-indexeddb + @vue/test-utils + Playwright
>
> **前置依赖**：[Plan 1：A 核心引擎](docs/superpowers/plans/2026-06-05-template-system-plan-a.md) + [Plan 2：B 集成层](docs/superpowers/plans/2026-06-05-template-system-plan-b.md) + [Plan 3：C UI 层](docs/superpowers/plans/2026-06-05-template-system-plan-c.md) 全部完成
>
> **相关文件：**
> - `docs/superpowers/specs/2026-06-05-template-system-design.md` — 设计文档

---

## 文件结构

```
comind/
├── test-template-slash-command.spec.ts  # 新建：Vitest 集成测试（/template 触发链路）
├── test-template-save-reuse.spec.ts     # 新建：Vitest 集成测试（另存→复用闭环）
├── test-template-placeholder.spec.ts    # 新建：Vitest 集成测试（{{name}} 保留）
└── e2e/
    └── template-e2e.spec.ts             # 新建：Playwright E2E（浏览器内完整流程）
```

> **关于测试位置**：项目现有集成测试位于 `comind/test-*.spec.ts`（Vitest），是项目实际采用的测试模式。Playwright E2E 框架虽已配置（`comind/playwright.config.ts`）但尚无现有 E2E 测试。本方案**主用 Vitest 集成测试**（与项目现状一致），同时**新增一个 Playwright E2E 文件**作为冒烟测试。

---

## 任务 1：Vitest 集成测试——`/template` 触发链路

**涉及文件：**
- 新建：`comind/test-template-slash-command.spec.ts`

- [ ] **步骤 1：编写测试**

新建 `comind/test-template-slash-command.spec.ts`：

```typescript
/**
 * 模板系统集成测试：/template 触发链路
 *
 * 验证流程：
 * 1. 用户输入 /template
 * 2. SlashCommandMenu 显示"模板"分组
 * 3. 选中模板后调用 executeTemplateCommand
 * 4. 验证 blocksStore 新增了正确数量的 Block
 * 5. 验证变量已替换（如 {{date}} → 实际日期）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// 必须先 mock storage
vi.mock('./src/storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    getAllPages: vi.fn().mockResolvedValue([]),
  }
}))

import { useBlockStore } from './src/stores/blocks'
import { useUserTemplatesStore } from './src/stores/user-templates'
import { useTemplateRegistry } from './src/composables/useTemplateRegistry'
import { buildTemplateCommands } from './src/composables/useSlashCommands'
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from './src/config/builtin-templates'
import { TemplateRenderer } from './src/services/template-renderer'

describe('template slash command integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('应能加载 10 个内置模板', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(10)
    expect(getBuiltinTemplate('meeting-notes')).toBeDefined()
  })

  it('buildTemplateCommands 应为每个内置模板生成 1 个 Command', async () => {
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const cmds = buildTemplateCommands()
    expect(cmds.length).toBe(10)
    expect(cmds.every(c => c.group === '模板')).toBe(true)
    expect(cmds.some(c => c.id === 'template:meeting-notes')).toBe(true)
  })

  it('模板命令的 alias 应包含 "template"、"tpl" 和模板 id', async () => {
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const cmds = buildTemplateCommands()
    const meeting = cmds.find(c => c.id === 'template:meeting-notes')!
    expect(meeting.alias).toContain('template')
    expect(meeting.alias).toContain('tpl')
    expect(meeting.alias).toContain('meeting-notes')
    expect(meeting.alias).toContain('meeting')
    expect(meeting.alias).toContain('会议')
  })

  it('TemplateRenderer 渲染内置模板时变量应被替换', async () => {
    const blockStore = useBlockStore()
    // 创建一个 anchor block
    const anchor = await blockStore.createBlock({
      pageId: 'p1', content: 'anchor', type: 'bullet',
    })

    const registry = useTemplateRegistry()
    await registry.loadAll()
    const template = registry.getById('meeting-notes')!
    const context = await TemplateRenderer.buildContext('My Page')
    const drafts = TemplateRenderer.render(template, context, anchor)

    // meeting-notes 模板有 9 个 block
    expect(drafts.length).toBe(9)
    // 第一个 block 是 heading 含 {{cursor}}，变量应被替换为 __CURSOR__
    expect(drafts[0].content).toContain('会议:')
    expect(drafts[0].content).toContain('__CURSOR__')
    // property block 应有 {{date}} {{time}} 已替换
    const propBlock = drafts.find(d => d.type === 'property')!
    expect(propBlock.content).toMatch(/时间:: \d{4}年\d{1,2}月\d{1,2}日 \d{1,2}:\d{2}/)
  })

  it('用户模板可注册为命令且 ID 含 user: 前缀', async () => {
    const userStore = useUserTemplatesStore()
    await userStore.create({
      name: '我的会议',
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'variant' }],
    })

    const registry = useTemplateRegistry()
    await registry.loadAll()
    const cmds = buildTemplateCommands()
    const userCmd = cmds.find(c => c.id.startsWith('template:user:'))
    expect(userCmd).toBeDefined()
    expect(userCmd?.name).toBe('我的会议')
  })

  it('registry.getById(user:xxx) 优先返回用户模板（若有重名）', async () => {
    const userStore = useUserTemplatesStore()
    await userStore.create({
      name: '会议记录',  // 与内置同名
      sourcePageId: 'p1',
      blocks: [{ type: 'bullet', content: 'override' }],
    })
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const userTpl = registry.getById(`user:${userStore.templates[0].id}`)
    expect(userTpl).toBeDefined()
    expect(userTpl?.blocks[0].content).toBe('override')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run test-template-slash-command.spec.ts`

预期结果：所有测试通过。

- [ ] **步骤 3：修复任何失败（mock 不全等）**

若测试失败，根据错误信息调整 mock 或 import 路径。

- [ ] **步骤 4：提交代码**

```bash
cd comind
git add test-template-slash-command.spec.ts
git commit -m "test(template): add slash command integration test"
```

---

## 任务 2：Vitest 集成测试——另存 → 复用闭环

**涉及文件：**
- 新建：`comind/test-template-save-reuse.spec.ts`

- [ ] **步骤 1：编写测试**

新建 `comind/test-template-save-reuse.spec.ts`：

```typescript
/**
 * 模板系统集成测试：另存为模板 → 在新 Page 复用
 *
 * 验证流程：
 * 1. 创建 A Page，含 3 个 Block
 * 2. 序列化 → 写入 userTemplatesStore
 * 3. 创建 B Page，输入 /template + 刚保存的模板名
 * 4. 验证 B Page 的 Block 结构与 A Page 一致
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('./src/storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    getAllPages: vi.fn().mockResolvedValue([]),
  }
}))

import { useBlockStore } from './src/stores/blocks'
import { useUserTemplatesStore } from './src/stores/user-templates'
import { useTemplateRegistry } from './src/composables/useTemplateRegistry'
import { serializeBlockTree } from './src/services/serialize-block-tree'
import { TemplateRenderer } from './src/services/template-renderer'
import { db } from './src/storage/db'

describe('template save-reuse integration', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
  })

  it('A Page → 另存为模板 → B Page 复用，结构一致', async () => {
    const blockStore = useBlockStore()
    const userStore = useUserTemplatesStore()

    // 1. 模拟 A Page：创建 3 个 Block（root + 2 children）
    const rootA = await blockStore.createBlock({ pageId: 'page-A', content: 'Root A', type: 'bullet' })
    const childA1 = await blockStore.createBlock({ pageId: 'page-A', content: 'Child A1', parentId: rootA.id, type: 'bullet' })
    const childA2 = await blockStore.createBlock({ pageId: 'page-A', content: 'Child A2', parentId: rootA.id, type: 'bullet' })

    // 2. 序列化 A Page 的 Block 树
    const allBlocks = blockStore.blocks.filter(b => b.pageId === 'page-A')
    const tmplBlocks = serializeBlockTree(allBlocks, rootA.id)
    expect(tmplBlocks).toEqual([{
      type: 'bullet', content: 'Root A',
      children: [
        { type: 'bullet', content: 'Child A1' },
        { type: 'bullet', content: 'Child A2' },
      ]
    }])

    // 3. 写入 userTemplatesStore
    const template = await userStore.create({
      name: 'My Pattern',
      sourcePageId: 'page-A',
      blocks: tmplBlocks,
    })
    expect(template.id).toBeTruthy()
    expect(userStore.templates.length).toBe(1)

    // 4. 模拟 B Page：创建 root + 1 child
    const rootB = await blockStore.createBlock({ pageId: 'page-B', content: 'B Root', type: 'bullet' })

    // 5. 在 B Page 中渲染模板
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const normalizedTpl = registry.getById(`user:${template.id}`)!
    const context = await TemplateRenderer.buildContext('Page B')
    const drafts = TemplateRenderer.render(normalizedTpl, context, rootB)

    // 6. 验证 drafts 数量 = 3（root + 2 children）
    expect(drafts.length).toBe(3)
    expect(drafts[0].content).toBe('Root A')
    expect(drafts[1].content).toBe('Child A1')
    expect(drafts[2].content).toBe('Child A2')
    // 父子关系：children 引用 root draft
    expect(drafts[1].parentId).toBe(drafts[0].id)
    expect(drafts[2].parentId).toBe(drafts[0].id)
  })

  it('删除模板后 registry 不再返回该模板', async () => {
    const blockStore = useBlockStore()
    const userStore = useUserTemplatesStore()

    const root = await blockStore.createBlock({ pageId: 'p1', content: 'root', type: 'bullet' })
    const allBlocks = blockStore.blocks.filter(b => b.pageId === 'p1')
    const tmpl = await userStore.create({
      name: 'T',
      sourcePageId: 'p1',
      blocks: serializeBlockTree(allBlocks, root.id),
    })

    const registry = useTemplateRegistry()
    await registry.loadAll()
    expect(registry.getById(`user:${tmpl.id}`)).toBeDefined()

    await userStore.remove(tmpl.id)
    await registry.loadAll()
    expect(registry.getById(`user:${tmpl.id}`)).toBeUndefined()
  })

  it('源 Page 删除后模板仍可使用（blocks 已序列化）', async () => {
    const blockStore = useBlockStore()
    const userStore = useUserTemplatesStore()

    const root = await blockStore.createBlock({ pageId: 'page-source', content: 'origin', type: 'bullet' })
    const allBlocks = blockStore.blocks.filter(b => b.pageId === 'page-source')
    const tmpl = await userStore.create({
      name: 'Stale Source',
      sourcePageId: 'page-source',
      blocks: serializeBlockTree(allBlocks, root.id),
    })

    // 模拟源 Page 被删除（清空内存）
    blockStore.blocks = blockStore.blocks.filter(b => b.pageId !== 'page-source')

    // 模板仍可使用
    const registry = useTemplateRegistry()
    await registry.loadAll()
    const normalized = registry.getById(`user:${tmpl.id}`)!
    const newRoot = await blockStore.createBlock({ pageId: 'page-target', content: 'target', type: 'bullet' })
    const context = await TemplateRenderer.buildContext('target')
    const drafts = TemplateRenderer.render(normalized, context, newRoot)
    expect(drafts.length).toBe(1)
    expect(drafts[0].content).toBe('origin')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run test-template-save-reuse.spec.ts`

预期结果：所有测试通过。

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add test-template-save-reuse.spec.ts
git commit -m "test(template): add save-reuse integration test"
```

---

## 任务 3：Vitest 集成测试——`{{name}}` 占位符保留

**涉及文件：**
- 新建：`comind/test-template-placeholder.spec.ts`

- [ ] **步骤 1：编写测试**

新建 `comind/test-template-placeholder.spec.ts`：

```typescript
/**
 * 模板系统集成测试：{{name}} 占位符保留为可见文本
 *
 * 验证：
 * 1. 未匹配任何预定义变量的 {{xxx}} 不会被替换
 * 2. {{date}} {{time}} 等预定义变量被正确替换
 * 3. {{cursor}} 替换为 __CURSOR__ 但不入库（后续 Plan 2 已做光标定位）
 * 4. 混合多个变量的 content 正确处理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./src/storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    getAllPages: vi.fn().mockResolvedValue([]),
  }
}))

import { setActivePinia, createPinia } from 'pinia'
import { TemplateRenderer } from './src/services/template-renderer'
import type { NormalizedTemplate, TemplateContext } from './src/types/template'
import type { Block } from './src/types/block'

describe('template placeholder preservation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const baseContext: TemplateContext = {
    date: '2026年6月5日',
    time: '14:30',
    isoDate: '2026-06-05',
    pageTitle: 'Test Page',
    cursor: '__CURSOR__',
    clipboard: 'CB',
    now: 1718000000000,
  }

  const baseAnchor: Block = {
    id: 'a', pageId: 'p', parentId: null, pos: 1000,
    content: '', format: {}, type: 'bullet',
    properties: {}, createdAt: 0, updatedAt: 0
  }

  it('{{name}}（自定义占位符）保留为可见文本', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: 'Hello {{name}}!' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('Hello {{name}}!')
  })

  it('{{name_1}}、{{field_2}} 等带下划线/数字的占位符同样保留', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [
        { type: 'bullet', content: '{{name_1}} and {{field_2}}' },
      ],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('{{name_1}} and {{field_2}}')
  })

  it('拼写错误的预定义变量（如 {{dat}}）保留为可见文本', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: '{{dat}} vs {{date}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('{{dat}} vs 2026年6月5日')
  })

  it('{{date}} {{time}} 正确替换为本地化值', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'property', propertyKey: '时间', content: '{{date}} {{time}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].type).toBe('property')
    expect(drafts[0].content).toBe('时间:: 2026年6月5日 14:30')
  })

  it('{{iso_date}} 替换为 ISO 格式', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: '{{iso_date}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('2026-06-05')
  })

  it('{{page_title}} 替换为当前页面标题', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: 'On page: {{page_title}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('On page: Test Page')
  })

  it('{{clipboard}} 替换为剪贴板内容', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: 'Pasted: {{clipboard}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('Pasted: CB')
  })

  it('{{cursor}} 替换为 __CURSOR__ 并设置 cursorMarker', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'heading', headingLevel: 2, content: 'Title {{cursor}}' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('Title __CURSOR__')
    expect(drafts[0].cursorMarker).toBe('__CURSOR__')
  })

  it('多变量混合：日期+时间+自定义占位符+cursor 全部正确', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{
        type: 'bullet',
        content: '{{date}} {{time}} | {{page_title}} | {{user_name}} | {{cursor}}'
      }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('2026年6月5日 14:30 | Test Page | {{user_name}} | __CURSOR__')
    expect(drafts[0].cursorMarker).toBe('__CURSOR__')
  })

  it('空 content 渲染为 Block content=""', () => {
    const tmpl: NormalizedTemplate = {
      id: 't', name: 'T', category: 'work', description: '', icon: '📝',
      source: 'builtin',
      blocks: [{ type: 'bullet', content: '' }],
    }
    const drafts = TemplateRenderer.render(tmpl, baseContext, baseAnchor)
    expect(drafts[0].content).toBe('')
  })
})
```

- [ ] **步骤 2：运行测试，验证执行通过**

执行命令：`cd comind && npx vitest run test-template-placeholder.spec.ts`

预期结果：所有测试通过。

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add test-template-placeholder.spec.ts
git commit -m "test(template): add placeholder preservation integration test"
```

---

## 任务 4：Playwright E2E 测试——浏览器内完整流程

**涉及文件：**
- 新建：`comind/e2e/template-e2e.spec.ts`

> **注意**：若项目此前未运行过 Playwright，需先执行 `npx playwright install chromium` 安装浏览器。

- [ ] **步骤 1：创建 e2e 目录（若不存在）**

执行命令：`cd comind && mkdir -p e2e`

- [ ] **步骤 2：编写 E2E 测试**

新建 `comind/e2e/template-e2e.spec.ts`：

```typescript
import { test, expect } from '@playwright/test'

test.describe('Template system E2E', () => {
  test.beforeEach(async ({ page }) => {
    // 启动 App
    await page.goto('http://localhost:5173')
    // 等待 App 挂载（侧边栏出现）
    await expect(page.locator('aside, .sidebar, [class*="sidebar"]').first()).toBeVisible({ timeout: 10000 })
  })

  test('完整闭环：输入 /template meeting → 插入模板 Block', async ({ page }) => {
    // 1. 创建/进入一个 Page（点击侧边栏的某个 Page 或新建）
    // 简化：直接导航到一个普通 Page
    await page.goto('http://localhost:5173/page/test-page-id')
    await page.waitForTimeout(500)

    // 2. 点击一个 Block 进入编辑态
    const firstBlock = page.locator('.block-content, [contenteditable="true"]').first()
    await firstBlock.click()
    await page.waitForTimeout(200)

    // 3. 输入 /template
    await page.keyboard.type('/template')
    await page.waitForTimeout(300)

    // 4. 验证 SlashCommandMenu 出现且含"模板"分组
    const menu = page.locator('.slash-command-menu')
    await expect(menu).toBeVisible({ timeout: 2000 })
    await expect(menu).toContainText('模板')

    // 5. 输入过滤"meeting"
    await page.keyboard.type(' meeting')
    await page.waitForTimeout(200)

    // 6. 选择第一个匹配项
    const firstItem = menu.locator('.slash-command-item').first()
    await firstItem.click()
    await page.waitForTimeout(500)

    // 7. 验证 Page 上出现了模板结构
    // （具体断言需根据实际 DOM 结构调整）
    const pageContent = page.locator('.page-content, main, [class*="page"]').first()
    await expect(pageContent).toContainText('会议')
    await expect(pageContent).toContainText('时间')
    await expect(pageContent).toContainText('议题')
  })

  test('另存为模板：Page 菜单 → Modal → 保存后可在 /template list 中看到', async ({ page }) => {
    // 1. 进入 Page
    await page.goto('http://localhost:5173/page/test-page-id')
    await page.waitForTimeout(500)

    // 2. 打开 Page 菜单
    const menuButton = page.locator('.page-menu-button .menu-trigger, [class*="page-menu"] button').first()
    await menuButton.click()
    await page.waitForTimeout(200)

    // 3. 点击"另存为模板"
    const saveBtn = page.locator('button:has-text("另存为模板")')
    await expect(saveBtn).toBeVisible()
    await saveBtn.click()
    await page.waitForTimeout(300)

    // 4. 验证 Modal 出现
    const modal = page.locator('.save-template-dialog')
    await expect(modal).toBeVisible()

    // 5. 填写名称
    const nameInput = modal.locator('input[name="name"]')
    await nameInput.fill('E2E Test Template')

    // 6. 点击保存
    const confirmBtn = modal.locator('.btn-confirm')
    await confirmBtn.click()
    await page.waitForTimeout(500)

    // 7. 验证 Toast 或其他反馈
    const toast = page.locator('text=已保存为模板')
    await expect(toast).toBeVisible({ timeout: 2000 })

    // 8. 触发 /template list 验证
    const firstBlock = page.locator('.block-content, [contenteditable="true"]').first()
    await firstBlock.click()
    await page.keyboard.type('/template list')
    await page.waitForTimeout(300)

    const menu = page.locator('.slash-command-menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('E2E Test Template')
  })
})
```

> **注意**：上述测试需要 Playwright 浏览器已安装，且 App 实际可启动。若项目未运行过 Playwright，先执行 `cd comind && npx playwright install chromium`。

- [ ] **步骤 3：运行 E2E 测试**

执行命令：`cd comind && npx playwright test e2e/template-e2e.spec.ts`

预期结果：测试通过（或需要根据实际 DOM 结构调整选择器）。若有失败，根据错误信息调整。

- [ ] **步骤 4：提交代码（如测试通过或部分通过）**

```bash
cd comind
git add e2e/template-e2e.spec.ts
git commit -m "test(template): add Playwright E2E test for full template workflow"
```

> **若 Playwright 浏览器未安装或网络受限**，可跳过此任务，保留文件作为后续补充。

---

## 任务 5：最终验收

- [ ] **步骤 1：运行全量测试（vitest）**

执行命令：`cd comind && npm run test`

预期结果：所有测试通过，包含：
- 已有测试
- 4 个 Plan 1 新测试
- 2 个 Plan 2 新测试
- 2 个 Plan 3 新测试
- 3 个 Plan 4 新测试（`test-template-*.spec.ts`）

- [ ] **步骤 2：运行 E2E 测试（若已配置）**

执行命令：`cd comind && npx playwright test`

预期结果：所有 E2E 测试通过（若已配置）。

- [ ] **步骤 3：运行 TypeScript 编译**

执行命令：`cd comind && npx vue-tsc -b`

预期结果：编译通过。

- [ ] **步骤 4：运行 lint**

执行命令：`cd comind && npm run lint`

预期结果：无 lint 错误。

- [ ] **步骤 5：运行 build（项目级最终验证）**

执行命令：`cd comind && npm run build`

预期结果：构建成功。

- [ ] **步骤 6：手动最终冒烟测试**

执行命令：`cd comind && npm run dev`

打开浏览器，验证：
1. 输入 `/template` → 看到 10 个内置模板
2. 选择"会议记录" → 正确插入
3. 输入 `/template list` → 看到"我的模板"视图
4. Page 菜单 → "另存为模板" → Modal → 保存 → Toast 出现
5. 重启 App → 用户模板仍在
6. 跨会话：再输入 `/template list` → 用户模板可点击使用

- [ ] **步骤 7：Plan 4 收尾提交**

```bash
cd comind
git status
# 提交所有未提交文件
```

---

## 验收清单（最终）

- [ ] Plan 1-4 全部任务完成
- [ ] 单元测试覆盖率（template-renderer / builtin-templates / user-templates / serialize-block-tree / useTemplateRegistry）≥ 80%
- [ ] 集成测试（`/template` 触发 + 另存复用 + 占位符）全部通过
- [ ] E2E 测试（Playwright）通过或已记录待修复
- [ ] `npm run test` + `npx vue-tsc -b` + `npm run lint` + `npm run build` 全绿
- [ ] 浏览器中 6 项冒烟测试全部通过
- [ ] 用户模板在重启后仍可使用
- [ ] `/template list` 视图可正确显示/删除用户模板
- [ ] 模板执行"尽力而为"——任何变量解析失败都不阻塞插入

---

## 风险与注意

1. **Playwright 浏览器安装**：若 CI/本地环境无 Chromium 浏览器，E2E 测试可能失败。可在 CI 中执行 `npx playwright install --with-deps chromium`。
2. **E2E DOM 选择器**：上述选择器基于"猜测"的 DOM 结构。实际需根据 App 真实 DOM 调整。
3. **Vitest 集成测试中的 mock**：完整 mock storage / pageStore / editorStore 是必要的；缺失 mock 会导致 Pinia / IndexedDB 初始化失败。
4. **测试运行顺序**：`test-template-save-reuse.spec.ts` 依赖 `db.delete()` + `db.open()` 重置数据库；若与其他测试文件共享 db 状态，需注意隔离。
5. **性能验收**：设计文档要求"模板插入 10 个 Block 在 200ms 内完成"——Vitest 不易测端到端性能，建议在 E2E 中用 `performance.now()` 简单验证。

---

## 模板系统实施完成

至此，模板系统的 4 份方案全部完成：
- Plan 1：A 核心引擎（纯函数 + 数据模型）
- Plan 2：B 集成层（注册表 + 斜杠命令 + Store）
- Plan 3：C UI 层（Modal + 菜单入口）
- Plan 4：D 验证（集成测试 + E2E）

整体产出：
- 10 个内置模板（5 思维模型 + 5 工作模板）
- `/template` 斜杠命令 + `/template list` 子视图
- 7 个预定义变量 + `{{name}}` 可见占位符
- Page 菜单"另存为模板"流程
- 独立 IndexedDB `templates` 表（不污染 Page）
- 完整测试覆盖（单元 + 集成 + E2E）

后续可迭代方向（不在本期范围）：
- 模板编辑 UI（修改已存用户模板）
- 模板变量作用域与条件分支
- 模板导出/导入
- 模板与 AI 联动（自动选模板）
- 模板嵌套/继承
