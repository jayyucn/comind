/**
 * 键入裸网址即成 chip（ADR-0067 D10）：`https://…` 打完即成链接视图 chip。
 *
 * 覆盖四条曾经踩空/踩坑的路径：
 * - 键入时不转（只有粘贴转）；
 * - URL 里的 `/` 打开斜杠命令面板，模态层随后吞掉 Esc，块退不出编辑态；
 * - 按 End 把光标送进隐藏的 `](url)`，Chromium 把插入符弹回块首，打的字插到链接前面；
 * - 链接末尾打中文标点被并进 URL；
 * - 链接右侧按 `→` 要按两次才动（别名末尾与链接之后同像素，隐藏尾巴占了中间一格）。
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

/** 插入符的横向像素位置（判断「按一次右有没有真的动」） */
async function caretX(page: Page) {
  return page.evaluate(() => {
    const sel = window.getSelection()
    const rect = sel?.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : null
    return rect ? Math.round(rect.left) : -1
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

test('标题视图：链接右侧按 → 一次就前进，隐藏尾巴不占一格', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('前缀[飞书文档](https://www.feishu.cn/docx/abc)后文字')
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)

  // 点在链接右边缘外侧：落在「链接之后」，与别名末尾是同一个视觉格
  const box = (await page.locator('.web-link-chip').first().boundingBox())!
  await page.mouse.click(box.x + box.width + 2, box.y + box.height / 2)
  await wait(400)

  const before = await caretOffsetFromChipEnd(page)
  await page.keyboard.press('ArrowRight')
  await wait(250)
  const after = await caretOffsetFromChipEnd(page)

  // 曾经第一次按键只是从「别名末尾」挪到「链接之后」（同一像素 ⇒ 肉眼不动），要按两次才看到移动
  expect(after! - before!).toBeGreaterThan(10)
})

test('从块首一路按右：光标能逐字穿过链接，不在隐藏的 `[` 前打转', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('前[飞书](https://a.com)后')
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('Home')
  await wait(200)

  const seq: number[] = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('ArrowRight')
    await wait(150)
    seq.push(await caretX(page))
  }
  // 前缀 `[` 曾带 contenteditable=false：插入符停不住，被 Chromium 甩回块首，
  // 在「前缀」里 0→1→2→3→0 循环，键盘永远进不了别名的第一个字
  for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1])
})

test('前缀格（链接最左缘）打字：字落进链接前面的正文，链接结构不动', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('前[飞书](https://a.com)后')
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('Home')
  await wait(200)
  // Home 在块首，→ 落到「前」与「飞」之间：`[` 零宽，这一格语义上是「链接之前」
  await page.keyboard.press('ArrowRight')
  await wait(200)
  await page.keyboard.type('新', { delay: 30 })
  await wait(400)

  const editing = await state(page)
  expect(editing.texts[0]).toBe('前新[飞书](https://a.com)后')
  expect(editing.chips).toEqual(['飞书'])

  await page.keyboard.press('Escape')
  await wait(400)
  // 读态仍是可点的链接，没有方括号漏出来
  expect((await state(page)).texts[0]).toBe('前新飞书后')
})

test('块首链接前打空格：链接不被拆成纯文本（用户报障回归）', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[https://www.doubao.com](https://www.doubao.com)  正文')
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('Home')
  await wait(200)
  await page.keyboard.type(' ', { delay: 30 })
  await wait(400)

  const editing = await state(page)
  // 老行为：空格被当成「改别名」塞进网址 ⇒ 字面不再合法 ⇒ 整段退化成纯文本、链接消失
  expect(editing.texts[0]).toBe(' [https://www.doubao.com](https://www.doubao.com)  正文')
  expect(editing.chips).toEqual(['https://www.doubao.com'])
})

test('块首链接上按退格：按键不再被吞（发出块级 merge 信号）', async ({ page }) => {
  await boot(page)
  await page.keyboard.insertText('[https://www.doubao.com](https://www.doubao.com)  正文')
  await wait(500)
  await page.keyboard.press('Escape')
  await wait(500)

  await page.locator('.block').first().click()
  await wait(500)
  await page.keyboard.press('Home')
  await wait(200)
  await page.evaluate(() => {
    (window as unknown as { __blockEvents: unknown[] }).__blockEvents = []
    document.addEventListener('enter-as-block', (e) => {
      (window as unknown as { __blockEvents: unknown[] }).__blockEvents.push((e as CustomEvent).detail)
    })
  })
  await page.keyboard.press('Backspace')
  await wait(500)

  // 老实现：前缀格上的退格 return true 吞掉整次按键，块级 merge/delete 收不到信号，
  // 用户看到的就是「按退格没反应」
  const events = await page.evaluate(
    () => (window as unknown as { __blockEvents: unknown[] }).__blockEvents,
  )
  expect(events.length).toBeGreaterThan(0)
  expect((await state(page)).chips).toEqual(['https://www.doubao.com'])
})

/** 光标前的可见文字（含隐藏语法，按 ProseMirror 文档文本量） */
async function textBeforeCaret(page: Page) {
  return page.evaluate(() => {
    const dom = document.querySelector('.ProseMirror')
    const sel = window.getSelection()
    if (!dom || !sel || !sel.rangeCount) return null
    const pre = sel.getRangeAt(0).cloneRange()
    pre.selectNodeContents(dom)
    pre.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset)
    return pre.toString()
  })
}

test('链接视图别名中间打字：光标紧跟新字，不往前多跳一格（用户报障回归）', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(600)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(400)
  // Home = 字面之前（前缀格），→ 一次进到别名首字之后
  await page.keyboard.press('Home')
  await wait(200)
  await page.keyboard.press('ArrowRight')
  await wait(200)
  expect(await textBeforeCaret(page)).toBe('[h')

  // 老实现：插入位置对，但光标多走一格 —— `h|ttps` 打 `z` 得 `hzt|tps`
  await page.keyboard.type('z', { delay: 40 })
  await wait(300)
  expect(await textBeforeCaret(page)).toBe('hz')

  // 接着打第二个字仍要落在正确位置（光标不累积漂移）
  await page.keyboard.type('y', { delay: 40 })
  await wait(300)
  expect(await textBeforeCaret(page)).toBe('hzy')
})

test('链接视图改坏后把错字改回来：链接自动恢复（用户报障回归）', async ({ page }) => {
  await boot(page)
  await page.keyboard.type('https://www.doubao.com', { delay: 30 })
  await wait(600)
  await page.keyboard.press('Escape')
  await wait(400)

  await page.locator('.block').first().click()
  await wait(400)
  await page.keyboard.press('Home')
  await wait(200)
  await page.keyboard.press('ArrowRight')
  await wait(200)
  // 打一个错字：网址不再合法，字面按 ADR-0067 D8 拆成纯文本（视觉文字不变）
  await page.keyboard.type('z', { delay: 40 })
  await wait(300)
  expect((await state(page)).chips).toEqual([])

  // 把错字删掉：文本重新合法 ⇒ 原位恢复成 chip（旧实现只管「光标前那截」，
  // 光标在网址中间时永远命中不了，链接再也回不来）
  await page.keyboard.press('Backspace')
  await wait(400)
  const editing = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '')
  expect(editing).toBe('[https://www.doubao.com](https://www.doubao.com)')
  expect((await state(page)).chips).toEqual(['https://www.doubao.com'])

  await page.keyboard.press('Escape')
  await wait(400)
  // 读态：仍是可点链接（读态外链渲染成 `.web-link-chip` span），没有方括号漏出来
  expect((await state(page)).texts[0]).toBe('https://www.doubao.com')
  expect(await page.locator('.block .web-link-chip[data-external="https://www.doubao.com"]').count())
    .toBeGreaterThan(0)
})
