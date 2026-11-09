/**
 * 回归网：布局宽度变化（ctrl+b 折叠侧栏）后，所有「缓存视口矩形」的浮层必须重新跟随。
 *
 * 失效对象（同一根因，浏览器不会派发 window resize —— 只有**内容容器宽度**变了）：
 * 1. 文本选区覆盖层 `.text-selection-rect`（fixed + 视口矩形，只在 scroll/resize 时重算）
 * 2. 表格范围工具条 `.range-menu`（BasePopover 锚点模式，只在 scroll/resize 时重读锚点）
 *
 * 判定手法不看绝对坐标，只看**与锚点的相对位移**：侧栏折叠必然让内容横向移动，
 * 浮层若跟着移动，相对差保持不变；停在旧坐标则相对差漂移出侧栏宽度量级。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/layout-change-reanchor.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

async function typeRobust(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 40 })
  for (let i = 0; i < 3; i++) {
    const cur = await page.evaluate(() => document.querySelector('.block.active .tiptap')?.textContent ?? '')
    if (cur === text) return
    const missing = text.slice(cur.length)
    if (missing) await page.keyboard.type(missing, { delay: 40 })
    await page.waitForTimeout(200)
  }
}

async function setupBlocks(page: Page, texts: string[]) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await typeRobust(page, texts[0])
  for (let i = 1; i < texts.length; i++) {
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await typeRobust(page, texts[i])
  }
}

/** 覆盖层/正文的相对关系快照：只看「高亮左缘 − 正文左缘」，不看绝对坐标 */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const contents = Array.from(document.querySelectorAll('.block-content'))
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width > 0)
    const rects = Array.from(document.querySelectorAll('.text-selection-rect'))
      .map(el => el.getBoundingClientRect())
    return {
      contentLeft: Math.round(Math.min(...contents.map(r => r.left))),
      rectLeft: rects.length ? Math.round(Math.min(...rects.map(r => r.left))) : null,
      rectCount: rects.length,
      rectTops: rects.map(r => Math.round(r.top)),
    }
  })
}

async function collapseSidebar(page: Page) {
  await page.keyboard.press('Control+b')
  await page.waitForSelector('.sidebar-wrapper.collapsed', { timeout: 5000 })
  await page.waitForTimeout(600)
}

test('文本选区高亮跟随 ctrl+b 折叠侧栏（相对正文位置不变）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.evaluate(() => localStorage.removeItem('comind:sidebar-collapsed'))
  await setupBlocks(page, ['alpha bravo charlie', 'delta echo foxtrot'])

  const b1 = await page.locator('.block').first().locator('.block-content').boundingBox()
  const b2 = await page.locator('.block').nth(1).locator('.block-content').boundingBox()
  await page.mouse.move(b1!.x + 5, b1!.y + b1!.height / 2)
  await page.mouse.down()
  await page.mouse.move(b2!.x + 80, b2!.y + b2!.height / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction(
    () => document.querySelectorAll('.text-selection-rect').length > 0,
    undefined,
    { timeout: 8000 },
  )

  const before = await geometry(page)
  expect(before.rectLeft, '量不到高亮矩形').not.toBeNull()

  await collapseSidebar(page)

  const after = await geometry(page)
  expect(after.rectCount, '折叠后高亮矩形消失').toBeGreaterThan(0)

  const dContent = after.contentLeft - before.contentLeft
  const dRect = after.rectLeft! - before.rectLeft!
  console.log('TEXTSEL-DELTA', JSON.stringify({ dContent, dRect, before, after }))
  expect(Math.abs(dContent), '侧栏折叠后正文没有横向移动，用例失效').toBeGreaterThan(8)
  expect(Math.abs(dRect - dContent), '高亮矩形未跟随正文移动').toBeLessThanOrEqual(1)
})

/** 建一张 3×3 表格并填满内容 */
async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.type('/table', { delay: 30 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
  for (let i = 0; i < 9; i += 1) {
    const row = Math.floor(i / 3)
    const col = i % 3
    await page.locator(`.table-block textarea[data-row="${row}"][data-col="${col}"]`).first().click()
    await page.keyboard.type(`R${row}C${col}-padding-content`, { delay: 3 })
  }
  await page.waitForTimeout(400)
}

test('表格范围工具条跟随 ctrl+b 折叠侧栏（相对锚点格位置不变）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.evaluate(() => localStorage.removeItem('comind:sidebar-collapsed'))
  await createTable(page)

  const cellBox = async (row: number, col: number) => {
    const box = await page
      .locator(`.table-block td[data-row="${row}"][data-col="${col}"]`)
      .first()
      .boundingBox()
    if (!box) throw new Error(`量不到格 ${row},${col}`)
    return box
  }

  const from = await cellBox(1, 0)
  const to = await cellBox(2, 1)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForSelector('.range-menu', { timeout: 8000 })
  await page.waitForTimeout(300)

  const menuBefore = await page.locator('.range-menu').first().boundingBox()
  const anchorBefore = await cellBox(2, 1)
  expect(menuBefore).not.toBeNull()

  await collapseSidebar(page)

  const menuAfter = await page.locator('.range-menu').first().boundingBox()
  const anchorAfter = await cellBox(2, 1)
  expect(menuAfter, '折叠后工具条消失').not.toBeNull()

  const dAnchor = anchorAfter.x - anchorBefore.x
  const dMenu = menuAfter!.x - menuBefore!.x
  console.log('TABLE-MENU-DELTA', JSON.stringify({ dAnchor, dMenu }))
  expect(Math.abs(dAnchor), '侧栏折叠后表格没有横向移动，用例失效').toBeGreaterThan(8)
  expect(Math.abs(dMenu - dAnchor), '工具条未跟随锚点格移动').toBeLessThanOrEqual(1)
})
