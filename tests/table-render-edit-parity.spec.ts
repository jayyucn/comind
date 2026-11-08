/**
 * 表格块「编辑态 / 渲染态」视觉对齐回归网。
 *
 * 锚定行为：
 * 1. 单元格折行时，两态**行高相同**。渲染态是 `<span>`（浏览器按内容撑开），编辑态是
 *    `<textarea rows="1">` + `overflow:hidden`，高度只由 `autoResize` 手写 ——
 *    所以每一次可能改变折行数的变更（重新挂载、结构操作、撤销/重做、宽度变化）
 *    都必须把**每一格**重量一遍，而不是只量当前聚焦的那一格。
 * 2. 编辑态不裁内容：textarea 的 scrollHeight 不大于 clientHeight。
 * 3. 空表头格在两态显示同一个占位「列名」（编辑态 placeholder / 渲染态 ::before）。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-render-edit-parity.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

/** 够长、能在 1/3 列宽里折到 3 行以上 */
const LONG_TEXT = '这是一段用来验证编辑态与渲染态行高是否一致的很长的单元格文本内容'

async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.type('/table', { delay: 30 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

async function cellHeight(page: Page, row: number, col: number) {
  const box = await page
    .locator(`.table-block td[data-row="${row}"][data-col="${col}"]`)
    .first()
    .boundingBox()
  if (!box) throw new Error(`量不到格 ${row},${col}`)
  return box.height
}

/** 点格：两态通用（编辑态落在 textarea 上，渲染态由 mousedown 激活整块并落光标） */
async function clickCell(page: Page, row: number, col: number) {
  await page.locator(`.table-block td[data-row="${row}"][data-col="${col}"]`).first().click()
  await page.waitForTimeout(400)
}

test.describe('表格块两态视觉对齐', () => {
  test('折行单元格在编辑态与渲染态行高一致、且不裁内容', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await createTable(page)

    // 长文本写进 (1,1)——故意不是首格：只有首格会被 mount 时的 focusFirstCell 重量
    await clickCell(page, 1, 1)
    await page.keyboard.type(LONG_TEXT, { delay: 5 })
    await page.waitForTimeout(500)

    const editingHeight = await cellHeight(page, 1, 1)
    expect(editingHeight).toBeGreaterThan(60) // 至少 3 行：21px × 3 + padding

    // 退出编辑态 → 渲染态（span 自然撑高）
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expect(page.locator('.table-block.is-readonly')).toBeVisible()
    const renderingHeight = await cellHeight(page, 1, 1)

    // 重新进入编辑态：此时全部单元格 DOM 重建，只有首格被自动重量
    await clickCell(page, 2, 2)
    const reenteredHeight = await cellHeight(page, 1, 1)

    expect(Math.abs(renderingHeight - editingHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(reenteredHeight - renderingHeight)).toBeLessThanOrEqual(1)

    // 内容不被 overflow:hidden 裁掉
    const overflow = await page
      .locator('.table-block textarea[data-row="1"][data-col="1"]')
      .first()
      .evaluate(el => (el as HTMLTextAreaElement).scrollHeight - (el as HTMLTextAreaElement).clientHeight)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('同行矮格的输入框拉满整格，下方不留点不到光标的死区', async ({ page }) => {
    test.setTimeout(90000)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await createTable(page)

    // 只有 (1,1) 折行；(1,0) 是一行短文本，行高被 (1,1) 撑高
    await clickCell(page, 1, 1)
    await page.keyboard.type(LONG_TEXT, { delay: 5 })
    await page.waitForTimeout(500)

    const sizes = await page
      .locator('.table-block td[data-row="1"][data-col="0"]')
      .first()
      .evaluate((td) => {
        const input = td.querySelector('textarea')
        return input
          ? { cell: (td as HTMLElement).clientHeight, input: input.offsetHeight }
          : null
      })
    expect(sizes).not.toBeNull()
    // td padding 为 0 ⇒ 输入框高度应等于格子内容高（±1px 边框取整）
    expect(Math.abs(sizes!.cell - sizes!.input)).toBeLessThanOrEqual(1)
    expect(sizes!.input).toBeGreaterThan(60)
  })

  test('空表头格在两态显示同一占位', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await createTable(page)

    // 编辑态：textarea 原生 placeholder
    await expect(page.locator('.table-block textarea[data-row="0"][data-col="0"]')).toHaveAttribute(
      'placeholder',
      '列名',
    )

    // 渲染态：::before 占位，且不落成文本节点（不进选区、不进复制）
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    const placeholder = page.locator('.table-block .header-cell .cell-text.is-placeholder').first()
    await expect(placeholder).toBeVisible()
    expect(await placeholder.evaluate(el => el.textContent)).toBe('')
    const content = await placeholder.evaluate(el => getComputedStyle(el, '::before').content)
    expect(content).toContain('列名')
  })

  test('编辑态加出来的行，退回渲染态必须还在', async ({ page }) => {
    // 末行按键追加行走的是「结构变更」路径：新行不带 dirty 标记，若只调 flushSave()
    // 会被 `!dirty` 挡在门外 —— 干净表格上加出来的行会在退回渲染态时凭空消失。
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await createTable(page)
    const rows = () =>
      page.evaluate(() => {
        const tds = Array.from(document.querySelectorAll('.table-block td[data-row]') as unknown as HTMLElement[])
        return Math.max(...tds.map(td => Number(td.dataset.row))) + 1
      })
    expect(await rows()).toBe(3)

    await clickCell(page, 2, 2)
    await page.keyboard.press('Tab') // 末行末格 Tab = 追加一行
    await page.waitForTimeout(600)
    expect(await rows()).toBe(4)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    await expect(page.locator('.table-block.is-readonly')).toBeVisible()
    expect(await rows()).toBe(4)
  })
})
