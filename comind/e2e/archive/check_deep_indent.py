from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    page.goto('http://localhost:5203')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    # 等待自动聚焦
    active = page.locator('.block.active').count()
    print(f'Active blocks: {active}')
    
    total_blocks = page.locator('.block').count()
    print(f'Total blocks: {total_blocks}')

    # 创建深层级结构
    # Level 0: Root
    content = page.locator('.block-content').first
    content.click()
    page.wait_for_timeout(300)
    
    page.keyboard.type('Level 0 Root')
    page.wait_for_timeout(200)
    
    # Enter -> Level 1
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Level 1 Child')
    page.wait_for_timeout(200)
    
    # Tab 缩进到 Level 1
    page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    
    # Enter -> Level 2
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Level 2 Grandchild')
    page.wait_for_timeout(200)
    
    # Tab 缩进到 Level 2
    page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    
    # Enter -> Level 3
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Level 3 Deep')
    page.wait_for_timeout(200)
    
    # Tab 缩进到 Level 3
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)

    page.screenshot(path='e2e/screenshots/deep_indent.png', full_page=True)
    
    indent_lines = page.locator('.indent-line').count()
    print(f'Total indent-line elements: {indent_lines}')
    
    # 检查每个 block 的 indent 状态
    blocks = page.locator('.block').all()
    for i in range(len(blocks)):
        block = page.locator('.block').nth(i)
        lines_in_block = block.locator('.indent-line').count()
        try:
            text_el = block.locator('.block-text, .tiptap').first
            text = text_el.inner_text()[:30]
        except:
            text = '(empty)'
        print(f'  Block {i}: "{text}" - {lines_in_block} lines')

    browser.close()
