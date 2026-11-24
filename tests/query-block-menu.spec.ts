/**
 * 查询块块级菜单（左上 gutter 入口 → BasePopover）。
 *
 * 覆盖三件用户可见的事：
 * 1. 入口默认不可见、块 hover 才显现（入口是 Block 外壳的 `.block-entry-icon`，
 *    显隐挂块的 hover、pointer-events 随之切换，否则透明态会埋一个隐形热区抢表头首格的点击）；
 * 2. 菜单是「通用段」那一套块级操作：上下插入 / 缩进 ×2 / 复制 / 剪切 / 粘贴 / 重置为文本块 / 删除，
 *    与 table 块菜单同源
 *    （`Block/components/BlockMenuCommon.vue`）。顺序用 `data-block-menu-item` 断言，不再绑中文文案；
 * 3. 顶级块「减少缩进」置灰，删除后块从文档消失。
 *
 * 注：dev 网页端的 `getBlockCards()` 返回空数组（WASM 不支持全量投影），所以块内表格是空态 ——
 * 入口/菜单/删除都不依赖卡片数据，本 spec 因此可在网页端稳定跑；配置命名空间的落库行为由
 * `query-view-namespace.test.ts` 与 Rust `filter_service_test` 覆盖。
 */
import { expect, test } from '@playwright/test'

import { insertQueryBlock } from './query-block-helpers'

test('查询块左上入口 hover 显现，菜单九项齐全，删除生效', async ({ page }) => {
  await page.goto('/')
  await insertQueryBlock(page)

  const block = page.locator('.block:has(.query-block)').last()
  // 入口已上提到 Block 外壳的 .block-bullet：类型图标替代 bullet dot，兼拖拽手柄
  const entry = block.locator('.block-entry-icon')

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

  await block.locator('.block-entry-icon').click()

  const menu = page.locator('.block-entry-menu').last()
  await expect(menu).toBeVisible()
  await expect(menu.locator('.menu-row')).toHaveText([
    '上方插入',
    '下方插入',
    '增加缩进',
    '减少缩进',
    '复制',
    '剪切',
    '粘贴',
    '清空',
    '删除',
  ])
  // 顺序与身份用句柄锁（文案以后可以改，顺序不能乱）
  expect(
    await menu.locator('[data-block-menu-item]').evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-menu-item')),
    ),
  ).toEqual(['insert-above', 'insert-below', 'indent', 'outdent', 'copy', 'cut', 'paste', 'reset-text', 'delete'])

  // 分五组：插入 / 缩进 / 剪贴板 / 清空 / 删除（清空与删除各占一组 —— 两者都真的删东西，
  // 只差一次误点，靠分隔线守住距离）
  await expect(menu.locator('.menu-sep')).toHaveCount(4)

  // 顶级块：没有父块就没有「减少缩进」可言
  await expect(menu.locator('.menu-row', { hasText: '减少缩进' })).toBeDisabled()

  const before = await page.locator('.query-block').count()
  await menu.locator('[data-block-menu-item="delete"]').click()
  await expect.poll(async () => page.locator('.query-block').count()).toBe(before - 1)
})

/**
 * 入口已上提到 Block 外壳的 `.block-bullet`，query 块不再为入口向左侧借 gutter
 * （旧实现是 `margin-left: -20px` 抵消 `padding-left: 20px`）。
 * 契约不变：**正文左缘必须与普通块对齐** —— 撤掉外延后靠「不留 padding」达成，
 * 这条断言防的是「哪天又给 query 块补回 padding 把正文推右 20px」。
 */
test('入口不再借 gutter：query 正文左缘仍与普通块对齐', async ({ page }) => {
  await page.goto('/')
  await insertQueryBlock(page)

  const geo = await page.evaluate(() => {
    const q = document.querySelector('.query-block') as HTMLElement
    const other = Array.from(document.querySelectorAll('.block-content')).find(
      el => !el.querySelector('.query-block'),
    ) as HTMLElement
    return {
      marginLeft: getComputedStyle(q).marginLeft,
      paddingLeft: getComputedStyle(q).paddingLeft,
      contentLeft: q.querySelector('.lib-body')!.getBoundingClientRect().left,
      siblingLeft: other.getBoundingClientRect().left,
    }
  })

  expect(geo.marginLeft).toBe('0px')
  expect(geo.paddingLeft).toBe('0px')
  expect(Math.abs(geo.contentLeft - geo.siblingLeft)).toBeLessThanOrEqual(1)
})
