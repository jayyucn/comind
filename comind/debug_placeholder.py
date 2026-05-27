from playwright.sync_api import sync_playwright

def debug_placeholder_issue():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # Use non-headless to see user's view
        page = browser.new_page()

        # Capture console messages
        console_messages = []
        page.on('console', lambda msg: console_messages.append(f"[{msg.type}] {msg.text}"))

        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        # Click on a page
        print("\n=== Clicking on a page ===")
        page_items = page.locator('.page-item').all()
        print(f"Found {len(page_items)} pages")

        if page_items:
            # Click on first page
            first_page = page_items[0]
            page_title = first_page.locator('.page-title').inner_text()
            print(f"Clicking: '{page_title}'")
            first_page.click()
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(3000)

        # Take screenshot to see current view
        print("\n=== Taking screenshot ===")
        page.screenshot(path='/tmp/debug_placeholder.png', full_page=True)
        print("Saved to /tmp/debug_placeholder.png")

        # Check for blocks
        print("\n=== Checking blocks ===")
        blocks = page.locator('.block').all()
        print(f"Found {len(blocks)} .block elements")

        # Check for block-text and placeholder
        print("\n=== Checking block text and placeholder ===")
        block_texts = page.locator('.block-text').all()
        print(f"Found {len(block_texts)} .block-text elements")

        placeholders = page.locator('.block-placeholder').all()
        print(f"Found {len(placeholders)} .block-placeholder elements")

        for i, p in enumerate(placeholders):
            text = p.inner_text()
            visible = p.is_visible()
            print(f"  Placeholder {i+1}: '{text}', visible={visible}")

        # Check computed styles of placeholder
        print("\n=== Placeholder styles ===")
        placeholder_styles = page.evaluate('''() => {
            const p = document.querySelector('.block-placeholder');
            if (!p) return null;
            const s = getComputedStyle(p);
            const parent = p.parentElement;
            const parentS = getComputedStyle(parent);
            return {
                placeholder: {
                    display: s.display,
                    visibility: s.visibility,
                    opacity: s.opacity,
                    color: s.color,
                    fontStyle: s.fontStyle,
                    width: s.width,
                    height: s.height
                },
                parent: {
                    display: parentS.display,
                    minHeight: parentS.minHeight,
                    content: parent.innerHTML.substring(0, 100)
                }
            };
        }''')
        if placeholder_styles:
            print(f"Placeholder styles: {placeholder_styles['placeholder']}")
            print(f"Parent styles: {placeholder_styles['parent']}")

        # Check if block content is empty
        print("\n=== Checking block content ===")
        block_content = page.evaluate('''() => {
            const block = document.querySelector('.block');
            if (!block) return null;

            const blockContent = block.querySelector('.block-content');
            const blockText = block.querySelector('.block-text');

            return {
                blockHTML: block.innerHTML.substring(0, 500),
                blockContentHTML: blockContent?.innerHTML || 'not found',
                blockTextHTML: blockText?.innerHTML || 'not found',
                blockTextInnerText: blockText?.innerText || 'not found'
            };
        }''')

        if block_content:
            print(f"Block HTML: {block_content['blockHTML']}")
            print(f"Block content HTML: {block_content['blockContentHTML']}")
            print(f"Block text HTML: {block_content['blockTextHTML']}")
            print(f"Block text inner text: '{block_content['blockTextInnerText']}'")

        # Check for any page content at all
        print("\n=== Checking page structure ===")
        page_info = page.evaluate('''() => {
            const pageContainer = document.querySelector('.page-container');
            const pageBody = document.querySelector('.page-body');
            const blockList = document.querySelector('.block-list');

            return {
                pageContainer: pageContainer ? 'found' : 'not found',
                pageBody: pageBody ? 'found' : 'not found',
                blockList: blockList ? 'found' : 'not found',
                pageBodyHTML: pageBody?.innerHTML?.substring(0, 500) || 'not found',
                blockListHTML: blockList?.innerHTML?.substring(0, 500) || 'not found'
            };
        }''')

        print(f"Page container: {page_info['pageContainer']}")
        print(f"Page body: {page_info['pageBody']}")
        print(f"Block list: {page_info['blockList']}")
        print(f"Page body HTML: {page_info['pageBodyHTML']}")
        print(f"Block list HTML: {page_info['blockListHTML']}")

        # Print console messages
        if console_messages:
            print("\n=== Console Messages ===")
            for msg in console_messages[:20]:
                print(f"  {msg}")

        browser.close()
        print("\n✅ Debug complete!")

if __name__ == '__main__':
    debug_placeholder_issue()
