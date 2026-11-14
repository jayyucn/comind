/**
 * 查询块默认列：内容 / 页面 / 更新时间。
 *
 * 为什么从「字段管理面板」验：dev 网页端 `getBlockCards()` 在 WASM 客户端返回空数组
 * （src/wasm/client.ts：暂不支持全量投影），查询块永远空态、不渲染 `<table>`，看不到表头。
 * 而字段面板的「已用字段」= 本页实际渲染的列（QueryPageFrame.activeColumns = props.tableConfig.columns），
 * 是空态下唯一能读出列模板的真实 UI 投影。
 */
import { test, expect } from '@playwright/test'
import { insertQueryBlock } from './query-block-helpers'

test('查询块：默认列为 内容 / 页面 / 更新时间', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('.block', { timeout: 30000 })
  await insertQueryBlock(page)

  // 工具条最右按钮 = 字段管理（面板经 BasePopover Teleport 到 body）
  await page.locator('.query-block .query-toolbar button').last().click()
  // 按内容定位：斜杠命令菜单也是 .base-popover，页面上同时可能存在多个
  const panel = page.locator('.base-popover', { hasText: '已用字段' }).first()
  await panel.waitFor({ state: 'visible', timeout: 5000 })

  const lines = (await panel.innerText())
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  // 面板文本形如「字段 / 编辑 / 已用字段 / 内容 / 页面 / 更新时间」，取「已用字段」之后的字段名
  const used = lines.slice(lines.indexOf('已用字段') + 1)
  console.log('USED FIELDS:', JSON.stringify(used))
  await page.screenshot({ path: 'outputs/query-block-default-columns.png' })

  // 已用字段恰为三列且顺序固定
  expect(used.slice(0, 3)).toEqual(['内容', '页面', '更新时间'])
  // 任务中心那套默认列不该出现（说明没有误用 blockDefaultConfig）
  expect(used.join('|')).not.toContain('优先级')
  expect(used.join('|')).not.toContain('截止')
})
