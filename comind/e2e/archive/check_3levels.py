from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 700})
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 创建3层嵌套
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('Level 0')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Level 1')
    page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Level 2')
    page.wait_for_timeout(500)

    page.screenshot(path='e2e/screenshots/indent_3levels_fixed.png', full_page=True)

    blocks = page.locator('.block').all()
    print(f'Total blocks: {len(blocks)}')
    for i in range(len(blocks)):
        b = page.locator('.block').nth(i)
        lines = b.locator('> .block-row .indent-line').count()
        try:
            text = b.locator('.tiptap').first.inner_text()[:20]
        except:
            text = '(empty)'
        print(f'  Block {i}: "{text}" -> {lines} lines')

    browser.close()
