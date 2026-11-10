/**
 * 表格单元格行内格式回归网。
 *
 * 锚定行为：
 * 1. 编辑态在格内选中文字 → 浮出行内格式工具条（`.inline-format-toolbar`，detached 模式）。
 * 2. 点工具条按钮写入 `cellMarks` 并重写格内 HTML：加粗落到 `<strong>/<b>`，文字色落到
 *    `[data-inline-color]`，背景色落到 `[data-inline-bg]`。
 * 3. 退出编辑态（Esc）后渲染态按同一份 `cellMarks` 画出同样的样式；重新激活后样式仍在。
 * 4. 再次点击已加粗的选区可取消加粗（不是只能叠加）。
 *
 * 运行：`npx playwright test tests/table-inline-format.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

/** 建一张 3×3 表格并停在编辑态（首行为表头） */
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

function cell(page: Page, row: number, col: number) {
  return page.locator(`.table-block .cell-input[data-row="${row}"][data-col="${col}"]`).first()
}

/** 点格后 Home + Shift+End 选中整行文字（格内是单行，等同于选中整格文本） */
async function selectCellText(page: Page, row: number, col: number) {
  const box = await cell(page, row, col).boundingBox()
  if (!box) throw new Error(`量不到格 ${row},${col}`)
  await page.mouse.click(box.x + 14, box.y + box.height / 2)
  await page.waitForTimeout(150)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.waitForTimeout(300)
}

test('格内选中文字浮出工具条，加粗生效且可取消', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await selectCellText(page, 1, 1)
  const toolbar = page.locator('.inline-format-toolbar').first()
  await expect(toolbar).toBeVisible()

  await toolbar.locator('button[title="加粗 (Ctrl+B)"]').click()
  await page.waitForTimeout(300)
  await expect(cell(page, 1, 1).locator('strong, b')).toHaveCount(1)
  expect(await cell(page, 1, 1).evaluate(el => {
    const bold = el.querySelector('strong, b')
    return bold ? getComputedStyle(bold).fontWeight : null
  })).toBe('700')

  // 工具条保持激活态（选区内已全为加粗）
  await expect(toolbar.locator('button[title="加粗 (Ctrl+B)"]')).toHaveClass(/is-active/)

  // 再点一次取消加粗
  await toolbar.locator('button[title="加粗 (Ctrl+B)"]').click()
  await page.waitForTimeout(300)
  await expect(cell(page, 1, 1).locator('strong, b')).toHaveCount(0)

  // Esc 退出编辑态：渲染态读同一份 cellMarks，画出一致的样式
  await selectCellText(page, 1, 1)
  await toolbar.locator('button[title="加粗 (Ctrl+B)"]').click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await expect(page.locator('.table-block .cell-input')).toHaveCount(0)
  await expect(page.locator('.table-block td[data-row="1"][data-col="1"] .cell-text strong, .table-block td[data-row="1"][data-col="1"] .cell-text b')).toHaveCount(1)
})

test('格内文字色与背景色写入并持久化到渲染态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await selectCellText(page, 1, 0)
  const toolbar = page.locator('.inline-format-toolbar').first()
  await expect(toolbar).toBeVisible()

  await toolbar.locator('button[title="文字颜色与背景色"]').click()
  const palette = toolbar.locator('.inline-format-palette').first()
  await expect(palette).toBeVisible()
  // 跳过「默认颜色」格子，取第一个字体色块
  await palette
    .locator('.inline-format-palette-section[data-kind="color"] .inline-format-swatch--text:not(.inline-format-swatch--default)')
    .first()
    .click()
  await page.waitForTimeout(300)

  const colored = cell(page, 1, 0).locator('[data-inline-color]')
  await expect(colored).toHaveCount(1)
  expect(await colored.evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(0, 0, 0)')

  // 背景色：点击格内会收起浮层，重新选中后再次打开合并色板
  await selectCellText(page, 1, 0)
  await toolbar.locator('button[title="文字颜色与背景色"]').click()
  await toolbar.locator('.inline-format-palette').first()
    .locator('.inline-format-palette-section[data-kind="background"] .inline-format-swatch:not(.inline-format-swatch--none)')
    .first()
    .click()
  await page.waitForTimeout(300)
  await expect(cell(page, 1, 0).locator('[data-inline-bg]')).toHaveCount(1)

  // 合并色按钮自证：字形与按钮底色分别反映文字色 / 背景色
  const mergedBackground = await toolbar
    .locator('button[title="文字颜色与背景色"]')
    .evaluate(el => getComputedStyle(el).backgroundColor)
  expect(mergedBackground).not.toBe('rgba(0, 0, 0, 0)')

  // 退出编辑态：渲染态同样带颜色与背景
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const rendered = page.locator('.table-block td[data-row="1"][data-col="0"] .cell-text')
  await expect(rendered.locator('[data-inline-color]')).toHaveCount(1)
  await expect(rendered.locator('[data-inline-bg]')).toHaveCount(1)
})
