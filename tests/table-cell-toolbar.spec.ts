/**
 * 表格范围工具条 + 表格菜单回归网。
 *
 * 锚定行为：
 * 1. 格选区（矩形）松手即浮出工具条；工具条与行列条菜单是同一个浮层（`.range-menu`）。
 * 2. 不可用项**不渲染**：「删除行/上移下移」只在范围覆盖整行时出现，
 *    「删除列/左右移」只在覆盖整列时出现；合并单元格只在矩形范围（≥2 格）下出现。
 * 3. 点工具条上的按钮不会丢掉格选区（工具条 Teleport 到 body，文档级 mousedown
 *    会把「表格之外」的点击当成撤销选区，必须白名单豁免）。
 * 4. 只读态（未激活的渲染态表格）也能拖选并操作：点项时先激活块再执行。
 * 5. 对齐是**逐格**的：只影响选区内的格。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-cell-toolbar.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

/** 建一张 3×3 表格并停在编辑态（列宽 3 列、首行为表头） */
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
    await page.keyboard.type(`R${row}C${col}`, { delay: 5 })
  }
  await page.waitForTimeout(400)
}

async function cellBox(page: Page, row: number, col: number) {
  const box = await page
    .locator(`.table-block td[data-row="${row}"][data-col="${col}"]`)
    .first()
    .boundingBox()
  if (!box) throw new Error(`量不到格 ${row},${col}`)
  return box
}

/** 从 (r1,c1) 拖到 (r2,c2) 形成矩形选区 */
async function dragCells(page: Page, r1: number, c1: number, r2: number, c2: number) {
  const from = await cellBox(page, r1, c1)
  const to = await cellBox(page, r2, c2)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // 先有一个小位移越过 4px 阈值，再落到目标格
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

function toolbar(page: Page) {
  return page.locator('.range-menu').first()
}

async function toolbarButtonTitles(page: Page) {
  return page.$$eval('.range-menu .rm-btn', els =>
    els.map(el => el.getAttribute('aria-label') ?? el.getAttribute('title') ?? ''),
  )
}

test('格选区松手浮出工具条：矩形下不出现行列专属项，合并单元格可用', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await dragCells(page, 1, 0, 2, 1)
  await expect(toolbar(page)).toBeVisible()

  const titles = await toolbarButtonTitles(page)
  expect(titles).toContain('对齐方式')
  expect(titles).toContain('合并单元格')
  expect(titles).toContain('复制')
  expect(titles).toContain('清空内容')
  expect(titles).not.toContain('删除行')
  expect(titles).not.toContain('删除列')

  // 合并单元格：矩形范围下可用（1×1 时整项隐藏）
  await expect(page.locator('.range-menu .rm-btn[aria-label="合并单元格"]')).toBeEnabled()
})

test('对齐：工具条点项不丢选区，且只作用于选区内', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await dragCells(page, 1, 0, 2, 1)
  await expect(toolbar(page)).toBeVisible()

  await page.locator('.range-menu .rm-btn[aria-label="对齐方式"]').click()
  await expect(page.locator('.align-menu')).toBeVisible()
  await page.waitForTimeout(150)

  // 点二级项：选区必须还在（否则 mousedown 白名单没生效）
  await page.locator('.align-item', { hasText: '居中对齐' }).click()
  await page.waitForTimeout(500)

  const alignOf = async (row: number, col: number) => page
    .locator(`.table-block textarea[data-row="${row}"][data-col="${col}"]`)
    .first()
    .evaluate(el => getComputedStyle(el).textAlign)

  expect(await alignOf(1, 0)).toBe('center')
  expect(await alignOf(1, 1)).toBe('center')
  expect(await alignOf(2, 0)).toBe('center')
  expect(await alignOf(2, 1)).toBe('center')
  // 选区之外不受影响（表头仍是缺省 left，右侧列也未变）
  expect(await alignOf(0, 0)).toBe('left')
  expect(await alignOf(1, 2)).toBe('left')

  // 选区仍然存在：色块没被清掉
  expect(await page.locator('.cell-select-box').count()).toBeGreaterThan(0)
})

test('行条菜单：整行范围下出现删除行与上下移，不出现删除列', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  const strip = page.locator('.strip--row').nth(2)
  const box = await strip.boundingBox()
  if (!box) throw new Error('量不到行条')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(450)

  await expect(toolbar(page)).toBeVisible()
  const titles = await toolbarButtonTitles(page)
  expect(titles).toContain('删除行')
  expect(titles).toContain('上移')
  expect(titles).not.toContain('删除列')

  // 末行：下移不可用（按钮仍在但置灰）
  await expect(page.locator('.range-menu .rm-btn[aria-label="下移"]')).toBeDisabled()
  await expect(page.locator('.range-menu .rm-btn[aria-label="上移"]')).toBeEnabled()
})

test('只读态：拖选后点项先激活块再执行', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  // 点表格块之外的空白处 → 表格退出编辑态变只读
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await expect(page.locator('.table-block textarea')).toHaveCount(0)

  await dragCells(page, 1, 0, 1, 1)
  await expect(toolbar(page)).toBeVisible()

  await page.locator('.range-menu .rm-btn[aria-label="对齐方式"]').click()
  await page.locator('.align-item', { hasText: '右对齐' }).click()
  await page.waitForTimeout(800)

  // 点项后块被激活（textarea 回来），对齐已落在这格上
  await expect(page.locator('.table-block textarea[data-row="1"][data-col="0"]')).toHaveCount(1)
  expect(await page
    .locator('.table-block textarea[data-row="1"][data-col="0"]')
    .first()
    .evaluate(el => getComputedStyle(el).textAlign)).toBe('right')
})

test('列条菜单：不出现行专属项（上移/下移只在整行范围下成立）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  const strip = page.locator('.strip--col').nth(1)
  const box = await strip.boundingBox()
  if (!box) throw new Error('量不到列条')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(450)

  await expect(toolbar(page)).toBeVisible()
  const titles = await toolbarButtonTitles(page)
  expect(titles).toContain('删除列')
  expect(titles).toContain('左移')
  expect(titles).toContain('右移')
  // 列范围覆盖了所有行，但轴向是列：不能冒出行的上移/下移
  expect(titles).not.toContain('上移')
  expect(titles).not.toContain('下移')
  expect(titles).not.toContain('删除行')
})

test('对齐二级是真正浮出的独立浮层：点它不关工具条，Esc 只关二级', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await dragCells(page, 1, 0, 1, 1)
  await expect(toolbar(page)).toBeVisible()

  const alignBtn = page.locator('.range-menu .rm-btn[aria-label="对齐方式"]')
  const submenu = page.locator('.align-menu')

  await alignBtn.click()
  await expect(submenu).toBeVisible()
  await page.waitForTimeout(200)

  // ① Teleport 到 body：不是工具条面板的子节点（否则会被 overflow:auto 裁掉）
  expect(await submenu.evaluate(el => !!el.closest('.base-popover'))).toBe(false)
  // ② z 高于工具条面板，不会被面板盖住
  expect(await page.evaluate(() => {
    const menu = document.querySelector('.align-menu') as HTMLElement
    const panel = document.querySelector('.range-menu')!.closest('.base-popover') as HTMLElement
    return Number(getComputedStyle(menu).zIndex) > Number(getComputedStyle(panel).zIndex)
  })).toBe(true)
  // ③ 纵向浮出：整体在按钮下方（不是面板内换行的第二行）
  const btnBox = await alignBtn.boundingBox()
  const menuBox = await submenu.boundingBox()
  expect(menuBox!.y).toBeGreaterThan(btnBox!.y + btnBox!.height - 2)
  // ④ 三项竖排：左/中/右
  expect(await submenu.locator('.align-item').allInnerTexts()).toEqual(['左对齐', '居中对齐', '右对齐'])

  // 点二级项：不能被外层「点面板外即关」误判，工具条必须还在
  await page.locator('.align-item', { hasText: '居中对齐' }).click()
  await page.waitForTimeout(400)
  await expect(submenu).toHaveCount(0)
  await expect(toolbar(page)).toBeVisible()

  // Esc 只关二级：工具条留下（否则 window 捕获没抢在 BasePopover 的 document 捕获之前）
  await alignBtn.click()
  await expect(submenu).toBeVisible()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await expect(submenu).toHaveCount(0)
  await expect(toolbar(page)).toBeVisible()
})
