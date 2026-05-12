/**
 * 简化的拖拽测试
 */

import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

test.describe('简单拖拽测试', () => {
  test('TC-SIMPLE-01: 页面加载和导航', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`${BASE_URL}/journal/${today}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    
    console.log(`当前 URL: ${page.url()}`)
    
    const blockList = await page.$('.block-list')
    console.log(`.block-list 存在: ${!!blockList}`)
    
    await page.waitForTimeout(2000)
    const blocks = await page.$$('.block')
    console.log(`Block 数量: ${blocks.length}`)
  })

  test('TC-SIMPLE-02: 创建和拖拽 Block', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`${BASE_URL}/journal/${today}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)
    
    await page.waitForSelector('.block', { timeout: 10000 })
    
    // 使用 Locator API
    const blocks = page.locator('.block')
    const count = await blocks.count()
    console.log(`初始 Block 数量: ${count}`)
    
    if (count > 0) {
      await blocks.first().click()
      await page.waitForTimeout(500)
      
      await page.keyboard.type('First Block')
      await page.waitForTimeout(300)
      
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      await page.keyboard.type('Second Block')
      await page.waitForTimeout(300)
      
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      await page.keyboard.type('Third Block')
      await page.waitForTimeout(500)
      
      const newCount = await blocks.count()
      console.log(`创建后 Block 数量: ${newCount}`)
      
      expect(newCount).toBeGreaterThanOrEqual(3)
      
      if (newCount >= 3) {
        const firstBullet = blocks.nth(0).locator('.block-bullet')
        const thirdBlock = blocks.nth(2)
        
        const bulletBox = await firstBullet.boundingBox()
        const thirdBox = await thirdBlock.boundingBox()
        
        if (bulletBox && thirdBox) {
          const startX = bulletBox.x + bulletBox.width / 2
          const startY = bulletBox.y + bulletBox.height / 2
          const endX = thirdBox.x + thirdBox.width / 2
          const endY = thirdBox.y + thirdBox.height * 1.5
          
          console.log(`拖拽: (${startX}, ${startY}) -> (${endX}, ${endY})`)
          
          await page.mouse.move(startX, startY)
          await page.mouse.down()
          await page.waitForTimeout(200)
          await page.mouse.move(endX, endY, { steps: 10 })
          await page.waitForTimeout(200)
          await page.mouse.up()
          await page.waitForTimeout(1000)
          
          const finalBlocks = page.locator('.block')
          const finalCount = await finalBlocks.count()
          console.log(`拖拽后 Block 数量: ${finalCount}`)
          
          for (let i = 0; i < finalCount; i++) {
            try {
              const text = await finalBlocks.nth(i).locator('.block-text').textContent()
              console.log(`Block ${i}: ${text}`)
            } catch (e) {
              console.log(`Block ${i}: 无法获取文本`)
            }
          }
        }
      }
    }
  })
})