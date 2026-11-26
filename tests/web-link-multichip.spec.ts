/**
 * 块内不止「一个光秃秃的 chip」时，悬浮条各项仍必须作用在目标 chip 上（ADR-0067）。
 *
 * 服务层曾经一律用 `webLinkChipOnly()` 拿 chip —— 那个函数要求「整块恰一个 chip、
 * 前后无文本」，于是块里只要有前/后文字或第二个 chip，改链接 / 切文本视图 / 切卡片
 * **全部静默失效**（弹窗正常关闭，内容一个字节没改）。编辑态不中招是因为它走
 * `replaceActiveChip`（按 url+标题扫文档），所以只测编辑态的那几条看不见这个洞。
 *
 * 定位口径已统一成 `findWebLinkChip(content, { url, title })`。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-multichip.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(800)
  await page.locator('.block').first().click()
  await wait(300)
}

/** 打一行内容后失焦：非编辑态才会走 store 路径（编辑态走 replaceActiveChip） */
async function typeAndBlur(page: Page, text: string) {
  await page.keyboard.insertText(text)
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)
}

async function chips(page: Page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.web-link-chip'))
    .map(el => ({ url: el.getAttribute('data-chip-url'), text: el.textContent })))
}

async function openEditOn(page: Page, index: number) {
  await page.locator('.web-link-chip').nth(index).hover()
  await wait(400)
  await page.locator('.wl-toolbar-btn', { hasText: '编辑链接' }).click()
  await expect(page.locator('.wl-edit')).toBeVisible()
}

async function pickView(page: Page, index: number, label: string) {
  await page.locator('.web-link-chip').nth(index).hover()
  await wait(400)
  await page.locator('.wl-toolbar-view > button').click()
  await wait(250)
  await expect(page.locator('.wl-toolbar-menu')).toBeVisible()
  await page.locator('.wl-toolbar-menu-item', { hasText: label }).click()
  await wait(1200)
}

test('chip 前面有普通文本：编辑链接仍然生效', async ({ page }) => {
  await boot(page)
  await typeAndBlur(page, '前缀文字 [豆包](https://www.doubao.com)')

  await openEditOn(page, 0)
  await page.locator('.wl-edit-input').nth(1).fill('https://www.baidu.com')
  await page.locator('.wl-edit-confirm').click()
  await wait(800)

  const after = await chips(page)
  expect(after).toHaveLength(1)
  expect(after[0].url).toBe('https://www.baidu.com')
  // 前缀文字不能被吃掉
  const firstBlock = await page.locator('.block').first().textContent()
  expect(firstBlock).toContain('前缀文字')
})

test('两个 chip：只改被点的那个', async ({ page }) => {
  await boot(page)
  await typeAndBlur(page, '[甲](https://a.example.com) 与 [乙](https://b.example.com)')

  await openEditOn(page, 1)
  await page.locator('.wl-edit-input').nth(1).fill('https://changed.example.com')
  await page.locator('.wl-edit-confirm').click()
  await wait(800)

  const after = await chips(page)
  expect(after.map(c => c.url)).toEqual(['https://a.example.com', 'https://changed.example.com'])
})

test('两个 chip：非编辑态切链接视图只影响目标 chip', async ({ page }) => {
  await boot(page)
  await typeAndBlur(page, '[甲](https://a.example.com) 与 [乙](https://b.example.com)')

  await pickView(page, 1, '链接视图')

  const after = await chips(page)
  expect(after[0].text).toBe('甲')
  expect(after[1].text).toBe('https://b.example.com')
})

test('两个 chip：把第二个切成卡片，前后文本拆成独立块不丢', async ({ page }) => {
  await boot(page)
  await typeAndBlur(page, '[甲](https://a.example.com) 与 [乙](https://b.example.com)')

  await pickView(page, 1, '卡片视图')

  const after = await chips(page)
  // 原块留下第一个 chip，被切的 chip 变卡片
  expect(after.map(c => c.text)).toEqual(['甲'])
  await expect(page.locator('.web-link.is-card')).toHaveCount(1)
  const prose = await page.locator('.block').first().textContent()
  expect(prose).toContain('与')
})
