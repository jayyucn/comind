/**
 * 表格单元格行内格式回归网。
 *
 * 锚定行为：
 * 1. 格内选中文字 → 浮出与格矩形选区**同一个**浮层（`.range-menu`），
 *    区别只在菜单项：文本选区下只有公共项（对齐 + B/I/U/S/A），结构项（合并 / 复制 /
 *    删行列 / 移动）整组不渲染。
 * 2. 点浮层上的 B/I/U/S/A 写入 `cellMarks` 并重写格内 HTML：加粗落到 `<strong>/<b>`，
 *    文字色落到 `[data-inline-color]`，背景色落到 `[data-inline-bg]`。
 * 3. 退出编辑态（Esc）后渲染态按同一份 `cellMarks` 画出同样的样式；重新激活后样式仍在。
 * 4. 再次点击已加粗的选区可取消加粗（不是只能叠加）。
 * 5. 渲染态（只读）拖选文本同样浮出该浮层，写入后立即落库。
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

/** 格内文本选区的浮层：与格矩形选区是同一个 `.range-menu` */
function textMenu(page: Page) {
  return page.locator('.range-menu').first()
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
  const toolbar = textMenu(page)
  await expect(toolbar).toBeVisible()
  // 公共项恒在，结构项不渲染（文本选区表达不了结构）
  await expect(toolbar.locator('button[aria-label="对齐方式"]')).toBeVisible()
  await expect(toolbar.locator('button[aria-label="合并单元格"]')).toHaveCount(0)
  await expect(toolbar.locator('button[aria-label="复制"]')).toHaveCount(0)
  await expect(toolbar.locator('button[aria-label="删除行"]')).toHaveCount(0)

  await toolbar.locator('button[title="加粗 (Ctrl+B)"]').click()
  await page.waitForTimeout(300)
  await expect(cell(page, 1, 1).locator('strong, b')).toHaveCount(1)
  expect(await cell(page, 1, 1).evaluate(el => {
    const bold = el.querySelector('strong, b')
    return bold ? getComputedStyle(bold).fontWeight : null
  })).toBe('700')

  // 浮层保持激活态（选区内已全为加粗）
  await expect(toolbar.locator('button[title="加粗 (Ctrl+B)"]')).toHaveClass(/is-on/)

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
  const toolbar = textMenu(page)
  await expect(toolbar).toBeVisible()

  await toolbar.locator('button[title="文字颜色与背景色"]').click()
  const palette = page.locator('.palette-menu').first()
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
  await page.locator('.palette-menu').first()
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

  // 退出编辑态：渲染态同样带颜色与背景。
  // 第一次 Esc 只收二级（取色面板与对齐下拉同口径：选完色面板不自动收），第二次才退出编辑态。
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await expect(page.locator('.palette-menu')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const rendered = page.locator('.table-block td[data-row="1"][data-col="0"] .cell-text')
  await expect(rendered.locator('[data-inline-color]')).toHaveCount(1)
  await expect(rendered.locator('[data-inline-bg]')).toHaveCount(1)
})

test('渲染态格内拖选文本也浮出工具条，格式写入并带回编辑态', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 15000 })
  await createTable(page)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await expect(page.locator('.table-block .cell-input')).toHaveCount(0)

  const shown = page.locator('.table-block td[data-row="1"][data-col="1"] .cell-text').first()
  const box = await shown.boundingBox()
  if (!box) throw new Error('量不到渲染态格 1,1')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 4, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 4, y, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(350)

  const toolbar = textMenu(page)
  await expect(toolbar).toBeVisible()
  // 同一个浮层：文本选区下只剩公共项，不该冒出合并 / 复制 / 删行列
  await expect(toolbar.locator('button[aria-label="加粗"]')).toBeVisible()
  await expect(toolbar.locator('button[aria-label="合并单元格"]')).toHaveCount(0)
  await expect(toolbar.locator('button[aria-label="复制"]')).toHaveCount(0)

  await toolbar.locator('button[title="加粗 (Ctrl+B)"]').click()
  await page.waitForTimeout(350)
  await expect(shown.locator('strong, b')).toHaveCount(1)

  // 渲染态写入必须已落库：重新激活后编辑态读同一份 cellMarks
  await page.locator('.table-block td[data-row="1"][data-col="1"]').click()
  await page.waitForTimeout(700)
  await expect(
    page.locator('.table-block .cell-input[data-row="1"][data-col="1"]').locator('strong, b'),
  ).toHaveCount(1)
})
