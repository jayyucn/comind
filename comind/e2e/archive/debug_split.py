"""调试 Enter Split 行为"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    # 创建第一个 Block
    page.locator('.add-block-btn').click()
    page.wait_for_timeout(300)

    # 激活并输入
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # 输入
    page.locator('.block.active .tiptap').type('Hello World')
    page.wait_for_timeout(100)

    # 打印 DOM 中 tiptap 的内容
    tiptap_html = page.locator('.block.active .tiptap').inner_html()
    tiptap_text = page.locator('.block.active .tiptap').inner_text()
    print(f"输入后 HTML: {repr(tiptap_html[:100])}")
    print(f"输入后 TEXT: {repr(tiptap_text)}")
    print(f"TEXT 长度: {len(tiptap_text)}")

    # 移动光标到中间
    page.keyboard.press('Home')
    for i in range(5):
        page.keyboard.press('ArrowRight')
        page.wait_for_timeout(30)

    # 按 Enter 前读取 tiptap 内容
    before_html = page.locator('.block.active .tiptap').inner_html()
    before_text = page.locator('.block.active .tiptap').inner_text()
    print(f"\n按 Enter 前 TEXT: {repr(before_text)}")
    print(f"TEXT 长度: {len(before_text)}")

    # 逐字符打印
    for i, c in enumerate(before_text):
        print(f"  [{i}] = {repr(c)} (ord={ord(c)})")

    # 截图
    page.screenshot(path='e2e/screenshots/debug_before_enter.png', full_page=True)

    # 按 Enter
    page.keyboard.press('Enter')
    page.wait_for_timeout(500)

    # 按 Enter 后检查
    print(f"\n按 Enter 后:")
    for i, block in enumerate(page.locator('.block').all()):
        text = block.locator('.block-text').inner_text() if block.locator('.block-text').count() else ''
        tiptap = block.locator('.tiptap').inner_text() if block.locator('.tiptap').count() else ''
        active = 'ACTIVE' if 'active' in (block.get_attribute('class') or '') else ''
        print(f"  Block[{i}] {active}: block-text={repr(text)}, tiptap={repr(tiptap)}")

    page.screenshot(path='e2e/screenshots/debug_after_enter.png', full_page=True)

    browser.close()
