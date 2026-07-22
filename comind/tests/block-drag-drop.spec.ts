import { test, expect } from '@playwright/test'

/**
 * Block 拖放 e2e 测试
 *
 * 验证 useBlockDragDrop composable + <BlockDropIndicator> 的端到端行为：
 * - 拖拽排序
 * - 嵌套
 * - 循环嵌套阻止
 * - 指示器可见性
 *
 * 注意：VueDraggable 使用 force-fallback，需用手动鼠标事件模拟拖拽。
 */

test.describe('Block drag and drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
  })

  /**
   * 通过手动鼠标事件模拟 VueDraggable 的 force-fallback 拖拽。
   * VueDraggable 的 handle 是 .block-bullet，需在 bullet 上 mousedown 启动。
   */
  async function dragBlock(
    page: import('@playwright/test').Page,
    sourceBlockText: string,
    targetBlockText: string,
    offsetY: number = 0
  ) {
    const sourceBlock = page.locator('.block', { hasText: sourceBlockText }).first()
    const targetBlock = page.locator('.block', { hasText: targetBlockText }).first()

    const sourceBullet = sourceBlock.locator('.block-bullet').first()
    const targetBullet = targetBlock.locator('.block-bullet').first()

    const sourceBox = await sourceBullet.boundingBox()
    const targetBox = await targetBullet.boundingBox()

    if (!sourceBox || !targetBox) {
      throw new Error(`无法定位 bullet: source=${sourceBlockText}, target=${targetBlockText}`)
    }

    const startX = sourceBox.x + sourceBox.width / 2
    const startY = sourceBox.y + sourceBox.height / 2
    const endX = targetBox.x + targetBox.width / 2
    const endY = targetBox.y + targetBox.height / 2 + offsetY

    // mousedown on bullet
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.waitForTimeout(200)

    // 移动到目标位置（触发 dragover/dragmove）
    await page.mouse.move(endX, endY, { steps: 10 })
    await page.waitForTimeout(300)

    // mouseup 完成放置
    await page.mouse.up()
    await page.waitForTimeout(500)
  }

  test('should show drop indicator during drag', async ({ page }) => {
    // 创建 2 个 block
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(500)
    await page.keyboard.type('Block A')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type('Block B')
    await page.waitForTimeout(500)

    // 开始拖拽（不 mouseup，观察指示器）
    const sourceBlock = page.locator('.block', { hasText: 'Block A' }).first()
    const targetBlock = page.locator('.block', { hasText: 'Block B' }).first()
    const sourceBullet = sourceBlock.locator('.block-bullet').first()
    const targetBullet = targetBlock.locator('.block-bullet').first()

    const sourceBox = await sourceBullet.boundingBox()
    const targetBox = await targetBullet.boundingBox()

    expect(sourceBox).not.toBeNull()
    expect(targetBox).not.toBeNull()

    await page.mouse.move(sourceBox!.x + 5, sourceBox!.y + 5)
    await page.mouse.down()
    await page.waitForTimeout(200)
    await page.mouse.move(targetBox!.x + 5, targetBox!.y + 5, { steps: 10 })
    await page.waitForTimeout(300)

    // 指示器应出现（visible 类）
    const indicator = page.locator('.drop-indicator.visible')
    await expect(indicator).toBeVisible({ timeout: 2000 })

    // 清理
    await page.mouse.up()
    await page.waitForTimeout(300)
  })

  test('should sort blocks by dragging', async ({ page }) => {
    // 创建 3 个 block
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(500)
    await page.keyboard.type('SortA')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type('SortB')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type('SortC')
    await page.waitForTimeout(500)

    // 验证初始顺序
    const blocksBefore = page.locator('.block[data-block-id]')
    const countBefore = await blocksBefore.count()
    expect(countBefore).toBeGreaterThanOrEqual(3)

    // 拖拽 SortC 到 SortA 上方（offsetY = -5 表示 before）
    await dragBlock(page, 'SortC', 'SortA', -5)
    await page.waitForTimeout(1000)

    // 验证顺序变化：SortC 应在 SortA 之前
    const allBlocks = page.locator('.block[data-block-id]')
    const texts: string[] = []
    const count = await allBlocks.count()
    for (let i = 0; i < count; i++) {
      const text = await allBlocks.nth(i).textContent()
      texts.push(text || '')
    }

    const sortCIdx = texts.findIndex(t => t.includes('SortC'))
    const sortAIdx = texts.findIndex(t => t.includes('SortA'))
    expect(sortCIdx).toBeGreaterThanOrEqual(0)
    expect(sortAIdx).toBeGreaterThanOrEqual(0)
    expect(sortCIdx).toBeLessThan(sortAIdx)
  })

  test('should nest block under another by dragging right', async ({ page }) => {
    // 创建 2 个 block
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(500)
    await page.keyboard.type('ParentBlock')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type('ChildBlock')
    await page.waitForTimeout(500)

    // 拖拽 ChildBlock 到 ParentBlock 右侧（nest zone）
    const parentBlock = page.locator('.block', { hasText: 'ParentBlock' }).first()
    const childBlock = page.locator('.block', { hasText: 'ChildBlock' }).first()
    const parentBullet = parentBlock.locator('.block-bullet').first()
    const childBullet = childBlock.locator('.block-bullet').first()

    const parentBox = await parentBullet.boundingBox()
    const childBox = await childBullet.boundingBox()

    expect(parentBox).not.toBeNull()
    expect(childBox).not.toBeNull()

    // mousedown on child bullet
    await page.mouse.move(childBox!.x + 5, childBox!.y + 5)
    await page.mouse.down()
    await page.waitForTimeout(200)

    // 移动到 parent bullet 右侧（nest zone: cursorX >= bulletRect.right - 15）
    const nestX = parentBox!.x + parentBox!.width + 10
    const nestY = parentBox!.y + parentBox!.height / 2
    await page.mouse.move(nestX, nestY, { steps: 10 })
    await page.waitForTimeout(300)

    // 应显示 nest 指示器
    const nestIndicator = page.locator('.drop-indicator.nest.visible')
    await expect(nestIndicator).toBeVisible({ timeout: 2000 })

    await page.mouse.up()
    await page.waitForTimeout(1000)

    // 验证 ChildBlock 现在是 ParentBlock 的子节点
    // 子节点容器 .block-children 在 ParentBlock 内部
    const parentBlockEl = page.locator('.block', { hasText: 'ParentBlock' }).first()
    const childInParent = parentBlockEl.locator('.block-children .block', { hasText: 'ChildBlock' })
    await expect(childInParent).toHaveCount(1, { timeout: 3000 })
  })

  test('should prevent circular nesting (drag parent into its own child)', async ({ page }) => {
    // 创建 Parent > Child 结构
    const blockContent = page.locator('.block-content').first()
    await blockContent.click()
    await page.waitForTimeout(500)
    await page.keyboard.type('RootParent')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)
    await page.keyboard.type('LeafChild')
    await page.waitForTimeout(500)

    // 先把 LeafChild 嵌套到 RootParent 下
    const parentBlock = page.locator('.block', { hasText: 'RootParent' }).first()
    const childBlock = page.locator('.block', { hasText: 'LeafChild' }).first()
    const parentBullet = parentBlock.locator('.block-bullet').first()
    const childBullet = childBlock.locator('.block-bullet').first()

    const parentBox = await parentBullet.boundingBox()
    const childBox = await childBullet.boundingBox()

    expect(parentBox).not.toBeNull()
    expect(childBox).not.toBeNull()

    // 嵌套 LeafChild 到 RootParent
    await page.mouse.move(childBox!.x + 5, childBox!.y + 5)
    await page.mouse.down()
    await page.waitForTimeout(200)
    const nestX = parentBox!.x + parentBox!.width + 10
    const nestY = parentBox!.y + parentBox!.height / 2
    await page.mouse.move(nestX, nestY, { steps: 10 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(1000)

    // 现在尝试把 RootParent 拖到 LeafChild 的子容器中（应被阻止）
    const rootBlockEl = page.locator('.block', { hasText: 'RootParent' }).first()
    const leafBlockEl = page.locator('.block', { hasText: 'LeafChild' }).first()
    const rootBullet = rootBlockEl.locator('.block-bullet').first()
    const leafBullet = leafBlockEl.locator('.block-bullet').first()

    const rootBox = await rootBullet.boundingBox()
    const leafBox = await leafBullet.boundingBox()

    expect(rootBox).not.toBeNull()
    expect(leafBox).not.toBeNull()

    // 拖拽 RootParent 到 LeafChild 的子区域
    await page.mouse.move(rootBox!.x + 5, rootBox!.y + 5)
    await page.mouse.down()
    await page.waitForTimeout(200)
    const targetX = leafBox!.x + leafBox!.width + 10
    const targetY = leafBox!.y + leafBox!.height / 2
    await page.mouse.move(targetX, targetY, { steps: 10 })
    await page.waitForTimeout(300)

    // 指示器不应显示（循环嵌套被阻止）
    const visibleIndicator = page.locator('.drop-indicator.visible')
    const indicatorCount = await visibleIndicator.count()

    await page.mouse.up()
    await page.waitForTimeout(1000)

    // 循环嵌套被阻止：RootParent 不应出现在 LeafChild 内部
    const rootStillAtTopLevel = page.locator('.block-children .block', { hasText: 'RootParent' })
    await expect(rootStillAtTopLevel).toHaveCount(0, { timeout: 3000 })

    // 指示器在循环位置不应可见
    expect(indicatorCount).toBe(0)
  })
})
