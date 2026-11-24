/**
 * 回归：`[[page]]` / `#tag` 补全菜单「回车确认」落空，块被清空。
 *
 * 现象：输入 `[[xx]]`（或 `#xx`）后按 Enter，目标页/标签已创建、菜单也关闭，但块正文
 * 变成空 —— 链接没插进去；同一菜单项用鼠标点击则正常。
 *
 * 根因：确认动作走 `chain().deleteRange().insertContent()`。`insertContent` 的插入目标取
 * 自 `tr.selection`，而键盘路径（keydown 内派发 wiki-link-menu-enter / tag-menu-enter）
 * 下删除后的选区映射不落在删除位置 ⇒ 插入步静默落空，tr 里只剩删除步 ⇒ 整块清空。
 * 鼠标路径的命令序列相同却正常，故该 bug 只在键盘确认时出现。
 *
 * 修复：改用 `insertContentAt({ from, to })` 一次完成区间替换，不依赖 selection。
 *
 * 运行: `npm run dev`(已起则复用)后 `npx playwright test tests/wiki-link-menu-keyboard.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

/** 新建一个空块并聚焦（复用已打开的首页） */
async function setupBlock(page: Page) {
  await page.goto('http://localhost:5173/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(1200)
  const plus = page.getByRole('button', { name: '+' }).first()
  if (await plus.count()) {
    await plus.click()
    await page.waitForTimeout(300)
  }
  await page.locator('.block').last().click()
  await page.waitForTimeout(300)
}

async function activeText(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const el = document.querySelector('.block.active .tiptap')
    return el ? el.textContent : null
  })) ?? ''
}

/** 唯一名字，避免与既有页面/标签撞车 */
function uniqueName(prefix: string): string {
  return `${prefix}${Date.now().toString().slice(-6)}`
}

test.describe('[[wikilink]] 菜单：回车与点击结果一致', () => {
  test('回车确认「新建页面」：插入链接而非清空块', async ({ page }) => {
    await setupBlock(page)
    const name = uniqueName('wk')

    await page.keyboard.type('[[', { delay: 50 })
    await page.waitForTimeout(300)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(300)

    await expect(page.locator('.wiki-link-menu')).toBeVisible()
    const itemText = await page.locator('.wiki-link-menu .wlm-item').first().textContent()
    expect(itemText).toContain(name)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)

    // 链接已插入（两侧 pad 属 inline 单元一部分，故用 contains）
    expect(await activeText(page)).toContain(`[[${name}]]`)
    // 回车被菜单消费，不得把块拆成两块
    expect(await page.evaluate(() => document.querySelectorAll('.block').length)).toBe(1)
    // 菜单已关闭
    await expect(page.locator('.wiki-link-menu')).toBeHidden()
  })

  test('点击确认「新建页面」：与回车等价', async ({ page }) => {
    await setupBlock(page)
    const name = uniqueName('wc')

    await page.keyboard.type('[[', { delay: 50 })
    await page.waitForTimeout(300)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(400)

    await page.locator('.wiki-link-menu .wlm-item').first().click()
    await page.waitForTimeout(600)

    expect(await activeText(page)).toContain(`[[${name}]]`)
  })

  test('回车确认「已有页面」：不做任何删除', async ({ page }) => {
    await setupBlock(page)
    const name = uniqueName('we')

    // 第一次：创建页面
    await page.keyboard.type('[[', { delay: 50 })
    await page.waitForTimeout(250)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)

    // 第二个块：同名输入，菜单首项应为已有页面（不再有 Create 项）
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.locator('.block').last().click()
    await page.waitForTimeout(300)

    await page.keyboard.type('[[', { delay: 50 })
    await page.waitForTimeout(250)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(400)

    const items = await page.locator('.wiki-link-menu .wlm-item').allTextContents()
    expect(items.some((t) => t.includes('Create'))).toBe(false)

    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)

    expect(await activeText(page)).toContain(`[[${name}]]`)
  })
})

test.describe('#tag 菜单：回车与点击结果一致', () => {
  test('回车确认「新建标签」：插入标签而非清空块', async ({ page }) => {
    await setupBlock(page)
    const name = uniqueName('tk')

    await page.keyboard.type('#', { delay: 50 })
    await page.waitForTimeout(300)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(400)

    await expect(page.locator('.tag-menu')).toBeVisible()

    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)

    expect(await activeText(page)).toContain(`#${name}`)
  })

  test('点击确认「新建标签」：与回车等价', async ({ page }) => {
    await setupBlock(page)
    const name = uniqueName('tc')

    await page.keyboard.type('#', { delay: 50 })
    await page.waitForTimeout(300)
    await page.keyboard.type(name, { delay: 50 })
    await page.waitForTimeout(400)

    await page.locator('.tag-menu .tm-item').first().click()
    await page.waitForTimeout(600)

    expect(await activeText(page)).toContain(`#${name}`)
  })
})
