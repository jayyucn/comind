/**
 * 选区色块连续性回归（ADR-0065）。
 *
 * 锚定行为：一段选区**内部不得出现 1px 的异色行**。
 *
 * 为什么需要这层网：选区色是半透明的一层，凡是「逐块 / 逐行」各画一层，相邻两层
 * 在相切处就有两道独立边界。DPR = 1 时覆盖率正好拼满（看不出来）；Windows 125%/150%
 * 或浏览器缩放下边界落在分数设备像素上，覆盖率会差一点（露一条浅缝）或多一点（叠一条
 * 深线）。所以本 spec 只在 `dpr125` project 里跑 —— 100% 缩放下它本来就是绿的。
 *
 * 判据用「孤行检测」而不是「整段同色」：选区下面可能压着不同衬底（代码块底色、
 * 表头），那是合法的台阶；真正的缺陷是**只有一行**与众不同的尖刺。
 *
 * 运行：`npx playwright test tests/selection-seam.spec.ts --project=dpr125`
 */
import { test, expect, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

// Playwright 自带 pngjs（utilsBundle 内部打包），不额外引依赖
const { PNG } = createRequire(`${process.cwd()}/`)('playwright-core/lib/utilsBundle') as {
  PNG: { sync: { read: (b: Buffer) => { width: number; height: number; data: Buffer } } }
}

/** 单行异色判据：与上下邻居都不同、而上下邻居彼此相同（= 一条 1px 线，不是衬底台阶） */
const SPIKE_DELTA = 8
const NEIGHBOR_DELTA = 4

async function build(page: Page) {
  await page.locator('.block').first().click()
  await page.waitForTimeout(300)
  const line = async (text: string) => {
    await page.keyboard.type(text, { delay: 8 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
  }
  await line('1. 第一项')
  await line('2. 第二项')
  await page.keyboard.press('Tab')
  // 这个块会折成多行 —— 「block 内多行」的那一类
  await line('水电费撒旦法水电费撒旦法水电费撒旦法水电费撒旦法水电费撒旦法水电费撒旦法水电费撒旦法水电费撒旦法')
  await line('子项甲')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('/code', { delay: 20 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await line('#include iostream;')
  await line('# 标题一')
  await line('## 标题二')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

/** 逐行取「主色」（一行里出现次数最多的 RGB），再找 1px 尖刺行 */
function spikeRows(png: { width: number; height: number; data: Buffer }) {
  const { width, height, data } = png
  const rowColor: Array<[number, number, number] | null> = []
  for (let y = 0; y < height; y++) {
    const tally = new Map<string, number>()
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`
      tally.set(key, (tally.get(key) ?? 0) + 1)
    }
    let best: string | null = null
    let bestN = 0
    for (const [k, n] of tally) if (n > bestN) { best = k; bestN = n }
    rowColor.push(best ? (best.split(',').map(Number) as [number, number, number]) : null)
  }
  const dist = (a: [number, number, number], b: [number, number, number]) =>
    Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
  const spikes: number[] = []
  for (let y = 1; y < rowColor.length - 1; y++) {
    const [p, c, n] = [rowColor[y - 1], rowColor[y], rowColor[y + 1]]
    if (!p || !c || !n) continue
    if (dist(p, c) > SPIKE_DELTA && dist(c, n) > SPIKE_DELTA && dist(p, n) <= NEIGHBOR_DELTA) spikes.push(y)
  }
  return { spikes, rowColor }
}

async function scanRects(page: Page, selector: string) {
  const rects = await page.$$eval(selector, els =>
    els.map(el => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }),
  )
  expect(rects.length, `${selector} 应当渲染出矩形`).toBeGreaterThan(0)
  for (const r of rects) {
    if (r.width < 40 || r.height < 30) continue
    // 只取矩形内部一窄条，避开左右端点与圆角
    const clip = {
      x: Math.round(r.left + 4),
      y: Math.round(r.top + 2),
      width: Math.max(8, Math.round(r.width - 8)),
      height: Math.max(8, Math.round(r.height - 4)),
    }
    const png = PNG.sync.read(await page.screenshot({ clip }))
    const { spikes } = spikeRows(png)
    expect(spikes, `选区矩形 (${clip.x},${clip.y},${clip.width}x${clip.height}) 内部出现 1px 异色行：${spikes.join(',')}`)
      .toEqual([])
  }
}

test('块全选：单层矩形 + 段内无 1px 缝 / 叠线', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'dpr125', '只在 DPR 1.25 project 跑')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await build(page)

  await page.locator('.block-text').first().click()
  await page.waitForTimeout(250)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(80)
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(400)
  expect(await page.locator('.block.cb-selected').count()).toBeGreaterThan(1)

  // 结构断言：连续段已合并——不存在「左右同缘且纵向相切」的两条矩形
  const rects = await page.$$eval('.block-selection-rect', els =>
    els.map(el => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }),
  )
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]
      const b = rects[j]
      const sameEdges = Math.abs(a.left - b.left) <= 0.5 && Math.abs(a.right - b.right) <= 0.5
      const touching = Math.abs(a.bottom - b.top) <= 0.5 || Math.abs(b.bottom - a.top) <= 0.5
      expect(sameEdges && touching, `矩形 ${i}/${j} 相邻同缘却未合并`).toBe(false)
    }
  }

  await scanRects(page, '.block-selection-rect')
})

test('文本拖选（跨多行块）：行带压成单层后无 1px 缝 / 叠线', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'dpr125', '只在 DPR 1.25 project 跑')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
  await build(page)

  // 从第一块的文字拖到最后一块：走的是 useCrossBlockSelection 的文本拖拽路径
  const first = await page.locator('.block-text').first().boundingBox()
  const last = await page.locator('.block-text').last().boundingBox()
  if (!first || !last) throw new Error('量不到文本块')
  await page.mouse.move(first.x + 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + 40, first.y + first.height / 2, { steps: 4 })
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, { steps: 20 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  await scanRects(page, '.text-selection-rect')
})
