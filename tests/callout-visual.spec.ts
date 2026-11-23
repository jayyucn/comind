/**
 * 高亮块的视觉冒烟（临时脚本，不属于回归网）：
 * 壳挂在 `.block-content` 上、语义图标占 20px 列、切语义不改正文。
 *
 * 运行：`npx playwright test tests/callout-visual.spec.ts --reporter=line`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('comind-theme', t), theme)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(800)
}

async function leaveEdit(page: Page) {
  await page.keyboard.press('Escape')
  await wait(200)
  if (await page.locator('.ProseMirror-focused').count() > 0) {
    await page.mouse.click(1240, 660)
    await wait(300)
  }
}

async function setCallout(page: Page, text: string) {
  const block = page.locator('.block').first()
  await block.click()
  await wait(250)
  await page.keyboard.type(text)
  await wait(400)
  await leaveEdit(page)
  const target = page.locator('.block').first()
  await target.hover()
  await wait(150)
  await target.locator('.block-entry-icon').click()
  await wait(300)
  await page.locator('[data-text-style="callout"]').click()
  await wait(500)
  return page.locator('.block').first()
}

test('亮色：高亮块壳与图标', async ({ page }) => {
  await boot(page, 'light')
  const block = await setCallout(page, '重点：这段必须在扫视时跳出来')
  await expect(page.locator('.block-content.is-callout-warn')).toHaveCount(1)
  await expect(block.locator('.callout-tone-btn')).toHaveCount(1)
  await block.screenshot({ path: 'test-results/callout-light.png' })
})

test('暗色：四种语义并排', async ({ page }) => {
  await boot(page, 'dark')
  await setCallout(page, '提示：这是一段补充说明')
  // Enter 继承 = 新块也是 warn，正好用来先排好四段，再逐块换语义
  const texts = ['注意：这是一段警示', '完成：这件事已经收尾', '禁止：不要这样做']
  for (const text of texts) {
    const active = page.locator('.ProseMirror-focused')
    if (await active.count() === 0) {
      await page.locator('.block').last().click()
      await wait(200)
    }
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await wait(300)
    await page.keyboard.type(text)
    await wait(300)
  }
  await leaveEdit(page)

  for (const [i, tone] of ['info', 'warn', 'success', 'danger'].entries()) {
    const block = page.locator('.block').nth(i)
    await block.hover()
    await wait(120)
    await block.locator('.callout-tone-btn').click()
    await wait(250)
    await page.locator(`.callout-tone-item.is-tone-${tone}`).click()
    await wait(350)
  }
  await page.locator('.block-list').first().screenshot({ path: 'test-results/callout-dark.png' })

  // 四种语义各自独立成 class：色相与图标靠它分派，串了就是视觉回归
  for (const tone of ['info', 'warn', 'success', 'danger']) {
    await expect(page.locator(`.block-content.is-callout-${tone}`)).toHaveCount(1)
  }
})
