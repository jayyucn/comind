/**
 * 外链 chip 的打开协议（ADR-0069 D4）：按下落光标，抬起才打开。
 *
 * 覆盖三条：
 * - 读态单击 chip：块被激活（落光标）+ 发起一次打开；
 * - 从 chip 里起手拖选：有选区/位移超阈值 ⇒ **不**打开；
 * - 编辑态单击可见别名：同样打开（两态同形）。
 *
 * 断言口径是「调用了打开通道」：非 Tauri 环境走 `window.open`，这里把 `window.open`
 * 换成记录桩（真开标签页在 headless 里带 `noopener` 时不可靠，且会残留多余页面）。
 * 桌面端真机那条分支（tauri-plugin-opener）与它共用同一份判定代码，见
 * `src/utils/external-link.test.ts`。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-open.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.addInitScript(() => {
    ;(window as unknown as { __opened: string[] }).__opened = []
    window.open = ((url?: string | URL) => {
      ;(window as unknown as { __opened: string[] }).__opened.push(String(url ?? ''))
      return null
    }) as typeof window.open
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(300)
}

/** 键入网址成 chip 后退出编辑态，回到读态 */
async function seedChipAndLeaveEdit(page: Page) {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(600)
  await page.keyboard.press('Escape')
  await wait(400)
}

// 编辑态里同一个字面被拆成三截 span（前缀「[」、别名、尾巴「](url)」），三截都挂着
// `web-link-chip`；只有别名那截可见，`pm-prefix-hidden` 的两截宽度为 0，不能拿来点。
const chipSelector = '.web-link-chip[data-external="https://www.doubao.com"]:not(.pm-prefix-hidden)'

function opened(page: Page) {
  return page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)
}

test('读态单击 chip：块落光标（进编辑态）且发起一次打开', async ({ page }) => {
  await seedChipAndLeaveEdit(page)

  // 读态：块内没有编辑器
  await expect(page.locator('.block').first().locator('.ProseMirror')).toHaveCount(0)
  await page.locator(`.block ${chipSelector}`).click()
  await wait(800)

  expect(await opened(page)).toEqual(['https://www.doubao.com'])
  // 打开的同时块被激活，光标已落到 chip 里（从浏览器回来能接着敲字）
  await expect(page.locator('.block').first().locator('.ProseMirror')).toHaveCount(1)
})

test('从 chip 里起手拖选：有选区就不打开（选字优先）', async ({ page }) => {
  await seedChipAndLeaveEdit(page)

  const box = await page.locator(`.block ${chipSelector}`).boundingBox()
  expect(box).not.toBeNull()
  const y = box!.y + box!.height / 2
  await page.mouse.move(box!.x + 2, y)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width - 2, y, { steps: 6 })
  await page.mouse.up()
  await wait(600)

  // 位移超 4px 与「抬起时有选区」两道门任一命中都不打开；两道门各自的精确判定
  // 由 useBlockEditorLifecycle 单测覆盖（DOM Selection 在 comind 的跨块选区模型下
  // 会被编辑器自管，e2e 只断言「没有发起打开」这一可观测结果）。
  expect(await opened(page)).toEqual([])
})

test('编辑态单击可见别名：同样打开（两态同形）', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(600)

  await page.locator(`.block ${chipSelector}`).first().click()
  await wait(800)

  expect(await opened(page)).toEqual(['https://www.doubao.com'])
})
