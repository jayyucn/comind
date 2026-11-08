/**
 * 表格操作条的显隐回归网。
 *
 * 显隐模型（PRD 第 4 节「操作入口」）：
 * 1. 默认（鼠标不在块内）→ 全部隐藏；
 * 2. 块 hover → 整排基座浮现；压在某段上 → 该段深一档；
 * 3. 菜单打开期间 → **同类整排保持可见**（列菜单亮列条、行菜单亮行条），
 *    另一方向的条仍隐藏。菜单浮在表格外，鼠标移进菜单后块 hover 已断开，
 *    若只按 hover 显隐，整条带子会连同「菜单属于哪一列 / 哪一行」一起消失。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-strip-visibility.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const COL = '.strip--col'
const ROW = '.strip--row'

/** 每段条的 computed opacity（按渲染顺序，取两位小数） */
async function opacities(page: Page, selector: string) {
  const values = await page.$$eval(selector, (els) =>
    els.map((el) => Number(Number(getComputedStyle(el).opacity).toFixed(2))),
  )
  return values
}

/**
 * 打开某一段条的菜单。
 * 取条的中点按下：端点附近有「+」的热区与圆角，命中可能落到子图标上。
 * 首次点击偶尔被上一枚 popover 的关闭动画吞掉，兜底直接在条上派发一次 click。
 */
async function openStripMenu(page: Page, selector: string, index: number) {
  const strip = page.locator(selector).nth(index)
  const box = await strip.boundingBox()
  if (!box) throw new Error(`量不到 ${selector} #${index}`)
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(250)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(450)
  if ((await page.locator('.range-menu').count()) > 0) return

  await strip.dispatchEvent('click')
  await page.waitForTimeout(450)
  if ((await page.locator('.range-menu').count()) > 0) return

  throw new Error(`打开 ${selector} #${index} 的菜单失败`)
}

/** 把鼠标移进菜单（并确认块 hover 已经断开，否则本用例断言不到「只靠菜单态」） */
async function hoverMenu(page: Page) {
  const menu = await page.locator('.range-menu').first().boundingBox()
  if (!menu) throw new Error('量不到菜单')
  await page.mouse.move(menu.x + menu.width / 2, menu.y + menu.height / 2)
  await page.waitForTimeout(350)
  expect(await page.evaluate(() => !!document.querySelector('.table-block:hover'))).toBe(false)
}

/**
 * 关闭菜单但不让块失活。
 *
 * 范围工具条是**非模态**浮层（不铺全屏 overlay），点块外会同时关菜单 + 失活块，
 * 条随之从 DOM 移除；而本用例要观察的是「菜单关闭后条还在、只是隐藏」，
 * 所以用「点表格内一格」收菜单——块保持激活态，条继续存在。
 */
async function dismissMenuInTable(page: Page) {
  const cell = await page
    .locator('.table-block td[data-row="2"][data-col="2"]')
    .first()
    .boundingBox()
  if (!cell) throw new Error('量不到格 2,2')
  await page.mouse.click(cell.x + cell.width / 2, cell.y + cell.height / 2)
  await page.waitForTimeout(350)
}

test('操作条：菜单打开期间同类整排保持可见，另一方向仍隐藏', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await page.waitForTimeout(500)

  // ── 夹具：3×3 表格，停在编辑态（条只在编辑态渲染） ──
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
    await page.keyboard.type(`R${row}C${col}`, { delay: 10 })
  }
  await page.waitForTimeout(400)

  const table = page.locator('.table-block').first()
  const box = await table.boundingBox()
  if (!box) throw new Error('量不到表格')

  // 鼠标移出块：全部隐藏
  await page.mouse.move(box.x + box.width + 90, box.y + box.height + 120)
  await page.waitForTimeout(400)
  expect((await opacities(page, COL)).every((v) => v === 0)).toBe(true)
  expect((await opacities(page, ROW)).every((v) => v === 0)).toBe(true)

  // 块 hover：整排基座浮现（三级里的第二级）
  const second = await page.locator(COL).nth(1).boundingBox()
  if (!second) throw new Error(`量不到 ${COL} #1`)
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2)
  await page.waitForTimeout(250)
  expect((await opacities(page, COL)).every((v) => v === 1)).toBe(true)

  await openStripMenu(page, COL, 1)
  await hoverMenu(page)
  await expect.poll(async () => (await opacities(page, COL)).every((v) => v === 1), { timeout: 3000 }).toBe(true)
  expect((await opacities(page, ROW)).every((v) => v === 0)).toBe(true)
  expect(await table.getAttribute('class')).toContain('is-col-menu-open')

  // 关闭菜单（点表格内一格）：整排回到隐藏
  await dismissMenuInTable(page)
  await page.mouse.move(box.x + box.width + 90, box.y + box.height + 120)
  await page.waitForTimeout(400)
  await expect.poll(async () => (await opacities(page, COL)).every((v) => v === 0), { timeout: 3000 }).toBe(true)

  // ── 行菜单：整列行条可见，列条仍隐藏 ──
  await openStripMenu(page, ROW, 1)
  await hoverMenu(page)
  await expect.poll(async () => (await opacities(page, ROW)).every((v) => v === 1), { timeout: 3000 }).toBe(true)
  expect((await opacities(page, COL)).every((v) => v === 0)).toBe(true)
  expect(await table.getAttribute('class')).toContain('is-row-menu-open')

  await dismissMenuInTable(page)
  await page.mouse.move(box.x + box.width + 90, box.y + box.height + 120)
  await page.waitForTimeout(400)
  await expect.poll(async () => (await opacities(page, ROW)).every((v) => v === 0), { timeout: 3000 }).toBe(true)
})
