"""详细调试 Enter Split"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    # 开启控制台日志
    page.on("console", lambda msg: print(f"[BROWSER] {msg.text}"))

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    page.locator('.add-block-btn').click()
    page.wait_for_timeout(500)

    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # 在 tiptap 中输入
    tiptap = page.locator('.block.active .tiptap')
    tiptap.click()
    page.keyboard.type('Hello World')
    page.wait_for_timeout(200)

    print(f"输入后 tiptap.inner_text: {repr(tiptap.inner_text())}")

    # 移动光标到 "Hello | World"（Home + 5 次右）
    page.keyboard.press('Home')
    for _ in range(5):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(100)

    # 在按 Enter 前，用 JS 直接检查 state
    cursor_pos = page.evaluate("""
        () => {
            const tiptap = document.querySelector('.block.active .tiptap');
            if (!tiptap) return 'no tiptap';
            const state = tiptap.__tiptap_editor?.state;
            if (!state) return 'no state';
            const sel = state.selection;
            return { from: sel.from, to: sel.to };
        }
    """)
    print(f"Enter 前光标: {cursor_pos}")

    # 截图
    page.screenshot(path='e2e/screenshots/debug2_before.png', full_page=True)

    # 按 Enter
    page.keyboard.press('Enter')
    page.wait_for_timeout(800)

    # Enter 后检查
    print("\n按 Enter 后:")
    for i, block in enumerate(page.locator('.block').all()):
        cls = block.get_attribute('class')
        block_text = block.locator('.block-text').inner_text() if block.locator('.block-text').count() else 'N/A'
        tiptap_txt = block.locator('.tiptap').inner_text() if block.locator('.tiptap').count() else 'N/A'
        print(f"  Block[{i}] class={repr(cls)}, block-text={repr(block_text[:30])}, tiptap={repr(tiptap_txt[:30])}")

    page.screenshot(path='e2e/screenshots/debug2_after.png', full_page=True)

    browser.close()
