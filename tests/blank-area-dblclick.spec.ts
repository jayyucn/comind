/**
 * 页面留白双击不选词（ADR-0070 D7 补丁）。
 *
 * 症状：在块列表两侧空白双击，浏览器就近选词，选中页面标题 / 「反向链接」的「反向」。
 * 不变量：
 * - 双击页面留白（两侧 / 标题行右侧）→ 选区为空；
 * - 双击标题、块内文字 → 原生选词照旧（防过拦）。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/blank-area-dblclick.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(800)
}

async function selectionText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? '')
}

test('双击块列表两侧留白不选中任何文本', async ({ page }) => {
  await boot(page)

  const geo = await page.evaluate(() => {
    const list = document.querySelector('.block-root-list')!.getBoundingClientRect()
    const title = document.querySelector('.page-title')!.getBoundingClientRect()
    return {
      listLeft: list.x,
      listRight: list.right,
      listY: list.y + 60,
      titleRight: title.right,
      titleY: title.y + title.height / 2,
    }
  })

  // 左侧空白（正文列左侧留白）
  await page.mouse.dblclick(geo.listLeft - 12, geo.listY)
  await wait(150)
  expect(await selectionText(page)).toBe('')

  // 右侧空白（正文列右侧留白）
  await page.mouse.dblclick(geo.listRight + 12, geo.listY)
  await wait(150)
  expect(await selectionText(page)).toBe('')

  // 标题行右侧空白（同一浏览器就近选词路径，曾选中标题）
  await page.mouse.dblclick(geo.titleRight + 120, geo.titleY)
  await wait(150)
  expect(await selectionText(page)).toBe('')
})

test('双击页面标题仍保留原生选词', async ({ page }) => {
  await boot(page)

  const geo = await page.evaluate(() => {
    const title = document.querySelector('.page-title')!.getBoundingClientRect()
    return { x: title.x + 12, y: title.y + title.height / 2 }
  })

  await page.mouse.dblclick(geo.x, geo.y)
  await wait(150)
  expect((await selectionText(page)).length).toBeGreaterThan(0)
})
