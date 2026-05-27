from playwright.sync_api import sync_playwright

def debug_block_size():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # Navigate to a page
        page_items = page.locator('.page-item')
        if page_items.count() > 0:
            page_items.first.click()
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)

        print("\n=== Block Element Analysis ===")

        block_info = page.evaluate('''() => {
            const block = document.querySelector('.block');
            const blockList = document.querySelector('.block-list');
            const pageBody = document.querySelector('.page-body');

            function getStyles(el) {
                if (!el) return null;
                const s = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return {
                    display: s.display,
                    visibility: s.visibility,
                    opacity: s.opacity,
                    width: s.width,
                    height: s.height,
                    minWidth: s.minWidth,
                    minHeight: s.minHeight,
                    flexBasis: s.flexBasis,
                    flexShrink: s.flexShrink,
                    flexGrow: s.flexGrow,
                    offsetWidth: el.offsetWidth,
                    offsetHeight: el.offsetHeight,
                    rect: {
                        width: rect.width,
                        height: rect.height,
                        top: rect.top,
                        left: rect.left
                    }
                };
            }

            return {
                block: getStyles(block),
                blockList: getStyles(blockList),
                pageBody: getStyles(pageBody),
                pageContainer: getStyles(document.querySelector('.page-container')),
                mainContent: getStyles(document.querySelector('.main-content'))
            };
        }''')

        for name, info in block_info.items():
            if info:
                print(f"\n=== {name} ===")
                print(f"  display: {info['display']}, visibility: {info['visibility']}, opacity: {info['opacity']}")
                print(f"  width: {info['width']}, height: {info['height']}")
                print(f"  minWidth: {info.get('minWidth', 'N/A')}, minHeight: {info.get('minHeight', 'N/A')}")
                print(f"  flexGrow: {info.get('flexGrow', 'N/A')}, flexShrink: {info.get('flexShrink', 'N/A')}")
                print(f"  offsetWidth: {info['offsetWidth']}, offsetHeight: {info['offsetHeight']}")
                print(f"  rect: {info['rect']}")

        # Check the actual HTML structure
        print("\n=== Block HTML Structure ===")
        block_html = page.evaluate('''() => {
            const block = document.querySelector('.block');
            const parent = block?.parentElement;
            const grandparent = parent?.parentElement;

            return {
                blockHTML: block?.outerHTML?.substring(0, 500) || 'not found',
                parentTag: parent?.tagName,
                parentClass: parent?.className,
                parentHTML: parent?.outerHTML?.substring(0, 300) || 'not found',
                grandparentTag: grandparent?.tagName,
                grandparentClass: grandparent?.className
            };
        }''')

        print(f"Block parent: <{block_html['parentTag']}> class='{block_html['parentClass']}'")
        print(f"Block grandparent: <{block_html['grandparentTag']}> class='{block_html['grandparentClass']}'")
        print(f"Parent HTML: {block_html['parentHTML']}")

        # Check if there's CSS limiting width
        print("\n=== All CSS rules affecting .block ===")
        css_rules = page.evaluate('''() => {
            const block = document.querySelector('.block');
            const s = getComputedStyle(block);

            // Check for common width-limiting properties
            return {
                maxWidth: s.maxWidth,
                minWidth: s.minWidth,
                width: s.width,
                flexBasis: s.flexBasis,
                flexShrink: s.flexShrink,
                flexGrow: s.flexGrow,
                gridTemplateColumns: s.gridTemplateColumns,
                gridTemplateRows: s.gridTemplateRows,
                columnGap: s.columnGap,
                position: s.position,
                left: s.left,
                right: s.right,
                top: s.top,
                bottom: s.bottom
            };
        }''')

        for prop, value in css_rules.items():
            print(f"  {prop}: {value}")

        # Take screenshot
        page.screenshot(path='/tmp/block_debug.png', full_page=True)
        print("\nScreenshot saved to /tmp/block_debug.png")

        browser.close()

if __name__ == '__main__':
    debug_block_size()
