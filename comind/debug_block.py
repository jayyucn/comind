from playwright.sync_api import sync_playwright

def debug_block_content():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')

        # Wait a bit for Vue to fully render
        page.wait_for_timeout(2000)

        # Take screenshot
        screenshot_path = '/tmp/block_debug.png'
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Screenshot saved to {screenshot_path}")

        # Check block content structure
        print("\n=== Detailed Block Analysis ===")

        # Get the first block's full HTML
        block = page.locator('.block').first
        block_html = block.inner_html()
        print(f"Block HTML:\n{block_html}\n")

        # Check for block-content
        block_content = block.locator('.block-content')
        print(f"Block content count: {block_content.count()}")

        if block_content.count() > 0:
            content_html = block_content.first.inner_html()
            print(f"Block content HTML:\n{content_html}\n")

        # Check for block-text
        block_text = block.locator('.block-text')
        print(f"Block text count: {block_text.count()}")

        if block_text.count() > 0:
            text_html = block_text.first.inner_html()
            print(f"Block text HTML:\n{text_html}\n")

        # Check for any contenteditable elements
        editable = page.locator('[contenteditable]').all()
        print(f"Found {len(editable)} contenteditable elements")
        for i, el in enumerate(editable):
            tag = el.evaluate('el => el.tagName')
            classes = el.evaluate('el => el.className')
            text = el.inner_text()
            print(f"  {i+1}. <{tag}> class='{classes}' text='{text[:50]}...'")

        # Check for ProseMirror (tiptap)
        prosemirror = page.locator('.ProseMirror').all()
        print(f"\nFound {len(prosemirror)} ProseMirror elements")

        if prosemirror:
            pm_html = prosemirror[0].inner_html()
            print(f"ProseMirror HTML: {pm_html[:200]}...")

        # Check if the editor is disabled or hidden
        print("\n=== Checking Editor State ===")
        editor_info = page.evaluate('''() => {
            const blockContent = document.querySelector('.block-content');
            if (!blockContent) return { found: false };

            const computed = getComputedStyle(blockContent);
            return {
                found: true,
                display: computed.display,
                visibility: computed.visibility,
                opacity: computed.opacity,
                pointerEvents: computed.pointerEvents,
                children: blockContent.children.length,
                innerHTML: blockContent.innerHTML.substring(0, 200)
            };
        }''')
        print(f"Block content state: {editor_info}")

        # Get all text content
        print("\n=== All Block Text ===")
        all_block_text = page.locator('.block').all_inner_texts()
        for i, text in enumerate(all_block_text):
            print(f"Block {i+1}: '{text}'")

        browser.close()
        print("\n✅ Debug completed!")

if __name__ == '__main__':
    debug_block_content()
