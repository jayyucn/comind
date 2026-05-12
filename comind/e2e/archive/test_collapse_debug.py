from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    
    # 创建父子结构
    page.locator('.block-content').first.click()
    page.wait_for_selector('.block.active', timeout=3000)
    page.keyboard.type('Parent')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Child')
    page.keyboard.press('Tab')
    page.wait_for_timeout(400)
    
    # 找父 block
    def get_parent_block():
        blocks = page.locator('.block').all()
        for b in blocks:
            ch = b.locator('.block-children')
            if ch.count() > 0 and ch.locator('.block').count() > 0:
                return b
        return None
    
    parent = get_parent_block()
    parent_id = parent.get_attribute('data-block-id')
    parent_index = page.evaluate(f"""
        () => {{
            const blockList = document.querySelector('.block-list');
            const children = Array.from(blockList.querySelectorAll(':scope > .block'));
            return children.findIndex(el => el.getAttribute('data-block-id') === '{parent_id}');
        }}
    """)
    children_div = page.locator('.block-list > .block').nth(parent_index).locator('> .block-children')
    parent_bullet = page.locator('.block-list > .block').nth(parent_index).locator('> .block-row > .block-bullet')
    
    # 获取子 block 的 bounding rect（用于判断是否可见）
    child_block_bounding = page.locator('.block-list > .block').nth(parent_index).locator('> .block-children > .block').first
    
    print('=== BEFORE COLLAPSE ===')
    bounding_before = child_block_bounding.bounding_box()
    count_before = children_div.count()
    computed_h_before = children_div.evaluate('el => window.getComputedStyle(el).height')
    computed_mh_before = children_div.evaluate('el => window.getComputedStyle(el).maxHeight')
    print(f'  .block-children count: {count_before}')
    print(f'  .block-children computed.height: {computed_h_before}')
    print(f'  .block-children computed.maxHeight: {computed_mh_before}')
    print(f'  Child block bounding box: {bounding_before}')
    page.screenshot(path='e2e/screenshots/collapse_before.png')
    
    # 点击折叠
    print('\n=== CLICK COLLAPSE ===')
    parent_bullet.click(force=True)
    page.wait_for_timeout(800)  # 等待 200ms 动画 + buffer
    
    print('=== AFTER COLLAPSE ===')
    count_after = children_div.count()
    computed_h_after = children_div.evaluate('el => window.getComputedStyle(el).height')
    computed_mh_after = children_div.evaluate('el => window.getComputedStyle(el).maxHeight')
    style_mh_after = children_div.evaluate('el => el.style.maxHeight')
    
    # 尝试获取子 block 的 bounding（如果被隐藏，可能返回 None）
    try:
        child_block_bounding_after = child_block_bounding.bounding_box()
    except:
        child_block_bounding_after = 'NOT FOUND'
    
    print(f'  .block-children count: {count_after}')
    print(f'  .block-children style.maxHeight: [{style_mh_after}]')
    print(f'  .block-children computed.height: {computed_h_after}')
    print(f'  .block-children computed.maxHeight: {computed_mh_after}')
    print(f'  Child block bounding box: {child_block_bounding_after}')
    
    if count_after > 0:
        is_hidden = children_div.evaluate('el => { const s = el.style; return s.maxHeight === "0px" || s.maxHeight === "0"; }')
        print(f'  maxHeight is 0px (hidden): {is_hidden}')
    
    page.screenshot(path='e2e/screenshots/collapse_after.png')
    
    # 点击展开
    print('\n=== CLICK EXPAND ===')
    parent_bullet.click(force=True)
    page.wait_for_timeout(800)
    
    print('=== AFTER EXPAND ===')
    count_expand = children_div.count()
    computed_h_expand = children_div.evaluate('el => window.getComputedStyle(el).height')
    style_mh_expand = children_div.evaluate('el => el.style.maxHeight')
    print(f'  .block-children count: {count_expand}')
    print(f'  .block-children style.maxHeight: [{style_mh_expand}]')
    print(f'  .block-children computed.height: {computed_h_expand}')
    
    page.screenshot(path='e2e/screenshots/collapse_expand.png')
    print('\nScreenshots saved: collapse_before.png, collapse_after.png, collapse_expand.png')
    
    browser.close()
