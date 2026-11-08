/**
 * 合并单元格回归网。
 *
 * 锚定行为：
 * 1. 合并区只有左上格进 DOM（带 rowspan/colspan），被覆盖格**没有 DOM**。
 * 2. 合并时区内内容按行优先**拼进**左上格（空格连接），其余格清空——不静默丢内容；
 *    取消合并不会把内容「还原」到各格（唯一副本在左上格）。
 * 3. 按坐标找 DOM 的路径（工具条锚点、选区色块）必须先过 `anchorFor`：
 *    选合并区里任意一格，色块要覆盖整块，且工具条正常浮出。
 * 4. 每格左下角有一个 18px **透明**热区（`.cell-corner`，只改光标）：单击 = 选中本格
 *    （合并格 = 整块）并浮出范围菜单。这是「单格开菜单」与「取消合并」的唯一手势入口。
 * 5. 删除行撞到合并区直接拆开（不禁止）。
 * 6. 表头与表体之间不能合并（会横穿 thead/tbody，HTML 不支持）——按钮置灰并说明。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-merge.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

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

async function dragCells(page: Page, r1: number, c1: number, r2: number, c2: number) {
  const from = await cellBox(page, r1, c1)
  const to = await cellBox(page, r2, c2)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(400)
}

/** 拖出矩形 → 点工具条上的「合并单元格」 */
async function mergeRange(page: Page, r1: number, c1: number, r2: number, c2: number) {
  await dragCells(page, r1, c1, r2, c2)
  await page.locator('.range-menu .rm-btn[aria-label="合并单元格"]').click()
  await page.waitForTimeout(600)
}

test('合并 2×2：span 正确，被覆盖格消失，内容拼进左上格', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await mergeRange(page, 1, 0, 2, 1)

  const origin = page.locator('.table-block td[data-row="1"][data-col="0"]')
  await expect(origin).toHaveAttribute('rowspan', '2')
  await expect(origin).toHaveAttribute('colspan', '2')

  // 被覆盖格没有 DOM —— 这正是「必须 anchorFor」的根源
  await expect(page.locator('.table-block td[data-row="1"][data-col="1"]')).toHaveCount(0)
  await expect(page.locator('.table-block td[data-row="2"][data-col="0"]')).toHaveCount(0)
  await expect(page.locator('.table-block td[data-row="2"][data-col="1"]')).toHaveCount(0)

  // 四格内容按行优先拼进左上格，一个字都不丢
  expect(await origin.locator('textarea').inputValue()).toBe('R1C0 R1C1 R2C0 R2C1')
  await expect(page.locator('.table-block td[data-row="1"][data-col="2"]')).toHaveCount(1)
  expect(await page.locator('.table-block textarea[data-row="1"][data-col="2"]').first().inputValue()).toBe('R1C2')
})

test('选区跨合并区：色块覆盖整块（不是缺一格），工具条正常浮出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)
  await mergeRange(page, 1, 0, 2, 1)

  // 合并区内只有左上格有 DOM，拖不进去；从左上格拉到右侧相邻列，覆盖整个合并区
  await dragCells(page, 1, 0, 2, 2)
  await expect(page.locator('.range-menu')).toBeVisible()

  // 合并区一块 + (1,2) + (2,2)：被覆盖的 3 格不能各画一条（会缺块或重色）
  const boxes = page.locator('.cell-select-box')
  await expect(boxes).toHaveCount(3)
  const boxW = await boxes.first().evaluate(el => el.getBoundingClientRect().width)
  const tdW = await page
    .locator('.table-block td[data-row="1"][data-col="0"]')
    .evaluate(el => el.getBoundingClientRect().width)
  // 第一块 = 合并区整块（两列宽），不是单列宽
  expect(Math.abs(boxW - tdW)).toBeLessThan(2)
})

test('取消合并：范围内相交的合并区被拆开，4 格回来、内容留在左上格', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)
  await mergeRange(page, 1, 0, 2, 1)

  await dragCells(page, 1, 0, 2, 2)
  const unmerge = page.locator('.range-menu .rm-btn[aria-label="取消合并"]')
  await expect(unmerge).toBeVisible()

  await unmerge.click()
  await page.waitForTimeout(600)

  await expect(page.locator('.table-block td[data-row="1"][data-col="1"]')).toHaveCount(1)
  await expect(page.locator('.table-block td[data-row="2"][data-col="0"]')).toHaveCount(1)
  await expect(page.locator('.table-block td[data-row="2"][data-col="1"]')).toHaveCount(1)
  // 合并时的拼接结果留在左上格；被清空的格不会「复活」
  expect(await page.locator('.table-block textarea[data-row="1"][data-col="0"]').first().inputValue())
    .toBe('R1C0 R1C1 R2C0 R2C1')
  expect(await page.locator('.table-block textarea[data-row="1"][data-col="1"]').first().inputValue()).toBe('')
})

test('合并格左下角热区：单击选中整块并浮出菜单，一处点掉取消合并', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)
  await mergeRange(page, 1, 0, 2, 1)

  // 被覆盖格没有 DOM，拖不出「只选这块合并区」的矩形 → 只能靠左下角热区
  const corner = page.locator('.table-block td[data-row="1"][data-col="0"] .cell-corner')
  await expect(corner).toHaveCount(1)
  await expect(corner).toHaveAttribute('aria-label', '单元格菜单')

  // 热区在格子左下角，透明但可命中：把鼠标放进去确认光标形态已不是文本 I-beam。
  // 自定义光标是 data URI 的 SVG（三横），computed 值里保留原始 url(...) + 兜底值，
  // 所以断言「以 url( 开头且含 svg」而不是某个具名关键字。
  const cursor = await corner.evaluate(el => getComputedStyle(el).cursor)
  expect(cursor.startsWith('url(')).toBe(true)
  expect(cursor).toContain('svg')

  await corner.click()
  await page.waitForTimeout(400)

  // 菜单对着整块合并区：只给「取消合并」，不再给「合并」
  await expect(page.locator('.range-menu')).toBeVisible()
  await expect(page.locator('.range-menu .rm-btn[aria-label="合并单元格"]')).toHaveCount(0)
  await expect(page.locator('.range-menu .rm-btn[aria-label="取消合并"]')).toBeVisible()

  await page.locator('.range-menu .rm-btn[aria-label="取消合并"]').click()
  await page.waitForTimeout(600)
  await expect(page.locator('.table-block td[data-row="2"][data-col="1"]')).toHaveCount(1)
  await expect(page.locator('.table-block td[data-row="1"][data-col="1"]')).toHaveCount(1)
})

test('普通格左下角热区：单格也能开菜单（对齐 / 复制 / 清空），不出合并与行列项', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  // 热区是通用的：每个格一个，不限于合并格
  await expect(page.locator('.table-block .cell-corner')).toHaveCount(9)

  const box = await cellBox(page, 1, 2)
  await page.mouse.move(box.x + 8, box.y + box.height - 8)
  await page.waitForTimeout(150)
  await page.locator('.table-block td[data-row="1"][data-col="2"] .cell-corner').click()
  await page.waitForTimeout(400)

  await expect(page.locator('.range-menu')).toBeVisible()
  await expect(page.locator('.range-menu .rm-btn[aria-label="复制"]')).toBeVisible()
  await expect(page.locator('.range-menu .rm-btn[aria-label="清空内容"]')).toBeVisible()
  // 1×1 范围：合并 / 取消合并 / 删除行列 都不成立
  await expect(page.locator('.range-menu .rm-btn[aria-label="合并单元格"]')).toHaveCount(0)
  await expect(page.locator('.range-menu .rm-btn[aria-label="取消合并"]')).toHaveCount(0)
  await expect(page.locator('.range-menu .rm-btn[aria-label="删除行"]')).toHaveCount(0)
  await expect(page.locator('.range-menu .rm-btn[aria-label="删除列"]')).toHaveCount(0)
})

test('删行撞到合并区：直接拆开（不禁止删行）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await mergeRange(page, 1, 0, 1, 1)
  await expect(page.locator('.table-block td[data-row="1"][data-col="0"]')).toHaveAttribute('colspan', '2')

  const strip = page.locator('.strip--row').nth(1)
  const box = await strip.boundingBox()
  if (!box) throw new Error('量不到行条')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(450)

  await page.locator('.range-menu .rm-btn[aria-label="删除行"]').click()
  await page.waitForTimeout(700)

  // 行数 3 → 2，冲突的合并区被拆开（(1,0) 与 (1,1) 都是独立格，colspan 消失）
  await expect(page.locator('.table-block td[data-row="2"]')).toHaveCount(0)
  await expect(page.locator('.table-block td[data-row="1"][data-col="0"]')).toHaveCount(1)
  await expect(page.locator('.table-block td[data-row="1"][data-col="1"]')).toHaveCount(1)
  expect(await page.locator('.table-block td[data-row="1"][data-col="0"]').getAttribute('colspan')).toBeNull()
})

test('表头与表体不能合并：跨边界时合并按钮置灰并说明原因', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await dragCells(page, 0, 0, 1, 1)
  const blocked = page.locator('.range-menu .rm-btn[aria-label="表头与表体不能合并"]')
  await expect(blocked).toBeVisible()
  await expect(blocked).toBeDisabled()
  await expect(page.locator('.range-menu .rm-btn[aria-label="合并单元格"]')).toHaveCount(0)
})

test('左下角光标按主题分两版：浅底深墨 / 暗底浅灰，切主题即换图', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  const corner = page.locator('.cell-corner').first()
  const cursorOf = () => corner.evaluate(el => getComputedStyle(el).cursor)

  const light = await cursorOf()
  expect(light.startsWith('url(')).toBe(true)

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(200)
  const dark = await cursorOf()

  // 两版必须是不同的图——只改 :root 忘了 [data-theme="dark"] 时这条会立刻红。
  expect(dark).not.toBe(light)
  // 浅色底用深墨线、深色底用浅灰线（单色各一版，不做双色描边折中）
  expect(decodeURIComponent(light)).toContain('#18181B')
  expect(decodeURIComponent(dark)).toContain('#F4F4F5')
  // 换色不换形：尺寸与 hotspot 必须一致，否则同一块热区在两套主题下手感不同
  for (const raw of [light, dark]) {
    const decoded = decodeURIComponent(raw)
    expect(decoded).toContain("width='20'")
    expect(decoded).toContain('4 17, default')
  }
})
