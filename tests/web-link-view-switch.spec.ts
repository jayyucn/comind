/**
 * 视图切换（ADR-0067 D2/D4）：悬浮条的四个视图项都必须真的改变展示形态。
 *
 * 覆盖三条曾经失效的路径：
 * - 卡片/预览宿主：宿主块的离场定时器把悬浮条抽走 ⇒ 下拉点不开；
 * - chip 宿主：「链接视图/标题视图」只是别名字面，曾经直接 return，点了没反应；
 * - chip → 卡片：原 text 块不删，页面上留一份重复的 chip。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-view-switch.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(300)
}

async function state(page: Page) {
  return page.evaluate(() => ({
    chips: Array.from(document.querySelectorAll('.web-link-chip:not(.pm-prefix-hidden)'))
      .map(el => el.textContent ?? ''),
    cards: document.querySelectorAll('.web-link.is-card').length,
    previews: document.querySelectorAll('.web-link.is-preview').length,
    menu: document.querySelectorAll('.wl-toolbar-menu').length,
  }))
}

/** 悬浮宿主 → 展开视图下拉 → 点某一项 */
async function pickView(page: Page, host: string, label: string) {
  await page.locator(host).first().hover()
  await wait(400)
  await page.locator('.wl-toolbar-view > button').click()
  await wait(250)
  // 下拉真的开着才点得着（宿主定时器抽走面板时这里会先失败）
  await expect(page.locator('.wl-toolbar-menu')).toBeVisible()
  await page.locator('.wl-toolbar-menu-item', { hasText: label }).click()
  await wait(1200)
}

test('四项视图在 chip 与卡片之间都能切换', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  expect((await state(page)).chips).toEqual(['飞书文档'])

  await pickView(page, '.web-link-chip', '链接视图')
  expect((await state(page)).chips).toEqual(['https://www.feishu.cn/docx/abc'])

  await pickView(page, '.web-link-chip', '标题视图')
  expect((await state(page)).chips).toEqual(['feishu.cn'])

  await pickView(page, '.web-link-chip', '卡片视图')
  const card = await state(page)
  expect(card.cards).toBe(1)
  // 原 text 块不能留下重复的 chip
  expect(card.chips).toEqual([])

  await pickView(page, '.web-link.is-card', '预览视图')
  expect((await state(page)).previews).toBe(1)

  await pickView(page, '.web-link.is-preview', '链接视图')
  expect((await state(page)).chips).toEqual(['https://www.feishu.cn/docx/abc'])
})

test('编辑态切视图后不被编辑器回写覆盖', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(500)

  await pickView(page, '.ProseMirror .web-link-chip:not(.pm-prefix-hidden)', '链接视图')
  expect((await state(page)).chips).toEqual(['https://www.feishu.cn/docx/abc'])

  // 继续打字再失焦：防抖回写不能把别名改回去
  await page.locator('.ProseMirror').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type('尾注')
  await wait(600)
  await page.keyboard.press('Escape')
  await wait(600)
  expect((await state(page)).chips).toEqual(['https://www.feishu.cn/docx/abc'])
})
