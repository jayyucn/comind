from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 900})
    page.goto('http://localhost:5203')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 截图当前用户数据的状态
    page.screenshot(path='e2e/screenshots/user_current_state.png', full_page=True)

    # 统计
    blocks = page.locator('.block').all()
    print(f'Total blocks: {len(blocks)}')
    
    for i in range(len(blocks)):
        block = page.locator('.block').nth(i)
        row_lines = block.locator('> .block-row .indent-line').count()
        try:
            text = block.locator('.tiptap').first.inner_text()[:40]
        except:
            text = '(empty)'
        depth_attr = block.get_attribute('data-block-id')
        print(f'  Block {i} (id={depth_attr[:8]}...): "{text}" - {row_lines} lines')

    browser.close()
