/**
 * 段内硬换行（Shift-Enter）与文本样式菜单两行布局的冒烟（临时脚本，不属于回归网）。
 *
 * 运行：`npx playwright test tests/hard-break.spec.ts --reporter=line`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.addInitScript(() => localStorage.setItem('comind-theme', 'light'))
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(800)
}

test('Shift-Enter 的换行在渲染态与再次编辑后都还在', async ({ page }) => {
  await boot(page)
  await page.locator('.block').first().click()
  await wait(250)
  await page.keyboard.type('第一行')
  await page.keyboard.press('Shift+Enter')
  await wait(150)
  await page.keyboard.type('第二行')
  await wait(400)
  await expect(page.locator('.ProseMirror-focused br')).toHaveCount(1)
  await page.locator('.block').first().screenshot({ path: 'test-results/hard-break-editing.png' })

  // 退出编辑 → 渲染态应当仍是两行（依赖 content 里的 `\n` + white-space: pre-wrap）
  await page.keyboard.press('Escape')
  await wait(400)
  const rendered = await page.locator('.block-text').first().textContent()
  expect(rendered).toContain('第一行\n第二行')
  await page.locator('.block').first().screenshot({ path: 'test-results/hard-break-rendered.png' })

  // 再进编辑：content → textToHtml(`\n`→`<br>`) → hardBreak，断行必须没被吞
  await page.locator('.block').first().click()
  await wait(400)
  await expect(page.locator('.ProseMirror-focused br')).toHaveCount(1)
})

test('文本样式菜单分两行：4+3 七格（含「高亮」普通格）', async ({ page }) => {
  await boot(page)
  await page.locator('.block').first().click()
  await wait(250)
  await page.keyboard.type('菜单布局')
  await wait(300)
  await page.keyboard.press('Escape')
  await wait(300)
  const block = page.locator('.block').first()
  await block.hover()
  await wait(150)
  await block.locator('.block-entry-icon').click()
  await wait(300)
  const menu = page.locator('.block-entry-menu')
  const grid = menu.locator('.menu-style-grid')
  await expect(grid.locator('[data-text-style]')).toHaveCount(7)
  // 两行网格：4 列 —— 第一行 4 格（text/h1/h2/h3），第二行 3 格（ol/ul/callout）
  const gridBox = await grid.boundingBox()
  expect(gridBox).not.toBeNull()
  const boxes = []
  for (const el of await grid.locator('[data-text-style]').all()) {
    boxes.push(await el.boundingBox())
  }
  const rowOf = (i: number) => Math.round(boxes[i]!.y / (boxes[i]!.height + 2))
  expect(rowOf(3)).toBe(rowOf(0)) // h3 与 text 同行
  expect(rowOf(4)).toBe(rowOf(0) + 1) // ol 换到第二行
  await expect(grid.locator('[data-text-style="callout"].is-wide')).toHaveCount(0)
  await menu.screenshot({ path: 'test-results/text-style-menu.png' })
})

test('高亮块入口胶囊显示语义字形', async ({ page }) => {
  await boot(page)
  const block = page.locator('.block').first()
  await block.click()
  await wait(250)
  await page.keyboard.type('胶囊字形')
  await wait(300)
  await page.keyboard.press('Escape')
  await wait(300)
  await block.hover()
  await wait(150)
  await block.locator('.block-entry-icon').click()
  await wait(300)
  await page.locator('.block-entry-menu [data-text-style="callout"]').click()
  await wait(400)
  // 壳已挂语义 class；入口胶囊字形 = 语义图标（lucide-vue-next 给 svg 挂 lucide-<名> 类），
  // 不再是被降级的 T（lucide-type）
  const first = page.locator('.block').first()
  await expect(first.locator('.block-content.is-callout-warn')).toHaveCount(1)
  await expect(first.locator('.block-entry-icon svg.lucide-triangle-alert')).toHaveCount(1)
  await expect(first.locator('.block-entry-icon svg.lucide-type')).toHaveCount(0)
  await first.hover()
  await wait(150)
  await first.locator('.block-bullet').screenshot({ path: 'test-results/callout-entry-icon.png' })
})

test('标题与列表带硬换行时样式不塌回普通正文', async ({ page }) => {
  await boot(page)
  const first = page.locator('.block').first()
  await first.click()
  await wait(250)
  await page.keyboard.type('# 标题首行')
  await page.keyboard.press('Shift+Enter')
  await wait(120)
  await page.keyboard.type('标题次行')
  await page.keyboard.press('Enter')
  await wait(350)
  await page.keyboard.type('- 列表首行')
  await page.keyboard.press('Shift+Enter')
  await wait(120)
  await page.keyboard.type('列表次行')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  // 标题：`.block-heading` 存在，且两行都在同一个 h1 里（第 2 行放大 = 装饰范围用 content.size）
  const heading = page.locator('.block').first().locator('.block-heading')
  await expect(heading).toHaveCount(1)
  expect(await heading.textContent()).toContain('标题首行\n标题次行')
  // 列表：标记与两行正文都还在
  const list = page.locator('.block').nth(1).locator('.block-list')
  await expect(list).toHaveCount(1)
  expect(await list.locator('.block-list-text').textContent()).toContain('列表首行\n列表次行')
  await page.locator('.block-list').first().screenshot({ path: 'test-results/hard-break-styles.png' })

  // 进编辑再走一遍：标题前缀不被吞成正文（`# ` 仍被识别）
  await page.locator('.block').first().click()
  await wait(400)
  // 编辑态：正文部分仍被 h1 装饰包住（装饰按文本节点切分，跨硬换行会落到多个 span 上；
  // 首个 `.heading-preview-h1` 是那份零宽隐藏的前缀，不能拿它断言可见）
  await expect(page.locator('.ProseMirror-focused .heading-preview:not(.pm-prefix-hidden)').first())
    .toBeVisible()
})
