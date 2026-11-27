/**
 * 外链 chip 两态一致性（ADR-0067）：编辑态只露别名，读态仍是同一个别名。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-chip-parity.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function startBlock(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(300)
}

test('外链 chip：编辑态只露别名，隐藏语法字符；Escape 后读态仍是同一个别名', async ({ page }) => {
  await startBlock(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)

  const editing = await page.evaluate(() => {
    const chip = document.querySelector('.ProseMirror .web-link-chip:not(.pm-prefix-hidden)')
    // 两截语法都靠零宽 CSS 隐藏（没有 contenteditable=false），取第一个 = 前缀 `[`
    const hidden = document.querySelector('.ProseMirror .pm-prefix-hidden')
    return {
      label: chip?.textContent ?? null,
      url: chip?.getAttribute('data-chip-url'),
      hiddenText: hidden?.textContent ?? null,
    }
  })
  expect(editing.label).toBe('飞书文档')
  expect(editing.url).toBe('https://www.feishu.cn/docx/abc')
  expect(editing.hiddenText).toBe('[')

  await page.keyboard.press('Escape')
  await wait(400)
  await expect(page.locator('.web-link-chip').first()).toHaveText('飞书文档')
})
