/**
 * 键入裸网址即成 chip（ADR-0067 D10）：`https://…` 打完即成链接视图 chip。
 *
 * 覆盖四条曾经踩空/踩坑的路径：
 * - 键入时不转（只有粘贴转）；
 * - URL 里的 `/` 打开斜杠命令面板，模态层随后吞掉 Esc，块退不出编辑态；
 * - 按 End 把光标送进隐藏的 `](url)`，Chromium 把插入符弹回块首，打的字插到链接前面；
 * - 链接末尾打中文标点被并进 URL。
 *
 * 运行：`npm run dev` 后 `npx playwright test tests/web-link-typing.spec.ts`
 */
import { expect, test, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)
  await page.locator('.block').first().click()
  await wait(300)
}

async function state(page: Page) {
  return page.evaluate(() => ({
    editing: document.querySelectorAll('.ProseMirror').length,
    popovers: document.querySelectorAll('.base-popover').length,
    // 编辑态整段字面被拆成三个 span（别名 + 两段零宽隐藏），只取可见那段
    chips: Array.from(document.querySelectorAll('.web-link-chip:not(.pm-prefix-hidden)'))
      .map(el => el.textContent ?? ''),
    texts: Array.from(document.querySelectorAll('.block')).map(el => el.textContent ?? ''),
  }))
}

/** 插入符横向位置 vs 芯片可见右边缘：差得远 = 插入符被甩到了 chip 左边 */
async function caretOffsetFromChipEnd(page: Page) {
  return page.evaluate(() => {
    const sel = window.getSelection()
    const caret = sel?.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null
    const chip = document.querySelector('.web-link-chip:not(.pm-prefix-hidden)')
    const box = chip?.getBoundingClientRect()
    if (!caret || !box) return null
    return Math.round(caret.left - box.right)
  })
}

test('链接之后退格删光正文：插入符留在链接末尾，既不回跳也不吞网址', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(300)
  await page.keyboard.type(' 测试内容', { delay: 30 })
  await wait(400)

  // 一路退到链接之后的那个插入位（含空格一起删掉）
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Backspace')
    await wait(150)
  }
  const editing = await state(page)
  expect(editing.texts[0]).toBe('[https://www.doubao.com](https://www.doubao.com)')
  // 曾经这里插入符被甩到 chip 左边（视觉上「光标消失」），接着打的字插进链接前面
  expect(await caretOffsetFromChipEnd(page)).toBeGreaterThanOrEqual(-2)

  await page.keyboard.type('Z', { delay: 40 })
  await wait(400)
  expect((await state(page)).texts[0]).toBe(
    '[https://www.doubao.com](https://www.doubao.com)Z',
  )
})

test('标题视图：退格删光链接后面的正文，插入符仍停在链接末尾', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.type('后记', { delay: 30 })
  await wait(400)
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Backspace')
    await wait(150)
  }

  const editing = await state(page)
  expect(editing.texts[0]).toBe('[飞书文档](https://www.feishu.cn/docx/abc)')
  expect(editing.chips).toEqual(['飞书文档'])
  expect(await caretOffsetFromChipEnd(page)).toBeGreaterThanOrEqual(-2)
})

test('删除链接后面的空格：插入符停在链接末尾，再打的字落在后文之前', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://a.com', { delay: 30 })
  await wait(300)
  await page.keyboard.type(' xy', { delay: 30 })
  await wait(400)
  // 左移两次把光标放到空格左侧，再退格删掉空格
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await wait(200)
  await page.keyboard.press('Backspace')
  await wait(350)

  expect((await state(page)).texts[0]).toBe('[https://a.com](https://a.com)xy')
  expect(await caretOffsetFromChipEnd(page)).toBeGreaterThanOrEqual(-2)

  await page.keyboard.type('Z', { delay: 40 })
  await wait(400)
  expect((await state(page)).texts[0]).toBe('[https://a.com](https://a.com)Zxy')
})

test('键入网址即成 chip：不弹斜杠菜单，Esc 能退出，读态仍是 chip', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)

  const typing = await state(page)
  expect(typing.popovers).toBe(0)
  // 编辑态只露别名（URL 原文），隐藏的字母面不出现
  expect(typing.texts[0]).toBe('[https://www.doubao.com](https://www.doubao.com)')

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.editing).toBe(0)
  expect(read.texts[0]).toBe('https://www.doubao.com')
})

test('行尾补字落在链接右侧：End 不被弹回块首，标点不进 URL', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.type('，后记', { delay: 30 })
  await wait(400)

  const after = await state(page)
  expect(after.texts[0]).toBe('[https://www.doubao.com](https://www.doubao.com)，后记')

  await page.keyboard.press('Escape')
  await wait(400)
  expect((await state(page)).texts[0]).toBe('https://www.doubao.com，后记')
})

test('句中的网址只包自己，前后文字与中文标点都不动', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('明天看 https://a.com/x，再定', { delay: 30 })
  await wait(500)
  expect((await state(page)).texts[0]).toBe('明天看 [https://a.com/x](https://a.com/x)，再定')

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.texts[0]).toBe('明天看 https://a.com/x，再定')
  expect(read.chips).toEqual(['https://a.com/x'])
})

test('标题视图块尾 chip：接着打的字落到链接右侧，不再被吃进别名', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.type('。后记', { delay: 30 })
  await wait(400)

  const editing = await state(page)
  expect(editing.texts[0]).toBe('[飞书文档](https://www.feishu.cn/docx/abc)。后记')
  expect(editing.chips).toEqual(['飞书文档'])

  await page.keyboard.press('Escape')
  await wait(400)
  expect((await state(page)).texts[0]).toBe('飞书文档。后记')
})

test('标题视图块尾 chip：IME 合成提交后同样落到链接右侧', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)

  // ProseMirror 边合成边把预编辑文本同步进文档（此时别名已被撑长）
  const client = await page.context().newCDPSession(page)
  await client.send('Input.imeSetComposition', { text: '尾', selectionStart: 1, selectionEnd: 1 })
  await wait(400)
  expect((await state(page)).texts[0]).toBe('[飞书文档尾](https://www.feishu.cn/docx/abc)')

  // CDP 没有「提交候选」的指令，收尾由合成结束事件触发（插件据此把增长的那截搬回正文）
  await page.evaluate(() => {
    document.querySelector('.ProseMirror')?.dispatchEvent(
      new CompositionEvent('compositionend', { data: '尾', bubbles: true }),
    )
  })
  await wait(600)

  const editing = await state(page)
  expect(editing.texts[0]).toBe('[飞书文档](https://www.feishu.cn/docx/abc)尾')
  expect(editing.chips).toEqual(['飞书文档'])
})

test('选区跨隐藏尾巴删除：字面保持完整，读态仍是 chip', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  // 从别名中间选到行尾：选区里除了「文档」还圈进了隐藏的 `](url)`
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await wait(150)
  await page.keyboard.press('Shift+End')
  await wait(250)
  await page.keyboard.press('Backspace')
  await wait(400)

  // 曾经这里会剩下 `[飞书](https://www.feishu.cn/docx/abc` 这种残缺字面
  expect((await state(page)).texts[0]).toBe('[飞书](https://www.feishu.cn/docx/abc)')
  await page.keyboard.press('Escape')
  await wait(400)
  expect((await state(page)).texts[0]).toBe('飞书')
})

test('选区跨隐藏前缀删除：不会只剩一个孤零零的 `[`', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await wait(150)
  await page.keyboard.press('Shift+Home')
  await wait(250)
  await page.keyboard.press('Backspace')
  await wait(400)

  expect((await state(page)).texts[0]).toBe('[文档](https://www.feishu.cn/docx/abc)')
  expect((await state(page)).chips).toEqual(['文档'])
})

test('粘贴替换跨隐藏区的选区：链接字面不被吃掉', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[飞书文档](https://www.feishu.cn/docx/abc)')
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('End')
  await wait(150)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await wait(150)
  await page.keyboard.press('Shift+End')
  await wait(250)

  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text/plain', 'X')
    document.querySelector('.ProseMirror')?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  })
  await wait(500)

  // 曾经会变成 `[飞书X`（尾巴被删）
  expect((await state(page)).texts[0]).toBe('[飞书X](https://www.feishu.cn/docx/abc)')
})

test('链接视图退格：别名与 URL 两截同步，不会退化成标题视图', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(400)

  await page.keyboard.press('Backspace')
  await wait(400)
  // 只删别名一截会得到 `[https://www.doubao.co](https://www.doubao.com)`：
  // 别名≠URL 会被判成标题视图，屏幕文字和点开的地址从此不一致
  expect((await state(page)).texts[0]).toBe(
    '[https://www.doubao.co](https://www.doubao.co)',
  )

  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await wait(400)
  const trimmed = await state(page)
  expect(trimmed.texts[0]).toBe('[https://www.doubao.](https://www.doubao.)')
  expect(trimmed.chips).toEqual(['https://www.doubao.'])

  await page.keyboard.press('Escape')
  await wait(400)
  const read = await state(page)
  expect(read.texts[0]).toBe('https://www.doubao.')
  expect(read.chips).toEqual(['https://www.doubao.'])
})
