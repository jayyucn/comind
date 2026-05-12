from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 500})
    
    # 清空 DB
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.evaluate("""() => {
        return new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('comind-db');
            req.onsuccess = () => { resolve('deleted'); };
            req.onerror = () => { resolve('error'); };
        });
    }""")
    print('DB cleared:', page.evaluate("async () => { return await new Promise(r => { const req = indexedDB.deleteDatabase('comind-db'); req.onsuccess = () => r('ok'); req.onerror = () => r('err'); }); }"))
    
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 每步截图看状态
    step = [0]
    def snap(name):
        step[0] += 1
        page.screenshot(path=f'e2e/screenshots/step_{step[0]:02d}_{name}.png')
        blocks = page.locator('.block').all()
        print(f'  Step {step} ({name}): {len(blocks)} blocks')
        for i in range(len(blocks)):
            b = page.locator('.block').nth(i)
            lines = b.locator('> .block-row .indent-line').count()
            try:
                text = b.locator('.tiptap').first.inner_text()[:25]
            except:
                text = '(empty)'
            print(f'    [{i}] "{text}" lines={lines}')

    # Step 1: 初始状态
    snap('initial')

    # Step 2: 输入 test1
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('test1')
    snap('type_test1')

    # Step 3: Enter → 新 block
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    snap('after_enter')

    # Step 4: 输入 test2
    page.keyboard.type('test2')
    snap('type_test2')

    # Step 5: Tab 缩进
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)
    snap('after_tab_test2')

    # Step 6: Enter
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    snap('enter_after_test2')

    # Step 7: 输入 test3
    page.keyboard.type('test3')
    snap('type_test3')

    browser.close()
