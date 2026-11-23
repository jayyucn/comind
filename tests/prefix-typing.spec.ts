/**
 * 编辑态正文前缀（`# ` / `- ` / `1. `）的输入回归网。
 *
 * 前缀字符是真的存在于文档里的（不是块类型），编辑器把它们藏进 `.pm-prefix-hidden`。
 * 藏法对输入行为有两个致命耦合，两条都在 2026-11 出过可见故障：
 *
 * 1. **前缀末尾那枚空格不能被折叠**：`white-space: nowrap` 会把尾随空格塌成零 advance，
 *    浏览器的 caret 随即映射到空格**之前** —— 接着敲的字不是追加而是**替换掉空格**：
 *    `1. ` 敲 `a` 变成 `1.a`，列表/标题当场不再是列表/标题。
 *    （`white-space: pre` 是这条的修法。）
 * 2. **前缀的布局 advance 必须是 0，且盒内字符要能被 caret 正确寻址**：`width: 0` 只压盒子，
 *    盒内字符仍按字宽排开，插入符/选区按字形位置画 —— 前缀末尾的插入符会落到正文右侧
 *    十几像素处（`1. ` 实测 17px），敲第一个字时"光标跳一下"。
 *    （`font-family: monospace` + `letter-spacing: -1ch` 精确抵消每个字符的 advance。）
 *
 * 运行：`npm run dev`（已起则复用）后
 * `npx playwright test tests/prefix-typing.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 活动块的真实文档文本（剔除 widget 标记自带的文字） */
const docText = (page: Page) => page.evaluate(() => {
  const p = document.querySelector('.ProseMirror-focused p, .ProseMirror p')
  const clone = p?.cloneNode(true) as HTMLElement | undefined
  clone?.querySelectorAll('.pm-prefix-marker').forEach(el => el.remove())
  return clone?.textContent ?? null
})

async function startBlock(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(300)
}

test('有序列表：`1. ` 之后敲字不吞空格', async ({ page }) => {
  await startBlock(page)
  await page.keyboard.type('1')
  await page.keyboard.type('.')
  await page.keyboard.press('Space')
  await wait(150)
  await page.keyboard.type('a')
  await wait(250)
  expect(await docText(page)).toBe('1. a')
})

test('无序列表：`- ` 之后敲字不吞空格', async ({ page }) => {
  await startBlock(page)
  await page.keyboard.type('-')
  await page.keyboard.press('Space')
  await wait(150)
  await page.keyboard.type('a')
  await wait(250)
  expect(await docText(page)).toBe('- a')
})

test('标题：`# ` 之后敲字不吞空格', async ({ page }) => {
  await startBlock(page)
  await page.keyboard.type('#')
  await page.keyboard.press('Space')
  await wait(150)
  await page.keyboard.type('a')
  await wait(250)
  expect(await docText(page)).toBe('# a')
})

test('前缀：布局宽度 0、选区宽 0、插入符落在正文起点', async ({ page }) => {
  await startBlock(page)
  await page.keyboard.type('1')
  await page.keyboard.type('.')
  await page.keyboard.press('Space')
  await wait(250)

  const geo = await page.evaluate(() => {
    const host = document.querySelector('.ProseMirror-focused, .ProseMirror') as HTMLElement
    const marker = host.querySelector('.pm-prefix-marker') as HTMLElement
    const prefix = host.querySelector('.pm-prefix-hidden') as HTMLElement
    const text = prefix.firstChild as Text
    const selectionRange = document.createRange()
    selectionRange.selectNodeContents(text)
    const caret = document.createRange()
    caret.setStart(text, text.length)
    caret.setEnd(text, text.length)
    const markerRect = marker.getBoundingClientRect()
    return {
      prefixBoxWidth: prefix.getBoundingClientRect().width,
      glyphWidth: selectionRange.getBoundingClientRect().width,
      caretX: caret.getBoundingClientRect().x,
      prefixX: prefix.getBoundingClientRect().x,
      markerRight: markerRect.right,
    }
  })

  // 盒子不占位：前缀不该把正文往右推
  expect(geo.prefixBoxWidth).toBeLessThan(1)
  // 字形 advance 被抵消：选中前缀不会画出一块压在正文上的高亮
  expect(Math.abs(geo.glyphWidth)).toBeLessThan(1)
  // 插入符站在盒子左缘（＝正文起点），不是漂在正文右侧十几像素
  expect(Math.abs(geo.caretX - geo.prefixX)).toBeLessThan(1)
  // 正文起点 = 标记右缘 + 间距（两态同列）
  expect(geo.prefixX - geo.markerRight).toBeGreaterThan(4)
  expect(geo.prefixX - geo.markerRight).toBeLessThan(14)
})
