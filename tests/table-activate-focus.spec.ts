/**
 * 表格块「渲染态单击 → 激活后光标落点」回归网。
 *
 * 锚定行为：
 * 1. 点哪一格，激活后光标就落在哪一格 —— 不是首格。
 * 2. 坐标解析不出格时（点在格线上、表格留白里、滚动/动画期间的 `elementFromPoint` 落空），
 *    也不能把已经落在本表某格里的光标抢回首格。
 *
 * 为什么需要这层网：渲染态与编辑态在 `Block/index.vue` 里是两个 `<component>` 分支，
 * 激活会把 TableBlock **重新挂载**，组件内的局部 ref 活不过去；挂载默认 `focusFirstCell()`，
 * 全靠随后的 `focusAtCoords` 二次兜底才回到正确格 —— 坐标一落空就是「点最后一行跳到第一行」。
 * 现在坐标经 editorStore 交接给新挂载的那一份（见 `pendingTableCellFocus`）。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-activate-focus.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const LONG_TEXT = '这是一段用来撑高整行的很长的单元格文本内容'

async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.type('/table', { delay: 30 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

/** 造一张有内容、且中间行被撑高的表，然后退回渲染态（块未激活） */
async function seedTable(page: Page) {
  await createTable(page)
  await page.locator('.table-block td[data-row="1"][data-col="1"]').first().click()
  await page.keyboard.type(LONG_TEXT, { delay: 4 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()
}

async function focusedCell(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      tag: el?.tagName ?? null,
      row: el?.dataset?.row ?? null,
      col: el?.dataset?.col ?? null,
    }
  })
}

async function clickCell(page: Page, row: number, col: number, dy = 0) {
  const box = await page.locator(`.table-block td[data-row="${row}"][data-col="${col}"]`).first().boundingBox()
  if (!box) throw new Error(`量不到格 ${row},${col}`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + dy)
  await page.waitForTimeout(800)
}

test.describe('渲染态单击后的光标落点', () => {
  test('点最后一行的格，光标落在该格（不是首格）', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await seedTable(page)

    await clickCell(page, 2, 1)
    expect(await focusedCell(page)).toEqual({ tag: 'TEXTAREA', row: '2', col: '1' })

    // 换一格再点，确认不是「恰好最后一次对」
    await page.mouse.click(5, 5)
    await page.waitForTimeout(400)
    await clickCell(page, 2, 2)
    expect(await focusedCell(page)).toEqual({ tag: 'TEXTAREA', row: '2', col: '2' })
  })

  test('坐标解析不出格时，也不会把光标抢回首格', async ({ page }) => {
    // 模拟「按坐标找不到格」：JS 侧一律只返回块根容器（真实浏览器里点在格线、
    // 表格留白、或滚动动画期间就是这个结果）。事件派发仍走真实命中测试。
    await page.addInitScript(() => {
      const original = document.elementFromPoint.bind(document)
      document.elementFromPoint = (x: number, y: number) => {
        const hit = original(x, y) as HTMLElement | null
        return (hit?.closest?.('.table-block') as HTMLElement | null) ?? hit
      }
    })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await seedTable(page)

    await clickCell(page, 2, 1)
    expect(await focusedCell(page)).toEqual({ tag: 'TEXTAREA', row: '2', col: '1' })
  })
})
