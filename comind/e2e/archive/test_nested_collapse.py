from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    # 创建 3 层结构（每步后点击其他地方确保保存）
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)
    page.keyboard.type('p1')
    page.wait_for_timeout(500)
    
    # 点击空白处确保 p1 保存
    page.mouse.click(500, 500)
    page.wait_for_timeout(500)
    
    # 重新点击 p1 并按 Enter
    page.locator('.block-text:has-text("p1")').click()
    page.wait_for_timeout(200)
    page.keyboard.press('End')  # 光标移到行尾
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    
    # 输入 p2
    page.keyboard.type('p2')
    page.wait_for_timeout(500)
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)
    
    # 点击空白处确保 p2 保存
    page.mouse.click(500, 500)
    page.wait_for_timeout(500)
    
    # 重新点击 p2 并按 Enter
    page.locator('.block-text:has-text("p2")').click()
    page.wait_for_timeout(200)
    page.keyboard.press('End')
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)
    
    # 输入 s1
    page.keyboard.type('s1')
    page.wait_for_timeout(500)
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)
    
    # 点击空白处确保 s1 保存
    page.mouse.click(500, 500)
    page.wait_for_timeout(500)
    
    # 检查内容
    result1 = page.evaluate("""
        () => {
            const blocks = document.querySelectorAll('.block');
            return Array.from(blocks).map(b => ({
                id: b.dataset.blockId?.slice(0, 8),
                text: b.querySelector('.block-text')?.textContent || 'NO TEXT'
            }));
        }
    """)
    print('After creation:')
    for b in result1:
        print(f"  {b}")
    
    # 折叠 p2
    bullets = page.locator('.block-bullet').all()
    bullets[1].click(force=True)
    page.wait_for_timeout(500)
    
    # 折叠 p1
    bullets = page.locator('.block-bullet').all()
    bullets[0].click(force=True)
    page.wait_for_timeout(500)
    
    # 展开 p1
    bullets[0].click(force=True)
    page.wait_for_timeout(500)
    
    # 最终检查
    result2 = page.evaluate("""
        () => {
            const blocks = document.querySelectorAll('.block');
            return Array.from(blocks).map(b => ({
                id: b.dataset.blockId?.slice(0, 8),
                text: b.querySelector('.block-text')?.textContent || 'NO TEXT',
                children_maxHeight: b.querySelector('.block-children')?.style.maxHeight || 'N/A'
            }));
        }
    """)
    print('\nAfter p1 expanded:')
    for b in result2:
        print(f"  {b}")
    
    # 截图
    page.screenshot(path='e2e/screenshots/nested_final.png')
    
    # 检查 p2 是否可见
    p2_visible = page.locator('.block-text:has-text("p2")').is_visible()
    print(f'\np2 visible: {p2_visible}')
    
    browser.close()
