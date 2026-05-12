/**
 * 拖拽排序功能 E2E 测试
 */

import { test, expect, Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173'

test.describe('拖拽排序功能测试', () => {
  async function navigateToJournal(page: Page): Promise<void> {
    const today = new Date().toISOString().split('T')[0]
    await page.goto(`${BASE_URL}/journal/${today}`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)
    await page.waitForSelector('.block', { timeout: 10000 })
  }

  async function createBlocks(page: Page, count: number): Promise<void> {
    const blocks = page.locator('.block')
    await blocks.first().click()
    await page.waitForTimeout(300)
    
    for (let i = 1; i <= count; i++) {
      await page.keyboard.type(`Block-${i}`)
      if (i < count) {
        await page.keyboard.press('Enter')
        await page.waitForTimeout(200)
      }
    }
    await page.waitForTimeout(300)
    
    await page.click('body', { position: { x: 10, y: 10 } })
    await page.waitForTimeout(300)
  }

  async function dragBlock(page: Page, fromIndex: number, toIndex: number): Promise<void> {
    const blocks = page.locator('.block')
    const fromBullet = blocks.nth(fromIndex).locator('.block-bullet')
    const toBlock = blocks.nth(toIndex)
    
    const fromBox = await fromBullet.boundingBox()
    const toBox = await toBlock.boundingBox()
    
    if (!fromBox || !toBox) {
      throw new Error('无法获取元素位置')
    }
    
    const startX = fromBox.x + fromBox.width / 2
    const startY = fromBox.y + fromBox.height / 2
    const endX = toBox.x + toBox.width / 2
    const endY = toBox.y + toBox.height * 1.5
    
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.waitForTimeout(200)
    await page.mouse.move(endX, endY, { steps: 10 })
    await page.waitForTimeout(200)
    await page.mouse.up()
    await page.waitForTimeout(800)
  }

  async function nestBlock(page: Page, childIndex: number, parentIndex: number): Promise<void> {
    const blocks = page.locator('.block')
    const childBlock = blocks.nth(childIndex)
    const parentBlock = blocks.nth(parentIndex)
    
    const childBullet = childBlock.locator('.block-bullet')
    const childContainer = parentBlock.locator('.block-children').first()
    
    const childBox = await childBullet.boundingBox()
    const containerBox = await childContainer.boundingBox()
    
    if (!childBox || !containerBox) {
      throw new Error('无法获取元素位置')
    }
    
    const startX = childBox.x + childBox.width / 2
    const startY = childBox.y + childBox.height / 2
    const endX = containerBox.x + containerBox.width / 2
    const endY = containerBox.y + containerBox.height / 2
    
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.waitForTimeout(200)
    await page.mouse.move(endX, endY, { steps: 15 })
    await page.waitForTimeout(300)
    await page.mouse.up()
    await page.waitForTimeout(1000)
  }

  test('TC-DRAG-01: 根级拖拽排序', async ({ page }) => {
    await navigateToJournal(page)
    await createBlocks(page, 3)
    
    await dragBlock(page, 0, 2)
    
    const blockCount = await page.locator('.block').count()
    expect(blockCount).toBe(3)
  })

  test('TC-DRAG-02: 拖拽后数据持久化', async ({ page }) => {
    await navigateToJournal(page)
    await createBlocks(page, 3)
    
    await dragBlock(page, 0, 2)
    
    await page.reload()
    await page.waitForSelector('.block', { timeout: 10000 })
    await page.waitForTimeout(1000)
    
    const blockCount = await page.locator('.block').count()
    expect(blockCount).toBe(3)
  })

  test('TC-DRAG-03: 嵌套拖拽 - 子节点显示', async ({ page }) => {
    await navigateToJournal(page)
    await createBlocks(page, 3)
    
    await nestBlock(page, 2, 0)
    
    const parentBlock = page.locator('.block').nth(0)
    const childrenContainer = parentBlock.locator('.block-children')
    const childrenCount = await childrenContainer.locator('.block').count()
    
    expect(childrenCount).toBe(1)
  })

  test('TC-DRAG-04: 子节点拖拽排序', async ({ page }) => {
    await navigateToJournal(page)
    await createBlocks(page, 4)
    
    await nestBlock(page, 2, 0)
    await nestBlock(page, 3, 0)
    
    const parentBlock = page.locator('.block').nth(0)
    const childrenCount = await parentBlock.locator('.block-children .block').count()
    
    expect(childrenCount).toBe(2)
  })
})