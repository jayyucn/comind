from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 900})
    page.goto('http://localhost:5203')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 用用户实际数据：先看看当前状态
    print('=== Before typing ===')
    
    # 创建嵌套结构
    content = page.locator('.block-content').first
    content.click()
    page.wait_for_timeout(300)
    page.keyboard.type('Root block')
    page.wait_for_timeout(200)
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Child one')
    page.wait_for_timeout(200)
    page.keyboard.press('Tab')  # indent
    page.wait_for_timeout(400)
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Child two')
    page.wait_for_timeout(200)
    page.keyboard.press('Tab')  # indent to level 2
    page.wait_for_timeout(500)

    page.screenshot(path='e2e/screenshots/indent_user_view.png', full_page=True)

    # 详细统计
    blocks = page.locator('.block').all()
    print(f'Total blocks: {len(blocks)}')
    for i in range(len(blocks)):
        b = page.locator('.block').nth(i)
        lines = b.locator('> .block-row .indent-line').count()
        try:
            text = b.locator('.tiptap').first.inner_text()[:30]
        except:
            text = '(empty)'
        # 检查所有 .indent-line（包括子元素中的）
        all_lines = b.locator('.indent-line').count()
        print(f'  Block {i}: "{text}" row-lines={lines} total-lines={all_lines}')

    browser.close()
