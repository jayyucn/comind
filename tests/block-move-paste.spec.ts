/**
 * 剪切 → 粘贴 = 搬走同一个块（ADR-0025 D4b）。
 *
 * e2e 环境读不到系统剪贴板（`document.hasFocus()` 恒 false，写/读都抛），所以这里
 * **合成 paste 事件**把载荷直接送进 `BlockList.handleDocPaste`：被验的是事件之后的整条真链路
 * —— `resolveClipboardPayload` 解 `op` → `pasteBlocksWithOp` → wasm `move_blocks`
 * （复活 + 换页 + 换父级）→ 内存回写 → DOM。
 *
 * 判据选「id 不变 + 原内容回来了」而不是「多了一个块」：搬移与新建在 DOM 上都表现为多一个块，
 * 只有 id 与内容能区分「同一个块被复活」与「新建了一份副本」。
 *
 * 运行：`npm run dev`（已起则复用）后 `npx playwright test tests/block-move-paste.spec.ts`
 */
import { test, expect, type Page } from '@playwright/test'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 在首块下方用 slash 菜单造一个表格块，并在首格写内容（内容非空才进渲染态）。
 *
 * 刻意先留一个文本块：删表格时会撞上「每页至少留一块」闸门（唯一块只清内容、不软删），
 * 那样就测不到搬移了。
 */
async function createTable(page: Page, cellText: string) {
  await page.locator('.block').first().click()
  await wait(300)
  await page.keyboard.type('锚点块', { delay: 5 })
  await page.keyboard.press('Enter')
  await wait(300)
  await page.keyboard.type('/table', { delay: 30 })
  await wait(400)
  await page.keyboard.press('Enter')
  await wait(800)
  await page.locator('.table-block .cell-input[data-row="0"][data-col="0"]').first().click()
  await page.keyboard.type(cellText, { delay: 5 })
  await wait(500)
}

/** 打开某块的入口菜单并点某一项 */
async function clickEntryMenuItem(page: Page, blockSelector: string, itemKey: string) {
  await page.locator(`${blockSelector} .block-entry-icon`).click()
  await wait(400)
  await page.locator(`[data-block-menu-item="${itemKey}"]`).click()
  await wait(600)
}

/** 合成一次内部剪贴板粘贴（e2e 拿不到真实剪贴板） */
async function pasteInternal(page: Page, payload: unknown) {
  await page.evaluate((raw) => {
    const dt = new DataTransfer()
    dt.setData('application/x-comind-block', raw as string)
    const target = document.querySelector('.block-list') ?? document.body
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    )
  }, JSON.stringify(payload))
  await wait(1200)
}

test('剪切载荷粘贴：同一个 id 被复活，内容原样回来', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)

  await createTable(page, 'MOVE-CELL')

  const tableBlock = page.locator('.block:has(.table-block)').first()
  const blockId = await tableBlock.getAttribute('data-block-id')
  expect(blockId).toBeTruthy()

  // 剪掉它（软删）：真实剪切会同时写剪贴板，e2e 里那一步不可用，故只取「删」这半边，
  // 载荷随后手工合成 —— 与真实链路在「块已软删、载荷带 op:cut」这一点上完全一致。
  await clickEntryMenuItem(page, `.block[data-block-id="${blockId}"]`, 'delete')
  await expect(page.locator(`.block[data-block-id="${blockId}"]`)).toHaveCount(0)

  await pasteInternal(page, {
    version: 2,
    kind: 'blocks',
    op: 'cut',
    // 搬移只认 id（内容从库里复活），载荷本身的正文/格式不参与
    blocks: [{ id: blockId, content: '', type: 'table', format: null, properties: null, children: [] }],
  })

  // 同一个 id 回来了 —— 新建副本会拿到全新 id
  const restored = page.locator(`.block[data-block-id="${blockId}"]`)
  await expect(restored).toHaveCount(1)
  // 内容也回来了：说明是那一行被复活，不是新建的空壳（渲染态没有格编辑器，读块文本）
  await expect(restored).toContainText('MOVE-CELL')
  // 搬移成功要有回馈（降级为新建时不提示）
  await expect(page.locator('.toast, [class*="toast"]').first()).toContainText('已移动')
})

test('复制载荷（op=copy）粘贴：得到新 id 的副本', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)

  await createTable(page, 'COPY-CELL')

  const tableBlock = page.locator('.block:has(.table-block)').first()
  const blockId = await tableBlock.getAttribute('data-block-id')
  expect(blockId).toBeTruthy()

  await pasteInternal(page, {
    version: 2,
    kind: 'blocks',
    op: 'copy',
    blocks: [{ id: blockId, content: '', type: 'table', format: null, properties: null, children: [] }],
  })

  // 源块还在（没被搬走），且多出一个**新 id** 的块
  await expect(page.locator(`.block[data-block-id="${blockId}"]`)).toHaveCount(1)
  await expect(page.locator('.block:has(.table-block)')).toHaveCount(2)
  await expect(page.locator('.toast, [class*="toast"]')).toHaveCount(0)
})

test('同一份剪切载荷连粘两次：第二次降级为新建副本', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await wait(600)

  await createTable(page, 'TWICE-CELL')

  const tableBlock = page.locator('.block:has(.table-block)').first()
  const blockId = await tableBlock.getAttribute('data-block-id')
  expect(blockId).toBeTruthy()

  await clickEntryMenuItem(page, `.block[data-block-id="${blockId}"]`, 'delete')

  const payload = {
    version: 2,
    kind: 'blocks',
    op: 'cut',
    blocks: [{ id: blockId, content: '', type: 'table', format: null, properties: null, children: [] }],
  }

  await pasteInternal(page, payload)
  await expect(page.locator(`.block[data-block-id="${blockId}"]`)).toHaveCount(1)

  // 第二次粘贴时源块已复活（deleted_at 空）⇒ 复活判据失效，回落新建：数量 +1 且不再是老 id
  await pasteInternal(page, payload)
  await expect(page.locator('.block:has(.table-block)')).toHaveCount(2)
  await expect(page.locator(`.block[data-block-id="${blockId}"]`)).toHaveCount(1)
})
