/**
 * 表格块「渲染态（未激活）hover 表现 = 编辑态」回归网。
 *
 * 锚定行为：
 * 1. 渲染态 hover 表格块 → 行列操作条与左上角表格菜单入口同样浮现（两态同一套控件）。
 * 2. 点条能直接打开范围菜单，且**不会**因为 click 冒泡把块切成编辑态（菜单被激活顶掉）。
 * 3. 条上的「+」在渲染态可用：点一下插入一行并顺势激活块、光标落到新行首格。
 *
 * 为什么需要这层网：渲染态此前只渲染表格本体，条与菜单入口是 `v-if="!readonly"`，
 * 鼠标移到未激活表格上什么都看不见，点一下才「凭空冒出」一堆控件；而条又是绝对定位，
 * 渲染态若不测量几何（measureStrips 在 readonly 早退），即便渲染出来也会全挤在 0,0。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-render-strip-parity.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const COL = '.strip--col'
const ROW = '.strip--row'
/** 显隐做在包裹层 `.table-entry` 上（子按钮自身不声明 opacity，量它会恒为 1） */
const ENTRY = '.table-entry'

/** 每段条的 computed opacity（按渲染顺序，取两位小数） */
async function opacities(page: Page, selector: string) {
  return page.$$eval(selector, els =>
    els.map(el => Number(Number(getComputedStyle(el).opacity).toFixed(2))),
  )
}

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

/** 造表后退回渲染态（块未激活） */
async function seedRenderTable(page: Page) {
  await createTable(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()
}

async function hoverBlock(page: Page) {
  const table = page.locator('.table-block').first()
  const box = await table.boundingBox()
  if (!box) throw new Error('量不到表格')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(300)
  return box
}

test('渲染态 hover：行列条与表格菜单入口同样浮现', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await seedRenderTable(page)

  await hoverBlock(page)
  // 鼠标移出块：全部隐藏（与编辑态同一套三级显隐）。
  // 入口按钮的隐藏带 240ms 延迟（避免沿表格左缘掠过时闪一下），故用 poll 等它走完。
  await page.mouse.move(10, 10)
  await page.waitForTimeout(400)
  expect((await opacities(page, COL)).every(v => v === 0)).toBe(true)
  expect((await opacities(page, ROW)).every(v => v === 0)).toBe(true)
  await expect.poll(
    async () => page.locator(ENTRY).evaluate(el => Number(getComputedStyle(el).opacity)),
    { timeout: 3000 },
  ).toBe(0)

  // 块 hover：整排条 + 菜单入口浮现
  const second = await page.locator(COL).nth(1).boundingBox()
  if (!second) throw new Error(`量不到 ${COL} #1`)
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2)
  await page.waitForTimeout(300)
  expect((await opacities(page, COL)).every(v => v === 1)).toBe(true)
  expect((await opacities(page, ROW)).every(v => v === 1)).toBe(true)
  await expect.poll(
    async () => page.locator(ENTRY).evaluate(el => Number(getComputedStyle(el).opacity)),
    { timeout: 3000 },
  ).toBe(1)
})

test('渲染态点条：能打开范围菜单，且不把块切成编辑态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await seedRenderTable(page)

  const strip = page.locator(COL).nth(1)
  const stripBox = await strip.boundingBox()
  if (!stripBox) throw new Error('量不到列条')
  const point = { x: stripBox.x + stripBox.width / 2, y: stripBox.y + stripBox.height / 2 }
  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(250)
  await page.mouse.click(point.x, point.y)

  await expect(page.locator('.range-menu')).toBeVisible()
  // 菜单还在、块仍在渲染态：冒泡没被当成「点表格内容」而激活块
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()
})

test('渲染态表格菜单可用：关掉首行表头，表格立即变为无表头且不跳出渲染态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await seedRenderTable(page)
  await expect(page.locator('.table-block thead')).toHaveCount(1)

  await hoverBlock(page)
  await expect.poll(
    async () => page.locator(ENTRY).evaluate(el => Number(getComputedStyle(el).opacity)),
    { timeout: 3000 },
  ).toBe(1)
  await page.locator('.table-menu-entry').click()
  await expect(page.locator('.table-menu')).toBeVisible()

  await page.locator('.table-menu .menu-row', { hasText: '首行表头' }).click()
  await expect(page.locator('.table-block thead')).toHaveCount(0)
  // 菜单项直接作用于数据，不把块切成编辑态
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()
})

test('渲染态 hover 出条时，左侧 bullet dot 仍可点（条没有盖住它）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await seedRenderTable(page)

  await hoverBlock(page)
  const dot = page.locator('.block-row:has(.table-block) .bullet-dot').first()
  const box = await dot.boundingBox()
  if (!box) throw new Error('量不到 bullet dot')

  // 条带与 dot 在左侧 gutter 重叠 3px：渲染态也出条之后，dot 必须仍在这条重叠带上命中
  const hit = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    return el?.className ?? ''
  }, [box.x + box.width / 2, box.y + box.height / 2] as const)
  expect(String(hit)).toContain('bullet-dot')

  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(800)
  await expect(page.locator('.table-block textarea').first()).toBeVisible()
})

test('渲染态点「+」：插入一行并激活块，光标落到新行首格', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await seedRenderTable(page)

  // 行数按「全部 tr」计（表头行也在其中），插入点 = 末行之后 ⇒ 新行下标 = 旧总数
  const totalBefore = await page.locator('.table-block tr').count()

  // 行条末段（表体最后一行）：端点即末行底边中点，「+」只在该热区内浮出
  const lastRow = page.locator(ROW).last()
  const box = await lastRow.boundingBox()
  if (!box) throw new Error('量不到末行条')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1)
  await page.waitForTimeout(300)
  await expect(lastRow.locator('.strip-plus')).toHaveCSS('opacity', '1')

  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 1)
  await page.waitForTimeout(900)

  // 插入后块被激活（编辑态），行数 +1，光标在新行首格
  await expect(page.locator('.table-block textarea').first()).toBeVisible()
  expect(await page.locator('.table-block tr').count()).toBe(totalBefore + 1)
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return { tag: el?.tagName ?? null, row: el?.dataset?.row ?? null, col: el?.dataset?.col ?? null }
  })
  expect(focused).toEqual({ tag: 'TEXTAREA', row: String(totalBefore), col: '0' })
})
