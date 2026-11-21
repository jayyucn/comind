/**
 * 块入口（block entry）回归网：所有块类型的入口统一为 Block 外壳 `.block-bullet` 里的
 * 一个胶囊 —— 类型字形 + 拖拽握把，由 handler 的 `entryIcon` 驱动（缺省落文本 `Type` 字形）。
 *
 * 钉死的行为：
 * 1. 外壳**不再渲染** `.bullet-dot`（dot 只剩 Backlinks / Ideas 快照 / embed 子块在用）；
 * 2. 胶囊仅 hover 块时显现（显隐挂在 `.block-row:hover` 上，自身 `pointer-events:none` 时
 *    永远触发不了 `:hover`，所以必须有块那一路）；
 * 3. 点胶囊打开块菜单（ADR-0039 D9：菜单归外壳，类型专属项经 useBlockEntryMenuExtra
 *    由 handler 交出）；
 * 4. 胶囊同时是拖拽手柄（`handle=".block-bullet"`），按下即能起拖；
 * 5. 点入口不再弹 BlockModal（主编辑器已无弹窗入口）。
 *
 * 运行：`npm run dev`（已起则复用）后
 * `npx playwright test tests/block-entry.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 在首块用 slash 菜单造一个表格块，并填两个格（内容非空才进渲染态） */
async function createTable(page: Page) {
  await page.locator('.block').first().click()
  await wait(300)
  await page.keyboard.type('/table', { delay: 30 })
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(800)
  for (let i = 0; i < 2; i += 1) {
    await page.locator(`.table-block .cell-input[data-row="0"][data-col="${i}"]`).first().click()
    await page.keyboard.type(`C${i}`, { delay: 5 })
  }
  await wait(400)
}

/** 造一个查询块（slash 菜单要先等条目渲染完再回车） */
async function createQuery(page: Page) {
  await page.locator('.block').first().click()
  await wait(300)
  await page.keyboard.type('/query', { delay: 30 })
  await page.locator('.slash-command-menu .slash-command-item').first().waitFor({ state: 'visible' })
  await page.keyboard.press('Enter')
  await wait(800)
}

/** 某元素的 computed opacity */
const opacityOf = (page: Page, selector: string) => page.evaluate(
  sel => Number(Number(getComputedStyle(document.querySelector(sel) as HTMLElement).opacity).toFixed(2)),
  selector,
)

test('表格块：入口是类型胶囊（字形 + 握把），bullet dot 不再渲染', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)

  const tableBlock = page.locator('.block:has(.table-block)').first()
  await expect(tableBlock.locator('.block-entry-icon')).toHaveCount(1)
  await expect(tableBlock.locator('.block-entry-grip')).toHaveCount(1)
  // 外壳里不该再有 dot —— 文本块也一样（见下方文本块用例）
  await expect(tableBlock.locator('> .block-row > .block-inner > .block-bullet > .bullet-dot')).toHaveCount(0)
})

test('入口图标仅 hover 显现', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  const icon = page.locator('.block-entry-icon').first()
  // 鼠标挪到页面空白处：块不 hover，图标隐藏
  await page.mouse.move(5, 5)
  await wait(400)
  expect(await opacityOf(page, '.block-entry-icon')).toBe(0)

  // 移到表格块上（不直接移图标）：显隐挂在块 hover 上
  await page.locator('.table-block').first().hover()
  await wait(400)
  expect(await opacityOf(page, '.block-entry-icon')).toBe(1)
  await expect(icon).toBeVisible()
})

test('点入口图标打开表格菜单', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  const tableBlock = page.locator('.block:has(.table-block)').first()
  await tableBlock.locator('.table-block').hover()
  await wait(300)
  await tableBlock.locator('.block-entry-icon').click()
  await wait(500)

  // 菜单本体仍由 TableBlock 渲染（data-table-menu 是它的句柄，也是格选区豁免标识）
  await expect(page.locator('.block-entry-menu')).toBeVisible()

  // 菜单项顺序：类型专属项（表头开关 / 均分列宽）在前，通用段在后，删除收尾。
  // 通用段与 query 块共用 BlockMenuCommon，所以只有这里能锁住表格的插入位置。
  const items = await page
    .locator('.block-entry-menu [data-block-menu-item]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-menu-item')))
  expect(items).toEqual([
    'header',
    'equal-columns',
    'insert-above',
    'insert-below',
    'indent',
    'outdent',
    'copy',
    'cut',
    'paste',
    'reset-text',
    'delete',
  ])

  // 六条分隔线：表头开关后、专属段与通用段之间、插入组后、缩进组后、剪贴板组后、重置后。
  // 专属段后那条由通用段自带（noDividerTop 未置），缺了就是「布尔 prop 省略被转 false」的老毛病。
  await expect(page.locator('.block-entry-menu .menu-sep')).toHaveCount(6)
})

test('从入口图标按下即可起拖（图标即拖拽手柄）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  const box = await page.locator('.block-entry-icon').first().boundingBox()
  if (!box) throw new Error('量不到入口图标')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await wait(250)
  await page.mouse.down()
  // Sortable 有拖动阈值，分步移动才能触发 dragstart
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2 + 10, { steps: 4 })
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 40, { steps: 6 })
  await wait(250)
  // drag-class="block-drag"：Sortable 拖拽期的本体类名
  await expect(page.locator('.block-bullet.block-drag, .block-drag')).toHaveCount(1)
  await page.mouse.up()
  await wait(400)
})

test('入口图标住角块：不压首行操作条、不缩小、不左移', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)

  // 表格块的入口胶囊住在「角块」：表格左上角、列条左端、首行条上方那块空白。
  // 它必须在纵向让出首行条（条带 33px 高，bullet 抬层后 z 高于条带，压上去就点不到），
  // 横向则与文本块同口径：胶囊 24px、右缘贴住入口格右缘（= 表格左缘），向左悬出 4px。
  await page.locator('.table-block').first().hover()
  await wait(400)

  const geo = await page.evaluate(() => {
    const iconEl = document.querySelector('.block-row:has(.table-block) .block-entry-icon')
    const stripEl = document.querySelector('.table-block .strip--row.is-first')
    const bulletEl = document.querySelector('.block-row:has(.table-block) .block-bullet')
    if (!iconEl || !stripEl || !bulletEl) return null
    const icon = iconEl.getBoundingClientRect()
    const strip = stripEl.getBoundingClientRect()
    const bullet = bulletEl.getBoundingClientRect()
    const hit = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      return el ? String(el.className) : 'none'
    }
    const cx = strip.left + strip.width / 2
    return {
      iconW: icon.width,
      iconH: icon.height,
      iconLeft: icon.left,
      iconRight: icon.right,
      iconBottom: icon.bottom,
      bulletLeft: bullet.left,
      bulletRight: bullet.right,
      bulletW: bullet.width,
      stripLeft: strip.left,
      stripRight: strip.right,
      stripTop: strip.top,
      stripWidth: strip.width,
      // 条带顶（+3px，避开圆角）与中点都必须命中条自己
      hitTop: hit(cx, strip.top + 3),
      hitMid: hit(cx, strip.top + strip.height / 2),
      click: { x: cx, y: strip.top + strip.height / 2 },
    }
  })
  if (!geo) throw new Error('量不到入口图标或首行条')

  // 入口格仍是 20px（布局基准不动），胶囊 24px：正文左缘不因胶囊变宽而挪动
  expect(geo.bulletW).toBeCloseTo(20, 0)
  expect(geo.iconW).toBeCloseTo(24, 0)
  expect(geo.iconLeft).toBeCloseTo(geo.bulletLeft - 4, 0)
  expect(geo.iconRight).toBeCloseTo(geo.bulletRight, 0)
  // 右缘落在表格左缘（也就是行条右缘）上
  expect(Math.abs(geo.iconRight - geo.stripRight)).toBeLessThanOrEqual(1)
  // 让出条带：图标底边不越过条带顶（允许 2px 的圆角膜差）
  expect(geo.iconBottom).toBeLessThanOrEqual(geo.stripTop + 2)
  // 角块高度只为容下一个字形，不是整行高
  expect(geo.iconH).toBeLessThanOrEqual(14)

  expect(geo.stripWidth).toBeGreaterThanOrEqual(9)
  expect(geo.hitTop).toContain('strip')
  expect(geo.hitMid).toContain('strip')

  // 点下去必须开的是行/范围菜单（图标抢走的话会开表格菜单，或什么都不开）
  await page.mouse.click(geo.click.x, geo.click.y)
  await expect(page.locator('.range-menu')).toBeVisible()
})

test('文本块：入口同样是类型胶囊（T 字形 + 握把），外壳不再渲染 dot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)

  const bulletBlock = page.locator('.block[data-block-id]').first()
  await expect(bulletBlock.locator('.block-entry-icon')).toHaveCount(1)
  await expect(bulletBlock.locator('.block-entry-grip')).toHaveCount(1)
  await expect(bulletBlock.locator('.bullet-dot')).toHaveCount(0)
})

test('文本块：点入口胶囊打开同一套菜单，且不再弹 BlockModal（ADR-0039 D9）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)

  // 空块的胶囊同样默认隐藏（hover 才现），先给它一行正文再点
  const block = page.locator('.block[data-block-id]').first()
  await block.click()
  await wait(300)
  await page.keyboard.type('DOT-MENU', { delay: 20 })
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(400)

  await block.hover()
  await wait(250)
  await block.locator('> .block-row > .block-inner > .block-bullet > .block-entry-icon').click()
  await wait(400)

  await expect(page.locator('.block-entry-menu')).toBeVisible()
  // 文本块的入口不再通向子树编辑弹窗
  await expect(page.locator('.block-modal-overlay')).toHaveCount(0)

  // 没有类型专属项，所以项序就是通用段本身，且不带前置分隔线
  const items = await page
    .locator('.block-entry-menu [data-block-menu-item]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-menu-item')))
  expect(items).toEqual([
    'insert-above',
    'insert-below',
    'indent',
    'outdent',
    'copy',
    'cut',
    'paste',
    'reset-text',
    'delete',
  ])
  await expect(page.locator('.block-entry-menu .menu-sep')).toHaveCount(4)
})

test('查询块：入口同样是类型图标而非 dot', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createQuery(page)

  const queryBlock = page.locator('.block:has(.query-block)').first()
  await expect(queryBlock.locator('.block-entry-icon')).toHaveCount(1)
  await expect(queryBlock.locator('> .block-row > .block-inner > .block-bullet > .bullet-dot')).toHaveCount(0)
})

/** 打开某块的入口菜单（入口只在块 hover 时可见可点） */
async function openMenu(page: Page, blockSelector: string) {
  const block = page.locator(blockSelector).first()
  await block.locator('.table-block, .query-block').first().hover()
  await wait(250)
  await block.locator('.block-entry-icon').click()
  await expect(page.locator('.block-entry-menu')).toBeVisible()
}

test('通用菜单项：在下方插入新块，落在表格块紧邻位置并接管光标', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  const before = await page.locator('.block').count()
  await openMenu(page, '.block:has(.table-block)')
  await page.locator('[data-block-menu-item="insert-below"]').click()
  await wait(600)

  await expect.poll(async () => page.locator('.block').count()).toBe(before + 1)
  // 表格块在前，新块紧随其后：空文本块（同样是胶囊入口，只是字形为 T）、且直接进编辑态
  const blocks = page.locator('.block')
  await expect(blocks.first().locator('.table-block')).toHaveCount(1)
  const inserted = blocks.nth(1)
  await expect(inserted.locator('.table-block')).toHaveCount(0)
  await expect(inserted.locator('> .block-row > .block-inner > .block-bullet > .block-entry-icon')).toHaveCount(1)
  await expect(inserted).toHaveClass(/active/)
})

test('通用菜单项：在上方插入新块，落在表格块之前', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  await openMenu(page, '.block:has(.table-block)')
  await page.locator('[data-block-menu-item="insert-above"]').click()
  await wait(600)

  const blocks = page.locator('.block')
  await expect(blocks.first().locator('.table-block')).toHaveCount(0)
  await expect(blocks.nth(1).locator('.table-block')).toHaveCount(1)
  await expect(page.locator('.table-block')).toHaveCount(1)
})

test('通用菜单项：清空 → 表格消失成空文本块；Ctrl+Z 把表格整体找回', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await createTable(page)
  await page.keyboard.press('Escape')
  await wait(500)

  const cellText = await page.locator('.table-block').first().innerText()
  expect(cellText).toContain('C0')

  await openMenu(page, '.block:has(.table-block)')
  await page.locator('[data-block-menu-item="reset-text"]').click()
  await wait(800)

  // 删块 + 同位置新建：表格没了，那一行变成普通文本块
  await expect(page.locator('.table-block')).toHaveCount(0)
  await expect(page.locator('.bullet-dot')).toHaveCount(0)
  await expect(page.locator('.block-entry-icon')).toHaveCount(1)

  // 撤销：块连同表格配置一起回来（删除与新建在同一个快照步里）
  await page.keyboard.press('Escape')
  await wait(200)
  await page.keyboard.press('Control+z')
  await expect(page.locator('.table-block')).toHaveCount(1)
  await expect
    .poll(async () => page.locator('.table-block').first().innerText())
    .toContain('C0')
})
