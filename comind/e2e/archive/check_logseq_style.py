from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 500})
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 清空后重建
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

    # 构建和用户截图一样的结构：
    # test1 (root)
    #   test2 (child)
    #   test3 (child, has children)
    #     test4 (grandchild)
    #     test5 (grandchild)
    #     test6 (grandchild)

    def type_block(text):
        page.keyboard.type(text)
        page.wait_for_timeout(150)

    def enter():
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)

    def tab():
        page.keyboard.press('Tab')
        page.wait_for_timeout(400)

    # test1
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    type_block('test1')
    enter()

    # test2
    type_block('test2')
    tab()
    enter()

    # test3
    type_block('test3')
    # test3 和 test2 同级，不需要反缩进（Enter 后自动同级）
    enter()

    # test4 - 缩进为 test3 的子节点
    type_block('test4')
    tab()
    enter()

    # test5 - test3 的子节点
    type_block('test5')
    enter()

    # test6 - test3 的子节点
    type_block('test6')
    page.wait_for_timeout(500)

    page.screenshot(path='e2e/screenshots/indent_logseq_style.png', full_page=True)

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
