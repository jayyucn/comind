/**
 * 键入裸网址即成 chip（ADR-0067 D10）：`https://…` 打完即成链接视图 chip。
 *
 * 覆盖四条曾经踩空/踩坑的路径：
 * - 键入时不转（只有粘贴转）；
 * - URL 里的 `/` 打开斜杠命令面板，模态层随后吞掉 Esc，块退不出编辑态；
 * - 按 End 把光标送进隐藏的 `](url)`，Chromium 把插入符弹回块首，打的字插到链接前面；
 * - 链接末尾打中文标点被并进 URL。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-typing.spec.ts`
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
    editing: document.querySelectorAll('.ProseMirror').length,
    popovers: document.querySelectorAll('.base-popover').length,
    // 编辑态整段字面被拆成三个 span（别名 + 两段零宽隐藏），只取可见那段
    chips: Array.from(document.querySelectorAll('.web-link-chip:not(.pm-prefix-hidden)'))
      .map(el => el.textContent ?? ''),
    texts: Array.from(document.querySelectorAll('.block')).map(el => el.textContent ?? ''),
  }))
}

test('键入网址即成 chip：不弹斜杠菜单，Esc 能退出，读态仍是 chip', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)

  const typing = await state(page)
  expect(typing.popovers).toBe(0)
  // 编辑态只露别名（URL 原文），隐藏的字母面不出现
  expect(typing.texts[0]).toBe('[https://www.doubao.com](https://www.doubao.com)')

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.editing).toBe(0)
  expect(read.texts[0]).toBe('https://www.doubao.com')
})

test('行尾补字落在链接右侧：End 不被弹回块首，标点不进 URL', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.type('，后记', { delay: 30 })
  await wait(400)

  const after = await state(page)
  expect(after.texts[0]).toBe('[https://www.doubao.com](https://www.doubao.com)，后记')

  await page.keyboard.press('Escape')
  await wait(400)
  expect((await state(page)).texts[0]).toBe('https://www.doubao.com，后记')
})

test('句中的网址只包自己，前后文字与中文标点都不动', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('明天看 https://a.com/x，再定', { delay: 30 })
  await wait(500)
  expect((await state(page)).texts[0]).toBe('明天看 [https://a.com/x](https://a.com/x)，再定')

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.texts[0]).toBe('明天看 https://a.com/x，再定')
  expect(read.chips).toEqual(['https://a.com/x'])
})

test('链接视图退格：别名与 URL 两截同步，不会退化成标题视图', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)

  await page.keyboard.press('Backspace')
  await wait(400)
  // 只删别名一截会得到 `[https://www.doubao.co](https://www.doubao.com)`：
  // 别名≠URL 会被判成标题视图，屏幕文字和点开的地址从此不一致
  expect((await state(page)).texts[0]).toBe(
    '[https://www.doubao.co](https://www.doubao.co)',
  )

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await wait(400)
  const trimmed = await state(page)
  expect(trimmed.texts[0]).toBe('[https://www.doubao.](https://www.doubao.)')
  expect(trimmed.chips).toEqual(['https://www.doubao.'])

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.texts[0]).toBe('https://www.doubao.')
  expect(read.chips).toEqual(['https://www.doubao.'])
})
