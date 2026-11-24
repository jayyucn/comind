/**
 * 表格「表头下方 +」回归网。
 *
 * 锚定行为：开启首行表头时，表头行（行条 index 0）底边同样浮出「+」，
 * 点它在 thead 与 tbody 之间插入第一个表体行；纯表头表格全靠这个入口开张。
 * 旧实现按 bodyStart 屏蔽了 index 0 的入口与热区，有表头就看不到这个按钮。
 *
 * 运行：`npx playwright test tests/table-header-plus.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const ROW = '.strip--row'

/** 造一张 3×3、默认带首行表头的表格，停在编辑态 */
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
    await page.locator(`.table-block .cell-input[data-row="${row}"][data-col="${col}"]`).first().click()
    await page.keyboard.type(`R${row}C${col}`, { delay: 5 })
  }
  await page.waitForTimeout(400)
}

test('有表头时，表头行下方有「+」且点它在表头下插入新行', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await createTable(page)
  await expect(page.locator('.table-block thead tr')).toHaveCount(1)

  const totalBefore = await page.locator('.table-block tr').count()

  // 行条首段 = 表头行；端点（底边中点）即「表头下方」的插入点
  const headerRow = page.locator(ROW).first()
  const box = await headerRow.boundingBox()
  if (!box) throw new Error('量不到表头行条')
  const point = { x: box.x + box.width / 2, y: box.y + box.height - 1 }

  await page.mouse.move(point.x, point.y)
  await page.waitForTimeout(300)
  await expect(headerRow.locator('.strip-plus')).toHaveCSS('opacity', '1')

  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(900)

  expect(await page.locator('.table-block tr').count()).toBe(totalBefore + 1)
  // 表头原样留在 thead，新行是 tbody 的第一行且为空
  await expect(page.locator('.table-block thead tr')).toHaveCount(1)
  await expect(page.locator('.table-block thead .cell-input').first()).toHaveText('R0C0')
  const firstBodyRow = page.locator('.table-block tbody tr').first()
  await expect(firstBodyRow.locator('td[data-row="1"]')).toHaveCount(3)
  await expect(firstBodyRow.locator('.cell-input').first()).toHaveText('')
})
