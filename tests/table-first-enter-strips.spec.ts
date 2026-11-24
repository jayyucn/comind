/**
 * 表格块「首次进入页面」行列条几何回归网。
 *
 * 锚定行为：切走再切回页面（block 重新挂载并播放 block-enter 动画）后，
 * 行列操作条与「+」按钮仍与表格边框严丝合缝，不残留缩放偏差。
 *
 * 为什么需要这层网：每个新挂载的 block 都带 `block-enter`（300ms，
 * `transform: translateY(...) scale(0.96) → scale(1)`，见 _block.scss）。
 * TableBlock 的 onMounted 测量正好落在动画首帧，getBoundingClientRect 量到的是
 * **被缩放的视口坐标**；把这些值写成相对块根的 inline px，动画结束后条就永久
 * 偏小一圈（列条左移 0.8px、末列短 8px、末行短 4px），「+」随条一起偏。
 * ResizeObserver 只报 border-box（transform 不改布局尺寸），不会兜底重测；
 * 激活块会重挂载 TableBlock（此时外层动画已结束），于是看起来「激活一下就好了」。
 *
 * 运行：`npm run dev`（已起则复用）后
 * `npx playwright test tests/table-first-enter-strips.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await wait(300)
  await page.keyboard.type('/table', { delay: 30 })
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(800)
  for (let i = 0; i < 9; i += 1) {
    const row = Math.floor(i / 3)
    const col = i % 3
    await page.locator(`.table-block .cell-input[data-row="${row}"][data-col="${col}"]`).first().click()
    await page.keyboard.type(`R${row}C${col}`, { delay: 5 })
  }
  await wait(400)
}

/** SPA 内导航：不刷新页面，store 里的表格数据仍在，组件会真正卸载 / 重挂载 */
const go = (page: Page, path: string) => page.evaluate(p => {
  history.pushState({}, '', p)
  window.dispatchEvent(new PopStateEvent('popstate'))
}, path)

test('切走再切回页面后，行列条仍贴合表格（block-enter 缩放动画不残留偏差）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()

  const home = new URL(page.url()).pathname
  await go(page, '/tasks')
  await wait(400)
  await go(page, home)
  // 300ms block-enter + 余量：动画彻底结束后才量，量的是「残留偏差」而非动画中间帧
  await wait(1000)
  await expect(page.locator('.table-block.is-readonly')).toBeVisible()

  const geo = await page.evaluate(() => {
    const table = document.querySelector('.block-table')
    if (!table) throw new Error('量不到表格')
    const t = table.getBoundingClientRect()
    const cols = Array.from(document.querySelectorAll<HTMLElement>('.strip--col'))
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.strip--row'))
    const rect = (el: Element | undefined) => el?.getBoundingClientRect() ?? null
    const firstCol = rect(cols[0])
    const lastCol = rect(cols[cols.length - 1])
    const firstRow = rect(rows[0])
    const lastRow = rect(rows[rows.length - 1])
    return {
      colCount: cols.length,
      rowCount: rows.length,
      tableLeft: t.left, tableTop: t.top, tableRight: t.right, tableBottom: t.bottom,
      firstColLeft: firstCol?.left ?? null,
      firstColTop: firstCol?.top ?? null,
      lastColRight: lastCol?.right ?? null,
      firstRowLeft: firstRow?.left ?? null,
      firstRowTop: firstRow?.top ?? null,
      lastRowBottom: lastRow?.bottom ?? null,
    }
  })

  expect(geo.colCount).toBe(3)
  expect(geo.rowCount).toBe(3)
  // 列条：整排贴表格上缘外侧，首段左缘对齐、末段右缘对齐表格右边
  expect(Math.abs(geo.firstColLeft! - geo.tableLeft)).toBeLessThan(1)
  expect(Math.abs(geo.firstColTop! - (geo.tableTop - 10))).toBeLessThan(1)
  expect(Math.abs(geo.lastColRight! - geo.tableRight)).toBeLessThan(1)
  // 行条：整列贴表格左缘外侧，首段上缘对齐、末段下缘对齐表格底边
  expect(Math.abs(geo.firstRowLeft! - (geo.tableLeft - 10))).toBeLessThan(1)
  expect(Math.abs(geo.firstRowTop! - geo.tableTop)).toBeLessThan(1)
  expect(Math.abs(geo.lastRowBottom! - geo.tableBottom)).toBeLessThan(1)
})
