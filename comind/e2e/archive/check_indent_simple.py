from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 900})

    # 先清空 IndexedDB 再打开页面
    page.goto('http://localhost:5203')
    page.wait_for_load_state('networkidle')
    page.evaluate("""() => {
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('comind-db');
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    }""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    # 创建 2 层嵌套结构
    content = page.locator('.block-content').first
    content.click()
    page.wait_for_timeout(300)
    page.keyboard.type('Root')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Child A')
    page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Child B')
    page.wait_for_timeout(200)

    page.screenshot(path='e2e/screenshots/indent_simple.png', full_page=True)

    # 统计
    indent_lines = page.locator('.indent-line').count()
    print(f'Total indent-line elements: {indent_lines}')

    blocks = page.locator('.block').all()
    for i in range(len(blocks)):
        block = page.locator('.block').nth(i)
        lines_in_block = block.locator('> .block-row .indent-line').count()
        print(f'  Block {i} (row-only): {lines_in_block} lines')

    browser.close()
