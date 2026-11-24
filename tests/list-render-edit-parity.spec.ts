/**
 * 列表 / 标题块「编辑态 / 渲染态」行盒对齐回归网。
 *
 * 锚定行为（2026-11 实测故障）：
 * 1. 前缀 span（`.pm-prefix-hidden`）字号被放大到 1.5em 换插入符高度，它是 inline-block，
 *    默认按**自身基线**与段落 strut 对齐 —— 基线比 16px 正文低 2.8px，于是整段行盒被顶高
 *    （列表 24.41 → 26.41），**正文下沉 1px、`::before` 标记上浮 1px**。渲染态两者都钉死在
 *    同一处，肉眼就是「点进列表，f 掉下去、圆点浮上来」。修法见 Editor.vue
 *    （top 对齐 + 盒高锁 1 行 + 标题级 line-height），这里只锁结果。
 * 2. 前缀内的插入符原来落在行盒顶（比正文光标高 2px）：敲下第一个字时光标「往下跳一下」。
 * 3. h4–h6 的标题行高比正文行高还小，段落 strut 会把行盒顶回 24.4 —— 也要逐级对齐。
 *
 * 断言只用「两态相对差」，不写死像素值：字体或 token 微调不该让这条回归网失效。
 *
 * 运行：`npm run dev`（已起则复用）后
 * `npx playwright test tests/list-render-edit-parity.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const round = (n: number) => Math.round(n * 100) / 100

/**
 * PNG 解码（仅 8bit RGB/RGBA —— playwright 截图就是这两种）。
 * 列表标记的差异常是 1–2px，几何断言量不到伪元素字形，只能落到像素上。
 */
function decodePng(path: string) {
  const b = readFileSync(path)
  let o = 8
  let w = 0, h = 0, ct = 0
  const idat: Buffer[] = []
  while (o < b.length) {
    const len = b.readUInt32BE(o)
    const type = b.toString('ascii', o + 4, o + 8)
    const data = b.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 4
  const stride = w * ch
  const out = Buffer.alloc(w * h * ch)
  let pos = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0
      const bb = prev[i]
      const c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (ft === 1) v += a
      else if (ft === 2) v += bb
      else if (ft === 3) v += (a + bb) >> 1
      else if (ft === 4) {
        const p = a + bb - c
        const pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c
      }
      cur[i] = v & 0xff
    }
  }
  return { w, h, ch, data: out }
}

/** 窗口内的墨迹包围盒（浅色底，灰度 < 240 视为有墨） */
function inkBox(path: string, x0: number, x1: number, y0: number, y1: number) {
  const { w, h, ch, data } = decodePng(path)
  let top = -1, bottom = -1, left = -1, right = -1, mass = 0
  for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const v = data[(y * w + x) * ch]
      if (v < 240) {
        mass += 255 - v
        if (top < 0) top = y
        bottom = y
        if (left < 0 || x < left) left = x
        if (x > right) right = x
      }
    }
  }
  return { top, bottom, left, right, mass }
}

/**
 * 列表标记（圆点 / 序号）的两态墨迹对照。
 *
 * 断言的是「标记字形落在哪几个像素上」，因为这条差异的根因在盒宽：
 * 编辑态伪元素曾经用 `min-width: 14px`，圆点 `•` 的 advance 是 16px，把盒子撑宽 2px；
 * 盒子右缘被 `right: 8px` 钉死 ⇒ 多出的 2px 长在左边，左对齐的字形跟着左移 2px。
 * 垂直方向与正文一致（`markerTop` 恒 0），只有水平会差 —— 所以两个轴都断言。
 */
async function assertMarkerParity(page: Page, prefix: string, body: string, items = 1) {
  await typeBlock(page, prefix, body, items)

  const editGeo = await page.evaluate(() => {
    const p = document.querySelector('.ProseMirror-focused p, .ProseMirror p') as HTMLElement
    const block = p.closest('.block') as HTMLElement
    const span = p.querySelector('.pm-prefix-hidden') as HTMLElement | null
    if (!span) throw new Error('编辑态没有前缀 span')
    const be = getComputedStyle(span, '::before')
    const sr = span.getBoundingClientRect()
    // `right` 是「盒子右缘距 containing block（宽 0 的 span）右缘 8px」
    const right = sr.right - parseFloat(be.right)
    const bb = block.getBoundingClientRect()
    return {
      block: { left: bb.left, top: bb.top, width: bb.width, height: bb.height },
      marker: { left: right - parseFloat(be.width), right },
    }
  })

  const clip = {
    x: Math.round(editGeo.block.left),
    y: Math.round(editGeo.block.top),
    width: Math.round(editGeo.block.width),
    height: Math.round(editGeo.block.height) + 4,
  }
  const editPath = 'test-results/marker-edit.png'
  await page.screenshot({ path: editPath, clip })
  const rel = (v: number) => Math.round(v - clip.x)
  const markX0 = rel(editGeo.marker.left) - 2
  const markX1 = rel(editGeo.marker.right) + 2
  const editInk = inkBox(editPath, markX0, markX1, 0, clip.height)

  await page.keyboard.press('Escape')
  await wait(600)
  await page.waitForFunction(() => !document.querySelector('.ProseMirror-focused'))
  const renderGeo = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('.block')) as HTMLElement[]
    const b = blocks[blocks.length - 1]
    const marker = b.querySelector('.block-list-marker') as HTMLElement | null
    if (!marker) throw new Error('渲染态没有 marker')
    const mr = marker.getBoundingClientRect()
    return { marker: { left: mr.left, right: mr.right } }
  })
  const renderPath = 'test-results/marker-render.png'
  await page.screenshot({ path: renderPath, clip })
  const rMarkX0 = rel(renderGeo.marker.left) - 2
  const rMarkX1 = rel(renderGeo.marker.right) + 2
  const renderInk = inkBox(renderPath, rMarkX0, rMarkX1, 0, clip.height)

  // 盒宽与右缘同口径（伪元素 vs flex item）
  expect(Math.abs(editGeo.marker.right - renderGeo.marker.right)).toBeLessThanOrEqual(0.5)
  // 字形落位：上下左右四边都相同，墨量相当（同字体同字号 ⇒ 同一次光栅化）
  expect(editInk.top).toBe(renderInk.top)
  expect(editInk.bottom).toBe(renderInk.bottom)
  expect(editInk.left).toBe(renderInk.left)
  expect(editInk.right).toBe(renderInk.right)
  expect(Math.abs(editInk.mass - renderInk.mass)).toBeLessThanOrEqual(renderInk.mass * 0.02)
}

/**
 * 行首敲 `prefix`，正文敲 `body`，把焦点留在这一块里（编辑态）。
 *
 * `items > 1` 时用 Enter 续出后续项（序号由推导层给），用于造「两位数序号」这类
 * 只能在段内靠后的位置出现的场景。
 */
async function typeBlock(page: Page, prefix: string, body: string, items = 1) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(250)
  for (let i = 0; i < items; i++) {
    if (i === 0) {
      for (const ch of prefix) {
        if (ch === ' ') await page.keyboard.press('Space')
        else await page.keyboard.type(ch)
      }
    }
    await page.keyboard.type(body)
    if (i < items - 1) {
      await page.keyboard.press('Enter')
      await wait(150)
    }
  }
  await wait(350)
}

/** 编辑态：段落行盒 + 插入符（前缀末尾 vs 正文末尾） */
function editGeometry(page: Page) {
  return page.evaluate(() => {
    const r = (n: number) => Math.round(n * 100) / 100
    const p = document.querySelector('.ProseMirror-focused p, .ProseMirror p') as HTMLElement
    const span = p.querySelector('.pm-prefix-hidden') as HTMLElement | null
    const heading = p.querySelector('.heading-preview') as HTMLElement | null
    const caret = (node: Text | null | undefined) => {
      if (!node) return null
      const rg = document.createRange()
      rg.setStart(node, node.length)
      rg.setEnd(node, node.length)
      const b = rg.getBoundingClientRect()
      return { top: r(b.top), h: r(b.height) }
    }
    const bodyNodes = Array.from(p.childNodes).filter(n => n.nodeType === 3 && (n.textContent ?? '').trim()) as Text[]
    const bodyNode = heading ? (heading.firstChild as Text) : bodyNodes[bodyNodes.length - 1]
    const block = p.closest('.block') as HTMLElement
    const pb = p.getBoundingClientRect()
    const bb = block.getBoundingClientRect()
    return {
      paraTop: r(pb.top),
      paraHeight: r(pb.height),
      blockHeight: r(bb.height),
      spanHeight: span ? r(span.getBoundingClientRect().height) : null,
      caretPrefix: caret((span?.firstChild as Text) ?? null),
      caretBody: caret(bodyNode),
    }
  })
}

/** 渲染态：`h1–h6` / `.block-text` 的行盒 */
function renderGeometry(page: Page) {
  return page.evaluate(() => {
    const r = (n: number) => Math.round(n * 100) / 100
    const blocks = Array.from(document.querySelectorAll('.block')) as HTMLElement[]
    const b = blocks[blocks.length - 1]
    const line = (b.querySelector('h1,h2,h3,h4,h5,h6') ?? b.querySelector('.block-text')) as HTMLElement
    const lb = line.getBoundingClientRect()
    const bb = b.getBoundingClientRect()
    return { lineTop: r(lb.top), lineHeight: r(lb.height), blockHeight: r(bb.height) }
  })
}

async function assertParity(page: Page, prefix: string, body: string) {
  await typeBlock(page, prefix, body)
  const edit = await editGeometry(page)

  // 插入符纵向不跳：前缀末尾与正文末尾必须落在同一行、同一高度
  expect(edit.caretPrefix).not.toBeNull()
  expect(edit.caretBody).not.toBeNull()
  expect(Math.abs(edit.caretPrefix!.top - edit.caretBody!.top)).toBeLessThanOrEqual(0.6)
  // 高度只要求「同量级」：标题前缀字号是 `标题字号 × 1.46` 的近似值，插入符高度按字号度量
  // 取整，个别级别差 1px 属既存近似，不是两态不一致（两态用的是同一颗前缀 span）
  expect(Math.abs(edit.caretPrefix!.h - edit.caretBody!.h)).toBeLessThanOrEqual(1.5)

  await page.keyboard.press('Escape')
  await wait(600)
  // 等编辑态真正卸载再量渲染态：整文件串行跑时 600ms 偶尔不够（还停在 ProseMirror 里），
  // 量到的是编辑态行盒 ⇒ 假红
  await page.waitForFunction(() => !document.querySelector('.ProseMirror-focused'))
  const render = await renderGeometry(page)

  // 行盒（＝文字落位）与块高两态一致；前缀 span 的盒高不得高于行盒，否则就是它在顶行盒
  expect(Math.abs(edit.paraTop - render.lineTop)).toBeLessThanOrEqual(0.6)
  expect(Math.abs(edit.paraHeight - render.lineHeight)).toBeLessThanOrEqual(0.6)
  expect(Math.abs(edit.blockHeight - render.blockHeight)).toBeLessThanOrEqual(1)
  if (edit.spanHeight !== null) expect(edit.spanHeight).toBeLessThanOrEqual(render.lineHeight + 0.6)

  return { edit, render }
}

test.describe('列表 / 标题块两态行盒对齐', () => {
  test('无序列表：正文与标记的落位两态一致', async ({ page }) => {
    test.setTimeout(90000)
    await assertParity(page, '- ', 'af')
  })

  test('有序列表：同上', async ({ page }) => {
    test.setTimeout(90000)
    await assertParity(page, '1. ', 'af')
  })

  test('标题 h1–h3：段落行盒等于渲染态标题行盒', async ({ page }) => {
    test.setTimeout(120000)
    for (const level of [1, 2, 3]) {
      await assertParity(page, `${'#'.repeat(level)} `, 'af')
    }
  })

  test('标题 h4–h6：段落 strut 不能把行盒顶回正文行高', async ({ page }) => {
    test.setTimeout(120000)
    for (const level of [4, 5, 6]) {
      await assertParity(page, `${'#'.repeat(level)} `, 'af')
    }
  })

  test('折行的列表项：续行仍与首行同列（内缩挂在段落上）', async ({ page }) => {
    test.setTimeout(90000)
    const long = '列表项正文对齐验证'.repeat(14)
    await typeBlock(page, '- ', long)
    const lefts = await page.evaluate(() => {
      const p = document.querySelector('.ProseMirror-focused p, .ProseMirror p') as HTMLElement
      const t = Array.from(p.childNodes).find(
        n => n.nodeType === 3 && (n.textContent ?? '').trim(),
      ) as Text
      const rg = document.createRange()
      rg.selectNodeContents(t)
      return Array.from(rg.getClientRects()).map(b => Math.round(b.left))
    })
    expect(lefts.length).toBeGreaterThan(2) // 确实折行了
    const first = lefts[0]
    for (const l of lefts) expect(l).toBe(first)
  })

  test('无序列表圆点：两态字形落在同一批像素上', async ({ page }) => {
    test.setTimeout(90000)
    await assertMarkerParity(page, '- ', 'af')
  })

  test('无序列表空项：只有圆点时也两态同位', async ({ page }) => {
    test.setTimeout(90000)
    await assertMarkerParity(page, '- ', '')
  })

  test('有序列表两位序号：标记不折行，块高仍是一行', async ({ page }) => {
    test.setTimeout(120000)
    // 段首恒 1（ADR-0064）⇒ `10.` 只能出现在段内第 10 项，靠 Enter 续出来
    await assertMarkerParity(page, '1. ', 'af', 10)
    // 锁宽的代价：`10.` 比 14px 列宽还宽。`white-space` 若继承到 `pre-wrap`，
    // 会在 `10` 与 `.` 之间断行 —— 标记自己占两行，整块凭空高 20px（正文照旧一行）。
    const info = await page.evaluate(() => {
      const blocks = Array.from(document.querySelectorAll('.block')) as HTMLElement[]
      const b = blocks[blocks.length - 1]
      const marker = b.querySelector('.block-list-marker') as HTMLElement
      const rg = document.createRange()
      rg.selectNodeContents(marker)
      return {
        text: (marker.textContent ?? '').trim(),
        lines: rg.getClientRects().length,
        blockHeight: Math.round(b.getBoundingClientRect().height),
      }
    })
    expect(info.text).toBe('10.')
    expect(info.lines).toBe(1)
    // 块高含块内 padding，不等于行高：只要求落在「一行块」的量级（折行时实测 50.8）
    expect(info.blockHeight).toBeLessThan(40)
  })

  test('段首恒 1：手写 `5. ` 失活后归一到 `1. `，块高不变', async ({ page }) => {
    test.setTimeout(90000)
    await typeBlock(page, '5. ', 'af')
    const editHeight = await page.evaluate(() => {
      const b = document.querySelector('.block') as HTMLElement
      return Math.round(b.getBoundingClientRect().height)
    })

    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      const marker = document.querySelector('.block-list-marker') as HTMLElement | null
      return (marker?.textContent ?? '').trim() === '1.'
    })
    await wait(200)
    const render = await page.evaluate(() => {
      const b = document.querySelector('.block') as HTMLElement
      return { height: Math.round(b.getBoundingClientRect().height) }
    })

    expect(render.height).toBe(editHeight)

    // 回到编辑态：前缀标记与渲染态同一个数字（两态仍一致）
    await page.locator('.block').first().click()
    await wait(300)
    const editMarker = await page.evaluate(() => {
      const span = document.querySelector('.ProseMirror .pm-prefix-hidden') as HTMLElement | null
      if (!span) return null
      return getComputedStyle(span, '::before').content
    })
    expect(editMarker).toContain('1.')
  })
})
