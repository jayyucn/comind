/**
 * 调试拖拽测试
 */

import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

test.describe('拖拽调试', () => {
  test('调试嵌套拖拽', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`${BASE_URL}/journal/${today}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.waitForSelector('.block', { timeout: 10000 })
    
    // 创建 3 个 Block
    const blocks = page.locator('.block')
    await blocks.first().click()
    await page.waitForTimeout(300)
    
    await page.keyboard.type('Parent')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await page.keyboard.type('Child1')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await page.keyboard.type('Child2')
    await page.waitForTimeout(300)
    
    await page.click('body', { position: { x: 10, y: 10 } })
    await page.waitForTimeout(500)
    
    // 获取所有 block 的位置
    const allBlocks = page.locator('.block')
    const blockCount = await allBlocks.count()
    
    if (blockCount >= 3) {
      // 获取第一个 block 的子节点容器位置
      const parentBlock = allBlocks.nth(0)
      const child2Block = allBlocks.nth(2)
      
      const childContainer = parentBlock.locator('.block-children')
      const containerBox = await childContainer.boundingBox()
      const child2Box = await child2Block.boundingBox()
      
      if (!containerBox || !child2Box) {
        console.log('无法获取元素位置')
        return
      }
      
      console.log(`子节点容器位置: x=${containerBox.x}, y=${containerBox.y}, w=${containerBox.width}, h=${containerBox.height}`)
      console.log(`Child2 位置: x=${child2Box.x}, y=${child2Box.y}`)
      
      // 从 Child2 的 bullet 位置拖到子节点容器的中心
      const startX = child2Box.x + 15
      const startY = child2Box.y + child2Box.height / 2
      const endX = containerBox.x + containerBox.width / 2
      const endY = containerBox.y + containerBox.height / 2
      
      console.log(`拖拽: (${startX}, ${startY}) -> (${endX}, ${endY})`)
      
      await page.mouse.move(startX, startY)
      await page.mouse.down()
      await page.waitForTimeout(200)
      await page.mouse.move(endX, endY, { steps: 20 })
      await page.waitForTimeout(500)
      await page.mouse.up()
      await page.waitForTimeout(1500)
      
      // 检查最终状态
      const childrenCount = await childContainer.locator('.block').count()
      console.log(`子节点数量: ${childrenCount}`)
      
      await page.screenshot({ path: 'test-results/drag-debug.png', fullPage: true })
    }
  })
})