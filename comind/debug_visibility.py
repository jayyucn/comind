from playwright.sync_api import sync_playwright

def debug_visibility():
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

        # Detailed visibility check
        print("\n=== Detailed Visibility Analysis ===")

        visibility_info = page.evaluate('''() => {
            const placeholder = document.querySelector('.block-placeholder');
            const blockText = document.querySelector('.block-text');
            const blockContent = document.querySelector('.block-content');
            const blockInner = document.querySelector('.block-inner');
            const blockRow = document.querySelector('.block-row');

            function getStyles(el) {
                if (!el) return null;
                const s = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return {
                    // Layout
                    display: s.display,
                    visibility: s.visibility,
                    opacity: s.opacity,
                    width: s.width,
                    height: s.height,
                    // Position
                    position: s.position,
                    top: s.top,
                    left: s.left,
                    // Size
                    offsetWidth: el.offsetWidth,
                    offsetHeight: el.offsetHeight,
                    clientWidth: el.clientWidth,
                    clientHeight: el.clientHeight,
                    // Rect
                    rect: {
                        top: rect.top,
                        left: rect.left,
                        width: rect.width,
                        height: rect.height,
                        bottom: rect.bottom,
                        right: rect.right
                    },
                    // Visibility checks
                    boundingClientRect: rect.width > 0 && rect.height > 0,
                    // Clip/overflow
                    overflow: s.overflow,
                    overflowX: s.overflowX,
                    overflowY: s.overflowY,
                    clipPath: s.clipPath,
                    clip: s.clip,
                    // Content
                    content: el.innerHTML?.substring(0, 100)
                };
            }

            return {
                placeholder: getStyles(placeholder),
                blockText: getStyles(blockText),
                blockContent: getStyles(blockContent),
                blockInner: getStyles(blockInner),
                blockRow: getStyles(blockRow)
            };
        }''')

        print("\n=== Block Row ===")
        if visibility_info.get('blockRow'):
            r = visibility_info['blockRow']
            print(f"  display: {r['display']}, visibility: {r['visibility']}, opacity: {r['opacity']}")
            print(f"  width: {r['width']}, height: {r['height']}")
            print(f"  offsetWidth: {r['offsetWidth']}, offsetHeight: {r['offsetHeight']}")
            print(f"  rect: {r['rect']}")

        print("\n=== Block Inner ===")
        if visibility_info.get('blockInner'):
            i = visibility_info['blockInner']
            print(f"  display: {i['display']}, visibility: {i['visibility']}, opacity: {i['opacity']}")
            print(f"  width: {i['width']}, height: {i['height']}")
            print(f"  offsetWidth: {i['offsetWidth']}, offsetHeight: {i['offsetHeight']}")
            print(f"  rect: {i['rect']}")

        print("\n=== Block Content ===")
        if visibility_info.get('blockContent'):
            c = visibility_info['blockContent']
            print(f"  display: {c['display']}, visibility: {c['visibility']}, opacity: {c['opacity']}")
            print(f"  width: {c['width']}, height: {c['height']}")
            print(f"  offsetWidth: {c['offsetWidth']}, offsetHeight: {c['offsetHeight']}")
            print(f"  rect: {c['rect']}")

        print("\n=== Block Text ===")
        if visibility_info.get('blockText'):
            t = visibility_info['blockText']
            print(f"  display: {t['display']}, visibility: {t['visibility']}, opacity: {t['opacity']}")
            print(f"  width: {t['width']}, height: {t['height']}")
            print(f"  offsetWidth: {t['offsetWidth']}, offsetHeight: {t['offsetHeight']}")
            print(f"  rect: {t['rect']}")

        print("\n=== Placeholder ===")
        if visibility_info.get('placeholder'):
            ph = visibility_info['placeholder']
            print(f"  display: {ph['display']}, visibility: {ph['visibility']}, opacity: {ph['opacity']}")
            print(f"  width: {ph['width']}, height: {ph['height']}")
            print(f"  offsetWidth: {ph['offsetWidth']}, offsetHeight: {ph['offsetHeight']}")
            print(f"  rect: {ph['rect']}")

        # Check if Playwright's is_visible check is different
        print("\n=== Playwright Visibility Check ===")
        placeholder = page.locator('.block-placeholder').first
        block_text = page.locator('.block-text').first

        print(f"Placeholder visible: {placeholder.is_visible()}")
        print(f"Block text visible: {block_text.is_visible()}")

        # Check bounding box
        print("\n=== Bounding Box ===")
        if placeholder.count() > 0:
            bbox = placeholder.first.bounding_box()
            print(f"Placeholder bounding_box: {bbox}")

        browser.close()
        print("\n✅ Done!")

if __name__ == '__main__':
    debug_visibility()
