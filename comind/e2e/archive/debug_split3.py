"""深入调试 splitBlock 行为"""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    def log(msg):
        print(msg)

    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    page.locator('.add-block-btn').click()
    page.wait_for_timeout(500)

    # 激活 Block
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # 输入
    tiptap = page.locator('.block.active .tiptap')
    tiptap.click()
    page.keyboard.type('Hello World')
    page.wait_for_timeout(300)

    # 在按 Enter 前，检查 store 中的 block 数据
    store_info = page.evaluate("""
        () => {
            // 尝试通过 __tiptap 获取
            const tiptap = document.querySelector('.block.active .tiptap');
            const editor = tiptap && (tiptap.__tiptap || tiptap.__tiptap_editor);
            if (!editor) return { error: 'no tiptap instance on dom' };

            // 获取 pinia store
            const pinia = window.__pinia;
            if (!pinia) return { error: 'no pinia' };

            const stores = pinia._s;
            if (!stores) return { error: 'no stores' };

            const blockStore = stores.get('blocks');
            if (!blockStore) return { error: 'no blocks store' };

            return {
                blocks: blockStore.blocks.map(b => ({ id: b.id, content: b.content, left: b.left })),
                currentPage: blockStore.currentPageId
            };
        }
    """)
    log(f"Enter 前 store 数据: {store_info}")

    # 移动光标到中间
    page.keyboard.press('Home')
    for _ in range(5):
        page.keyboard.press('ArrowRight')
    page.wait_for_timeout(100)

    log("按 Enter...")
    page.keyboard.press('Enter')
    page.wait_for_timeout(1000)

    # Enter 后检查
    store_after = page.evaluate("""
        () => {
            const pinia = window.__pinia;
            if (!pinia) return { error: 'no pinia' };
            const stores = pinia._s;
            if (!stores) return { error: 'no stores' };
            const blockStore = stores.get('blocks');
            if (!blockStore) return { error: 'no blocks store' };
            return {
                blocks: blockStore.blocks.map(b => ({ id: b.id.substring(0,8), content: b.content, left: b.left })),
            };
        }
    """)
    log(f"Enter 后 store 数据: {store_after}")

    # DOM 状态
    log("\nDOM 状态:")
    for i, block in enumerate(page.locator('.block').all()):
        cls = block.get_attribute('class')
        block_text = block.locator('.block-text').inner_text() if block.locator('.block-text').count() else 'N/A'
        editor_count = block.locator('.tiptap').count()
        active_count = block.locator('.block.active').count()
        log(f"  Block[{i}]: class={repr(cls)}, active={active_count}, has-editor={editor_count}, block-text={repr(block_text[:40])}")

    page.screenshot(path='e2e/screenshots/debug3_after.png', full_page=True)
    browser.close()
