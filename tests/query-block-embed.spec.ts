/**
 * 查询块（内嵌 QueryPageFrame）真机冒烟。
 *
 * jsdom 单测验不到的：高度自适应（内容少时收缩 / 超上限内部滚动）、
 * `.page-title-container` 是否真的不渲染、块在正文里的宽度与描边。
 *
 * 运行：`npx playwright test tests/query-block-embed.spec.ts`（dev server 由 config 自动起）
 */
import { test, expect } from '@playwright/test'

test('查询块：内嵌外壳无标题、有主内容区、高度受上限约束', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 30000 })

  const first = page.locator('.block').first()
  await first.click()
  await page.keyboard.type('/query')
  await page.waitForTimeout(400)

  const menuCount = await page.locator('[class*="slash"]').count()
  console.log('slash menu nodes:', menuCount)

  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)

  const info = await page.evaluate(() => {
    const qb = document.querySelector('.query-block') as HTMLElement | null
    const rect = qb?.getBoundingClientRect()
    return {
      found: !!qb,
      height: rect ? Math.round(rect.height) : null,
      width: rect ? Math.round(rect.width) : null,
      hasPageTitleContainer: !!document.querySelector('.query-block .page-title-container'),
      hasLibBody: !!document.querySelector('.query-block .lib-body'),
      hasFrame: !!document.querySelector('.query-block .query-page-frame.is-embedded'),
      childChain: qb
        ? Array.from(qb.querySelectorAll('*'))
            .slice(0, 12)
            .map((el) => el.className)
        : [],
    }
  })
  console.log('QUERY BLOCK:', JSON.stringify(info, null, 2))

  await page.screenshot({ path: 'outputs/query-block-smoke.png', fullPage: true })

  expect(info.found).toBe(true)
  // 嵌入口径的三条硬约束：无 PageTitle 容器、主内容区在、外壳处于 embedded 模式
  expect(info.hasPageTitleContainer).toBe(false)
  expect(info.hasLibBody).toBe(true)
  expect(info.hasFrame).toBe(true)
  // 高度受宿主上限约束（--query-block-max-height: 560px），不会被查询结果撑破页面
  expect(info.height).toBeLessThanOrEqual(560)
  test.info().annotations.push({ type: 'smoke', description: JSON.stringify(info) })
})
