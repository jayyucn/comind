/**
 * 表格块「长表格 + 已滚动」时单击底部的回归网。
 *
 * 锚定两条：
 * 1. 激活后**视口不跳** —— 编辑态首帧每一格都是 `rows="1"` 的一行高，块高瞬间塌陷，滚动祖先
 *    的内容高度跟着缩水，浏览器把 `scrollTop` 钳到塌陷后的上限（实测 16 行表格 1218 → 45）。
 *    高度随后虽被重量回来，`scrollTop` 不会自己回来。
 * 2. 光标落在**点的那一格** —— 像素坐标是 mousedown 那一刻的视口坐标，等 `focusActiveEditor`
 *    的 rAF 用到它时滚动位置可能已经变了，`elementFromPoint` 会解析成另一格。
 *    表现为「光标在我点的屏幕位置上，但那已经不是点的那一格了」。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/table-activate-scroll.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const LONG_TEXT = '这是一段用来撑高整行的很长的单元格文本内容用于制造一个足够长需要滚动才能看到底部的表格'

async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  await page.keyboard.type('/table', { delay: 30 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

/** 造一张足够长（纵向溢出）的表：每行都塞长文本撑高，最后退回渲染态 */
async function seedLongTable(page: Page, rowCount: number) {
  await createTable(page)
  await page.locator('.table-block td[data-row="1"][data-col="1"]').first().click()
  await page.waitForTimeout(300)
  for (let i = 0; i < rowCount; i++) {
    await page.keyboard.type(LONG_TEXT, { delay: 1 })
    await page.keyboard.press('Enter') // 末行 Enter = 追加一行
    await page.waitForTimeout(110)
  }
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()
}

/** 表格最近的纵向滚动祖先（overflow-y auto|scroll 且内容确实溢出）的滚动状态 */
function scrollerState(page: Page) {
  return page.evaluate(() => {
    let el = document.querySelector('.table-block')?.parentElement ?? null
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
        const box = el as HTMLElement
        return {
          cls: box.className,
          top: Math.round(box.scrollTop),
          scrollHeight: box.scrollHeight,
          clientHeight: box.clientHeight,
        }
      }
      el = el.parentElement
    }
    return null
  })
}

async function scrollToBottom(page: Page) {
  const state = await page.evaluate(() => {
    let el = document.querySelector('.table-block')?.parentElement ?? null
    while (el && el !== document.body) {
      const cs = getComputedStyle(el)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) break
      el = el.parentElement
    }
    if (!el) return null
    const box = el as HTMLElement
    box.scrollTop = box.scrollHeight
    return { cls: box.className, top: Math.round(box.scrollTop), scrollHeight: box.scrollHeight, clientHeight: box.clientHeight }
  })
  await page.waitForTimeout(300)
  return state
}

function focusedCell(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return { tag: el?.tagName ?? null, row: el?.dataset?.row ?? null, col: el?.dataset?.col ?? null }
  })
}

/** 点击坐标此刻压在哪个格上（用来判断「视口跑掉了 → 同一屏幕坐标变成另一格」） */
function cellAtPoint(page: Page, x: number, y: number) {
  return page.evaluate(({ px, py }) => {
    const hit = document.elementFromPoint(px, py) as HTMLElement | null
    const td = hit?.closest?.('td[data-row][data-col]') as HTMLElement | null
    return td ? { row: td.dataset.row, col: td.dataset.col } : null
  }, { px: x, py: y })
}

test.describe('长表格滚动到底部后单击单元格', () => {
  test('页面不跳、光标落在点的那一格', async ({ page }) => {
    test.setTimeout(180000)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await seedLongTable(page, 14)

    const before = await scrollToBottom(page)
    expect(before, '没找到可滚动的祖先，说明表格没造够长').not.toBeNull()
    // 打底：确实是「看不到底、需要滚动」的长表格
    expect(before!.scrollHeight).toBeGreaterThan(before!.clientHeight + 200)

    const rows = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('.table-block td[data-row]') as unknown as HTMLElement[])
      return Math.max(...tds.map(td => Number(td.dataset.row))) + 1
    })
    const lastRow = rows - 1
    const box = await page
      .locator(`.table-block td[data-row="${lastRow}"][data-col="1"]`)
      .first()
      .boundingBox()
    if (!box) throw new Error(`量不到格 ${lastRow},1`)
    const clickX = box.x + 30
    const clickY = box.y + box.height / 2

    await page.mouse.click(clickX, clickY)
    await page.waitForTimeout(1200)

    // 1. 视口不跳：塌陷那一帧被钳掉的 scrollTop 必须还原
    const after = await scrollerState(page)
    expect(after, '激活后找不到滚动祖先').not.toBeNull()
    expect(Math.abs(after!.top - before!.top)).toBeLessThanOrEqual(2)

    // 2. 光标落在点击的那一格，且点击坐标此刻仍压在同一格上（两者互相印证「没有位移」）
    expect(await focusedCell(page)).toEqual({ tag: 'TEXTAREA', row: String(lastRow), col: '1' })
    expect(await cellAtPoint(page, clickX, clickY)).toEqual({ row: String(lastRow), col: '1' })
  })

  test('像素坐标解析到别的格时，也不能把交接好的光标改走', async ({ page }) => {
    // 模拟「按坐标解析出的是另一格」：mousedown 的视口坐标在激活后被重新解析时，若此刻滚动位置
    // 已经变了（或被 focus 带偏），`elementFromPoint` 就会指到别的格。格行列交接比像素坐标精确，
    // 它一旦生效，像素坐标不该再改主意。
    await page.addInitScript(() => {
      const original = document.elementFromPoint.bind(document)
      document.elementFromPoint = (x: number, y: number) => {
        const hit = original(x, y) as HTMLElement | null
        // 只劫持表格内部的命中：一律换成首格，等价于「坐标过期」
        const td = hit?.closest?.('td[data-row][data-col]') as HTMLElement | null
        if (!td) return hit
        return document.querySelector('.table-block td[data-row="0"][data-col="0"]') ?? hit
      }
    })
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(800)
    await seedLongTable(page, 6)

    const rows = await page.evaluate(() => {
      const tds = Array.from(document.querySelectorAll('.table-block td[data-row]') as unknown as HTMLElement[])
      return Math.max(...tds.map(td => Number(td.dataset.row))) + 1
    })
    const lastRow = rows - 1
    const box = await page
      .locator(`.table-block td[data-row="${lastRow}"][data-col="1"]`)
      .first()
      .boundingBox()
    if (!box) throw new Error(`量不到格 ${lastRow},1`)

    await page.mouse.click(box.x + 30, box.y + box.height / 2)
    await page.waitForTimeout(1200)
    expect(await focusedCell(page)).toEqual({ tag: 'TEXTAREA', row: String(lastRow), col: '1' })
  })
})
