/**
 * 光标持久化（ADR-0070）：「光标始终聚焦在 block 上」。
 *
 * 覆盖：
 * - 点块外空白：块**不再**退出激活，光标还原到原字符位（旧行为是 deactivate）；
 * - Esc：退出块激活（关闭空白退出后的唯一键盘出口）；
 * - 空白拖拽（位移 >4px）：仍是跨块选区起手，不触发恢复。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/caret-persistence.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
}

/** 点第一块进入编辑态并输入一段文本，光标停在文本末尾 */
async function activateFirstBlockAndType(page: Page, text: string) {
  await page.locator('.block').first().click()
  await wait(300)
  await page.keyboard.type(text, { delay: 15 })
  await wait(300)
}

test('点块外空白：块保持激活，光标还原到原字符位', async ({ page }) => {
  await boot(page)
  await activateFirstBlockAndType(page, '光标持久化回归测试')

  // 空白点击：页面底部（块列表之外）
  await page.mouse.click(720, 820)
  await wait(400)

  // 块仍在编辑态（ProseMirror 在场），焦点回到编辑器，选区折叠
  const pm = page.locator('.ProseMirror')
  await expect(pm).toHaveCount(1)
  const state = await page.evaluate(() => {
    const ae = document.activeElement as HTMLElement | null
    const sel = window.getSelection()
    return {
      aeInPM: !!ae?.closest?.('.ProseMirror'),
      collapsed: sel?.isCollapsed ?? null,
      anchorText: sel?.anchorNode?.textContent?.slice(0, 20) ?? null,
    }
  })
  expect(state.aeInPM).toBe(true)
  expect(state.collapsed).toBe(true)
  expect(state.anchorText).toContain('光标持久化回归测试')
})

test('Esc：退出块激活（唯一键盘出口）', async ({ page }) => {
  await boot(page)
  await activateFirstBlockAndType(page, 'Esc 退出回归')

  await page.keyboard.press('Escape')
  await wait(400)

  // PM 卸载 = 块退回渲染态
  await expect(page.locator('.ProseMirror')).toHaveCount(0)
})

test('空白处按下拖拽（位移 >4px）：跨块选区起手，不触发光标恢复', async ({ page }) => {
  await boot(page)
  await activateFirstBlockAndType(page, '拖拽不恢复回归')

  // 从空白处按下拖 40px 再抬起：这是跨块选区手势
  await page.mouse.move(720, 820)
  await page.mouse.down()
  await page.mouse.move(680, 820, { steps: 5 })
  await page.mouse.up()
  await wait(400)

  const state = await page.evaluate(() => {
    const ae = document.activeElement as HTMLElement | null
    return { aeInPM: !!ae?.closest?.('.ProseMirror') }
  })
  // 恢复未被触发：焦点不在编辑器（跨块选区接管了这次手势）
  expect(state.aeInPM).toBe(false)
})
