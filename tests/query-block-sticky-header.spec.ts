/**
 * 查询块：块内滚动时表头必须固定（sticky），不得随行滚走。
 *
 * 为什么必须真机验：表格的 `thead { position: sticky; top: 0 }` 只相对**最近滚动容器**生效。
 * 整页查询页里那是 `.table-scroll`（全页滚动容器）；嵌入块内高度跟随内容，滚动发生在
 * `.lib-body`，`.table-scroll` 自身不滚动 ⇒ 表头失去 sticky。jsdom 侧完全量不到几何。
 *
 * 为什么自己造行：dev 网页端 `getBlockCards()` 在 WASM 客户端是「暂不支持全量投影，
 * 返回空数组」（src/wasm/client.ts），查询块永远空态、没有 `<table>`。故这里复制真实节点的
 * scoped 属性造一份同构表格 DOM——测的是滚动容器绑定这条几何契约，与数据来源无关。
 */
import { test, expect } from '@playwright/test'
import { insertQueryBlock } from './query-block-helpers'

test('查询块：块内滚动时表头固定在主内容区顶部', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 30000 })
  await insertQueryBlock(page)

  const probe = await page.evaluate(async () => {
    const qb = document.querySelector('.query-block') as HTMLElement
    const view = qb.querySelector('.table-view') as HTMLElement
    const scroll = qb.querySelector('.table-scroll') as HTMLElement
    const body = qb.querySelector('.lib-body') as HTMLElement

    // 复制真实节点的 scoped 属性，令 TableView 的 scoped CSS 对造出来的节点同样生效
    const scopeAttrs = Array.from(view.attributes)
      .filter((a) => a.name.startsWith('data-v-'))
      .map((a) => a.name)

    const heads = ['col 0', 'col 1', 'col 2', 'col 3']
    const rows = Array.from({ length: 60 }, (_, r) => heads.map((_, c) => `row ${r} col ${c}`))
    scroll.innerHTML = `
      <div class="table-section">
        <table class="data-table" style="width:100%">
          <thead><tr>${heads.map((h) => `<th><div class="th-inner">${h}</div></th>`).join('')}</tr></thead>
          <tbody>${rows.map((r) => `<tr class="data-row">${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`
    scroll.querySelectorAll('*').forEach((el) => scopeAttrs.forEach((n) => el.setAttribute(n, '')))

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    const thead = scroll.querySelector('thead') as HTMLElement
    const offsetBefore = Math.round(
      thead.getBoundingClientRect().top - body.getBoundingClientRect().top,
    )
    body.scrollTop = 200
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    const offsetAfter = Math.round(
      thead.getBoundingClientRect().top - body.getBoundingClientRect().top,
    )

    return {
      // 语义断言依据：块内滚动容器必须只剩 .lib-body 一个
      tableScrollOverflow: getComputedStyle(scroll).overflowY,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      scrollTop: body.scrollTop,
      offsetBefore,
      offsetAfter,
    }
  })
  console.log('STICKY PROBE:', JSON.stringify(probe, null, 2))

  // 点块内单元格：query 块与 table 块同构（两态同组件），若这次点击令块激活并重挂载，
  // 造出来的表格会被换掉、滚动位置也随之丢失（Block/index.vue 两态分支的老坑）。
  const cell = page.locator('.query-block .data-table tbody td').nth(9)
  const box = await cell.boundingBox()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(500)
  const afterClick = await page.evaluate(() => {
    const body = document.querySelector('.query-block .lib-body') as HTMLElement
    const thead = document.querySelector('.query-block .data-table thead') as HTMLElement
    return {
      rows: document.querySelectorAll('.query-block .data-table tbody tr').length,
      scrollTop: Math.round(body.scrollTop),
      offset: Math.round(thead.getBoundingClientRect().top - body.getBoundingClientRect().top),
    }
  })
  console.log('AFTER CLICK:', JSON.stringify(afterClick))
  await page.screenshot({ path: 'outputs/query-block-sticky.png' })

  // 前提：块内确实产生了滚动，且滚动发生在 .lib-body（不是 .table-scroll）
  expect(probe.tableScrollOverflow).toBe('visible')
  expect(probe.bodyScrolls).toBe(true)
  expect(probe.scrollTop).toBeGreaterThan(0)
  // 结论：滚动后表头仍贴在主内容区顶部（滚动前后偏移不变；差值来自表格 1px 描边），未随行滚走
  expect(Math.abs(probe.offsetAfter - probe.offsetBefore)).toBeLessThanOrEqual(2)
  expect(probe.offsetAfter).toBeGreaterThanOrEqual(0)
  // 点击块内单元格不重挂载：造的行还在、滚动位置还在、表头仍固定
  expect(afterClick.rows).toBe(60)
  expect(afterClick.scrollTop).toBeGreaterThan(0)
  expect(afterClick.offset).toBeLessThanOrEqual(1)
})
