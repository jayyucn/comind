/**
 * 查询块 e2e 公共步骤。
 *
 * 为什么带重试：应用首屏加载会把已输入内容覆盖掉（实测 `hello` 消失），且 `/query` 菜单
 * 必须在编辑器就绪后才弹。整段插入流程在真机上是概率性的，故包一层重试。
 */
import type { Page } from '@playwright/test'

/** 在文末插一个查询块（`/query` 斜杠命令）。 */
export async function insertQueryBlock(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.locator('.block').first().click()
    await page.waitForTimeout(400)
    await page.keyboard.type('hello')
    await page.waitForTimeout(300)
    await page.keyboard.press('Enter')
    // 新块挂载是异步的：只等 DOM 出现不够，焦点没落到新块上时打的字会直接丢
    await page.waitForFunction(
      () => {
        const blocks = document.querySelectorAll('.block')
        const last = blocks[blocks.length - 1]
        const ae = document.activeElement
        return !!last && !!ae && last.contains(ae) && ae.getAttribute('contenteditable') === 'true'
      },
      undefined,
      { timeout: 5000 },
    )
    await page.keyboard.type('/query')
    // 固定等待不够：菜单没弹出来时回车会变成「新建一行」
    await page.waitForSelector('.slash-command-menu .slash-command-item', { timeout: 10000 })
    await page.keyboard.press('Enter')

    const ok = await page
      .waitForSelector('.query-block .lib-body', { state: 'attached', timeout: 10000 })
      .then(() => true)
      .catch(() => false)
    if (ok) return
    console.log(`insertQueryBlock: attempt ${attempt} failed, retrying`)
  }
  throw new Error('查询块未插入成功')
}
