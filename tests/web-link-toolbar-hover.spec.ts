/**
 * 悬浮条 hover 连续性（ADR-0067 D2）：宿主（chip / 卡片块）的 mouseleave 会排队隐藏，
 * 指针从宿主升到悬浮条的路上不能被中间的空隙打断 —— 空隙里 anchor 不再是 hover 目标，
 * 宿主一 mouseleave 就开始倒计时，慢半拍面板就在半途被抽走（「移到 toolbar 就关掉」）。
 *
 * 必须用分段鼠标移动复现：`page.hover()` 是瞬移，永远落在悬浮条上，测不出这条。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-toolbar-hover.spec.ts`
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
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)
}

/** 从宿主中心分段、慢速地移到悬浮条中心（每步 40ms，比人手更慢） */
async function crawlToToolbar(page: Page, host: string): Promise<void> {
  const between = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      )
      await wait(40)
    }
  }

  const hostEl = page.locator(host).first()
  await hostEl.hover()
  await expect(page.locator('.wl-toolbar')).toBeVisible()

  const hostBox = (await hostEl.boundingBox())!
  // 悬浮条浮在宿主正上方，从宿主顶边中点上移到条顶中点
  await between(
    { x: hostBox.x + hostBox.width / 2, y: hostBox.y + hostBox.height - 2 },
    { x: hostBox.x + hostBox.width / 2, y: hostBox.y - 20 },
  )
}

test('chip → 悬浮条：慢速上移不消失，且菜单可点', async ({ page }) => {
  await boot(page)
  await crawlToToolbar(page, '.web-link-chip')

  await expect(page.locator('.wl-toolbar')).toBeVisible()
  await page.locator('.wl-toolbar-view > button').click()
  await expect(page.locator('.wl-toolbar-menu')).toBeVisible()
  await page.locator('.wl-toolbar-menu-item', { hasText: '链接视图' }).click()
  await wait(600)
  expect(await page.locator('.web-link-chip').first().textContent()).toBe('https://www.feishu.cn/docx/abc')
})

test('卡片块 → 悬浮条：慢速上移不消失', async ({ page }) => {
  await boot(page)
  await page.locator('.web-link-chip').first().hover()
  await wait(300)
  await page.locator('.wl-toolbar-view > button').click()
  await page.locator('.wl-toolbar-menu-item', { hasText: '卡片视图' }).click()
  await wait(800)
  await expect(page.locator('.web-link.is-card')).toHaveCount(1)

  await crawlToToolbar(page, '.web-link.is-card')
  await expect(page.locator('.wl-toolbar')).toBeVisible()
})
