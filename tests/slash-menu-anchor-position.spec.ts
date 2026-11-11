import { test, expect } from '@playwright/test'

/**
 * 回归：斜杠面板必须贴着光标，不能被整行段落盒子拽到内容区左缘（「跑到了 app 左上角」）。
 *
 * 曾有缺陷：锚点取 `view.domAtPos(pos)` 返回的 <p>，其 rect 是**整行盒子**，
 * left = 行首而非光标 x。首帧走 position 点模式（正确），nextTick 切到锚点模式
 * 后就横向跳到行首；空块时行首≈光标，只有「已有文本后输入 /」才暴露。
 * 修复后锚点改为 coordsAtPos 的 0×0 光标点矩形。
 */
test.describe('Slash menu anchor follows the caret', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  test('已有文本后输入 /，面板横向贴在光标处而不是段落行首', async ({ page }) => {
    await page.locator('.block-content').first().click()
    await page.waitForTimeout(800)
    await page.keyboard.type('hello world')
    await page.keyboard.type('/')
    await page.waitForTimeout(600)

    const panel = page.locator('.base-popover:has(.slash-command-menu)').first()
    await expect(panel).toBeVisible()
    const panelBox = (await panel.boundingBox())!
    const paraBox = (await page.locator('.ProseMirror p').first().boundingBox())!

    // 光标在 "hello world/" 之后，离行首至少 50px；旧实现把面板钉在 paraBox.x
    expect(panelBox.x).toBeGreaterThan(paraBox.x + 50)
  })

  test('输入 / 后继续输入命令，面板不跳到视口左上角', async ({ page }) => {
    await page.locator('.block-content').first().click()
    await page.waitForTimeout(800)
    await page.keyboard.type('/')
    await page.waitForTimeout(300)
    await page.keyboard.type('ti')
    await page.waitForTimeout(600)

    const panelBox = (await page.locator('.base-popover:has(.slash-command-menu)').first().boundingBox())!
    expect(panelBox.x).toBeGreaterThan(20)
    expect(panelBox.y).toBeGreaterThan(20)
  })
})
