/**
 * 跨块 ArrowUp / ArrowDown 列保持 —— 真机(人工)集成测试
 *
 * 验证「词处理器模型」：光标在块的末行按 ArrowDown / 首行按 ArrowUp 时，
 * 跳到上/下一块并保持原来的水平列位置(短块则钳到末尾)。
 *
 * 这是纯 jsdom 单测无法覆盖的部分:列保持依赖真实布局的
 * `coordsAtPos` / `posAtCoords`(需要浏览器渲染坐标)。
 *
 * 运行: `npm run dev`(已起则复用)后 `npx playwright test tests/cross-block-arrow.spec.ts`
 *
 * 手动验证步骤(等价):
 *   1. 打开今日 journal,清空首块输入 A,Enter 新建 B 输入 B;
 *   2. 光标停 B 末尾 → 按 ↑:应跳到 A 的同列(而非 B 开头);
 *   3. 光标停 A 开头 → 按 ↓:应跳到 B 的开头(同列)。
 */

import { test, expect, type Page } from '@playwright/test'

const A_LONG = 'Hello World' // 11 字符,较长
const A_SHORT = 'Hi' // 2 字符,较短
const B_SHORT = 'Hi' // 2 字符
const B_LONG = 'Hello World' // 11 字符

/** 清空并写入指定文本到一个块编辑区,返回该块 locator */
async function writeBlock(page: Page, block: ReturnType<Page['locator']>, text: string) {
  await block.click()
  // 单行块:Home → Shift+End 选中整行 → Delete 清空(空块无影响)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('Delete')
  await page.keyboard.type(text)
}

/** 读取当前激活块(.block.active)的编辑文本与光标字符偏移 */
async function readActiveCaret(page: Page): Promise<{ text: string | null; offset: number | null }> {
  return page.evaluate(() => {
    const active = document.querySelector('.block.active')
    const editor = active?.querySelector('.tiptap') as HTMLElement | null
    if (!active || !editor) return { text: null, offset: null }
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return { text: editor.textContent, offset: null }
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(editor)
    pre.setEnd(range.endContainer, range.endOffset)
    return { text: editor.textContent, offset: pre.toString().length }
  })
}

test.describe('跨块光标移动(ArrowUp/ArrowDown 列保持)', () => {
  test.beforeEach(async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`/journal/${today}`)
    await page.waitForSelector('.block', { timeout: 15000 })
  })

  test('ArrowUp @ B末尾(长A短B):跳到 A 同列中间,而非 B 开头', async ({ page }) => {
    const first = page.locator('.block').first()
    await writeBlock(page, first, A_LONG) // A = "Hello World"
    await page.keyboard.press('Enter') // 在 A 后新建兄弟块 B
    // 等待 B 出现并激活
    await page.waitForFunction(
      () => {
        const a = document.querySelectorAll('.block')
        return a.length >= 2 && (a[1] as HTMLElement)?.contains(document.activeElement)
      },
      { timeout: 8000 }
    )
    const second = page.locator('.block').nth(1)
    await writeBlock(page, second, B_SHORT) // B = "Hi",光标停在 B 末尾

    await page.keyboard.press('ArrowUp')

    // 等待跨块激活 + 列保持聚焦完成
    await page.waitForFunction(
      () => {
        const a = document.querySelector('.block.active .tiptap')
        const s = window.getSelection()
        return a && s && s.rangeCount > 0 && a.contains(s.anchorNode)
      },
      { timeout: 8000 }
    )
    await page.waitForTimeout(120)

    const res = await readActiveCaret(page)
    // 核心:跨到了上一块 A,而不是停留在 B 开头(旧 bug)
    expect(res.text).toBe(A_LONG)
    // 列保持:同列落在 A 中间(0 < offset < A.length),不是 A 开头(offset 0)也不是单纯末尾
    expect(res.offset).not.toBeNull()
    expect(res.offset!).toBeGreaterThan(0)
    expect(res.offset!).toBeLessThan(A_LONG.length)

    await page.screenshot({ path: 'd:/comind/outputs/cross-block-arrow-up.png' })
  })

  test('ArrowUp @ B末尾(短A长B):跳到 A 并钳到末尾', async ({ page }) => {
    const first = page.locator('.block').first()
    await writeBlock(page, first, A_SHORT) // A = "Hi"(短)
    await page.keyboard.press('Enter')
    await page.waitForFunction(
      () => {
        const a = document.querySelectorAll('.block')
        return a.length >= 2 && (a[1] as HTMLElement)?.contains(document.activeElement)
      },
      { timeout: 8000 }
    )
    const second = page.locator('.block').nth(1)
    await writeBlock(page, second, B_LONG) // B = "Hello World",光标在 B 末尾

    await page.keyboard.press('ArrowUp')
    await page.waitForFunction(
      () => {
        const a = document.querySelector('.block.active .tiptap')
        const s = window.getSelection()
        return a && s && s.rangeCount > 0 && a.contains(s.anchorNode)
      },
      { timeout: 8000 }
    )
    await page.waitForTimeout(120)

    const res = await readActiveCaret(page)
    expect(res.text).toBe(A_SHORT)
    // 长 B 末尾 x 超出短 A → 钳制到 A 末尾
    expect(res.offset).toBe(A_SHORT.length)
  })

  test('ArrowDown @ A开头(短A长B):跳到 B 同列开头', async ({ page }) => {
    const first = page.locator('.block').first()
    await writeBlock(page, first, A_SHORT) // A = "Hi"
    await page.keyboard.press('Home') // 光标停在 A 开头
    await page.keyboard.press('Enter') // 新建 B
    await page.waitForFunction(
      () => {
        const a = document.querySelectorAll('.block')
        return a.length >= 2 && (a[1] as HTMLElement)?.contains(document.activeElement)
      },
      { timeout: 8000 }
    )
    const second = page.locator('.block').nth(1)
    await writeBlock(page, second, B_LONG) // B = "Hello World"
    // 把光标移回 A 开头再按 ↓
    await first.click()
    await page.keyboard.press('Home')

    await page.keyboard.press('ArrowDown')
    await page.waitForFunction(
      () => {
        const a = document.querySelector('.block.active .tiptap')
        const s = window.getSelection()
        return a && s && s.rangeCount > 0 && a.contains(s.anchorNode)
      },
      { timeout: 8000 }
    )
    await page.waitForTimeout(120)

    const res = await readActiveCaret(page)
    expect(res.text).toBe(B_LONG)
    // A 开头 x ≈ B 开头 → 同列落 B 首(offset 0)
    expect(res.offset).toBe(0)
  })
})
