from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    # 创建第一个 block，包含 [[test link]]
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)
    page.keyboard.type('First with [[test]] link')
    page.wait_for_timeout(500)
    
    # 按 Enter 创建第二个 block
    page.keyboard.press('Enter')
    page.wait_for_timeout(800)
    
    # 检查 DOM 结构
    blocks = page.locator('.block')
    print(f'Block count: {blocks.count()}')
    
    # 检查 block 内容
    for i in range(blocks.count()):
        block = blocks.nth(i)
        classes = block.get_attribute('class')
        print(f'Block {i} classes: {classes}')
        
        # 检查是否 active
        is_active = 'active' in (classes or '')
        
        # 获取内容
        if is_active:
            editor = block.locator('.ProseMirror')
            text = editor.text_content() if editor.count() > 0 else 'N/A'
            print(f'  Editor text: {text}')
        else:
            text_el = block.locator('.block-text')
            text = text_el.text_content() if text_el.count() > 0 else 'N/A'
            html = page.evaluate("""
                () => {
                    const el = document.querySelectorAll('.block-text')[%d];
                    return el ? el.innerHTML : 'N/A';
                }
            """ % i)
            print(f'  Block text: {text}')
            print(f'  Block HTML: {html}')
    
    # 截图
    page.screenshot(path='e2e/screenshots/link_debug2.png')
    print('Screenshot saved.')
    
    browser.close()
