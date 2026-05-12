from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    # 创建简单结构: parent -> child
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)
    page.keyboard.type('parent')
    page.wait_for_timeout(500)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('child')
    page.wait_for_timeout(500)
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)
    
    # 截图 - 创建后
    page.screenshot(path='e2e/screenshots/persist_1_created.png')
    print('Created: persist_1_created.png')
    
    # 折叠 parent
    bullets = page.locator('.block-bullet').all()
    if len(bullets) >= 1:
        bullets[0].click(force=True)
        page.wait_for_timeout(500)
        page.screenshot(path='e2e/screenshots/persist_2_collapsed.png')
        print('Collapsed: persist_2_collapsed.png')
        
        # 刷新页面
        page.reload()
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)
        
        page.screenshot(path='e2e/screenshots/persist_3_reloaded.png')
        print('Reloaded: persist_3_reloaded.png')
        
        # 检查 child 是否可见（如果 collapsed 持久化，child 应该隐藏）
        child_visible = page.locator('.block-text:has-text("child")').is_visible()
        print(f'Child visible after reload: {child_visible}')
        if not child_visible:
            print('SUCCESS: collapsed state persisted!')
        else:
            print('FAILED: collapsed state not persisted')
    
    browser.close()
