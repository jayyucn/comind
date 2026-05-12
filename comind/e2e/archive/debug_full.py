"""验证 Enter split 的完整行为"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)

    page.locator('.add-block-btn').click()
    page.wait_for_timeout(500)

    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    tiptap = page.locator('.block.active .tiptap')
    tiptap.click()
    page.keyboard.type('Hello World')
    page.wait_for_timeout(200)

    # 移动光标到 Hello|World（Home + 6 次右）
    page.keyboard.press('Home')
    for _ in range(6):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(100)

    print("按 Enter (split at 'Hello |World')...")
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)

    blocks = page.locator('.block').all()
    print(f"Block 数量: {len(blocks)} (期望: 2)")

    for i, b in enumerate(blocks):
        text = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else 'N/A'
        cls = b.get_attribute('class') or ''
        active = 'ACTIVE' if 'active' in cls else ''
        print(f"  Block[{i}] {active}: {repr(text)}")

    # 测试新 Block 是否可以继续输入
    if len(blocks) >= 2:
        # 新 Block 应该已经激活
        active_el = page.locator('.block.active')
        if active_el.count() == 0:
            print("  ⚠️ 新 Block 未获得焦点，尝试手动激活...")
            page.locator('.block').nth(1).locator('.block-content').click()
            page.wait_for_timeout(200)

        active_el = page.locator('.block.active')
        print(f"  激活 Block: {active_el.count()} 个")

        # 在新 Block 输入
        tiptap2 = page.locator('.block.active .tiptap')
        tiptap2.click()
        page.keyboard.type(' - new')
        page.wait_for_timeout(200)

        # 再次检查
        blocks = page.locator('.block').all()
        print(f"\n输入后 Block 数量: {len(blocks)}")
        for i, b in enumerate(blocks):
            text = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else 'N/A'
            print(f"  Block[{i}]: {repr(text)}")

    page.screenshot(path='e2e/screenshots/debug_full.png', full_page=True)
    browser.close()
