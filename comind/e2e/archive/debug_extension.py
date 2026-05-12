"""直接测试 Enter split"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(500)

    # 创建第一个 Block
    page.locator('.add-block-btn').click()
    page.wait_for_timeout(500)

    # 激活并输入
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    tiptap = page.locator('.block.active .tiptap')
    tiptap.click()
    page.keyboard.type('ABCDEF')
    page.wait_for_timeout(200)

    # 失焦（让 block-text 渲染出来）
    page.locator('.page-title').click()
    page.wait_for_timeout(200)

    # 检查输入内容
    bt = page.locator('.block-text').first.inner_text()
    print(f"输入后 block-text: {repr(bt)}")

    # 重新激活第二个块
    page.locator('.block-content').first.click()
    page.wait_for_timeout(100)

    # 移动光标到开头（A|B|CDEF）
    page.keyboard.press('Home')
    page.wait_for_timeout(50)

    print("按 Enter...")
    page.keyboard.press('Enter')
    page.wait_for_timeout(800)

    # 失焦检查 block-text
    page.locator('.page-title').click()
    page.wait_for_timeout(300)

    blocks = page.locator('.block').all()
    print(f"Block 数量: {len(blocks)} (期望: 2)")
    for i, b in enumerate(blocks):
        text = b.locator('.block-text').inner_text() if b.locator('.block-text').count() else 'N/A'
        active = 'ACTIVE' if 'active' in (b.get_attribute('class') or '') else ''
        print(f"  Block[{i}] {active}: {repr(text)}")

    page.screenshot(path='e2e/screenshots/debug_ext_final.png', full_page=True)
    browser.close()
