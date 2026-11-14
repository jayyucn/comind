/**
 * 查询块块级菜单（左上 gutter 入口 → BasePopover）。
 *
 * 覆盖三件用户可见的事：
 * 1. 入口默认不可见、块 hover 才显现（与 table 块同款显隐，pointer-events 也随之切换，
 *    否则透明态会埋一个隐形热区抢表头首格的点击）；
 * 2. 菜单是 table 块那套块级操作：缩进 ×2 / 复制 / 剪切 / 粘贴 / 删除，顺序与分组一致；
 * 3. 顶级块「减少缩进」置灰，删除后块从文档消失。
 *
 * 注：dev 网页端的 `getBlockCards()` 返回空数组（WASM 不支持全量投影），所以块内表格是空态 ——
 * 入口/菜单/删除都不依赖卡片数据，本 spec 因此可在网页端稳定跑；配置命名空间的落库行为由
 * `query-view-namespace.test.ts` 与 Rust `filter_service_test` 覆盖。
 */
import { expect, test } from '@playwright/test'

import { insertQueryBlock } from './query-block-helpers'

test('查询块左上入口 hover 显现，菜单六项齐全，删除生效', async ({ page }) => {
  await page.goto('/')
  await insertQueryBlock(page)

  const block = page.locator('.block:has(.query-block)').last()
  const entry = block.locator('.query-entry')

  // 默认透明且不吃指针
  await expect
    .poll(async () => entry.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('0')
  await expect
    .poll(async () => entry.evaluate((el) => getComputedStyle(el).pointerEvents))
    .toBe('none')

  // 块 hover 后显现且可点（挂在 .query-block:hover 上，不是挂在入口自身）
  await block.locator('.query-block').hover()
  await expect
    .poll(async () => entry.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1')

  await block.locator('.query-menu-entry').click()

  const menu = page.locator('.query-menu').last()
  await expect(menu).toBeVisible()
  await expect(menu.locator('.menu-row')).toHaveText([
    '增加缩进',
    '减少缩进',
    '复制',
    '剪切',
    '粘贴',
    '删除查询块',
  ])

  // 分三组：缩进 / 剪贴板 / 销毁（与 table 块菜单同一分组节奏）
  await expect(menu.locator('.menu-sep')).toHaveCount(2)

  // 顶级块：没有父块就没有「减少缩进」可言
  await expect(menu.locator('.menu-row', { hasText: '减少缩进' })).toBeDisabled()

  const before = await page.locator('.query-block').count()
  await menu.locator('.menu-row', { hasText: '删除查询块' }).click()
  await expect.poll(async () => page.locator('.query-block').count()).toBe(before - 1)
})

/**
 * 入口的 gutter 必须从块外借：`margin-left: -20px` 抵消 `padding-left: 20px`。
 * 只给 padding 会把整块内容右移 20px，正文左缘与其它块对不齐（已发生过一次）。
 */
test('入口 gutter 不移动块内容：正文左缘与普通块对齐', async ({ page }) => {
  await page.goto('/')
  await insertQueryBlock(page)

  const geo = await page.evaluate(() => {
    const q = document.querySelector('.query-block') as HTMLElement
    const other = Array.from(document.querySelectorAll('.block-content')).find(
      el => !el.querySelector('.query-block'),
    ) as HTMLElement
    return {
      marginLeft: getComputedStyle(q).marginLeft,
      contentLeft: q.querySelector('.lib-body')!.getBoundingClientRect().left,
      siblingLeft: other.getBoundingClientRect().left,
    }
  })

  expect(geo.marginLeft).toBe('-20px')
  expect(Math.abs(geo.contentLeft - geo.siblingLeft)).toBeLessThanOrEqual(1)
})
