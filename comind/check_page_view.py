from playwright.sync_api import sync_playwright

def check_page_view():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # Click on a page in the sidebar
        print("\n=== Clicking on first page ===")
        page_items = page.locator('.page-item').all()
        print(f"Found {len(page_items)} page items in sidebar")

        if page_items:
            # Get the first page title
            first_page = page_items[0]
            page_title = first_page.locator('.page-title').inner_text()
            print(f"Clicking on page: '{page_title}'")

            first_page.click()
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(2000)

            print(f"\nNew URL: {page.url}")

            # Check for page-container
            print("\n=== Checking page-container ===")
            page_container = page.locator('.page-container')
            print(f"Found {page_container.count()} .page-container elements")

            if page_container.count() > 0:
                container_html = page_container.first.inner_html()
                print(f"Page container HTML preview: {container_html[:300]}...")

                # Get computed styles
                styles = page.evaluate('''() => {
                    const el = document.querySelector(".page-container");
                    if (!el) return null;
                    const s = getComputedStyle(el);
                    return {
                        width: s.width,
                        minHeight: s.minHeight
                    };
                }''')
                print(f"Page container styles: {styles}")

            # Check for block
            print("\n=== Checking block ===")
            blocks = page.locator('.block').all()
            print(f"Found {len(blocks)} blocks")

            if blocks:
                block_text = blocks[0].inner_text()
                print(f"First block text: '{block_text}'")

        # Take screenshot of page view
        print("\n=== Taking screenshot ===")
        page.screenshot(path='/tmp/page_view.png', full_page=True)
        print("Saved to /tmp/page_view.png")

        browser.close()
        print("\n✅ Done!")

if __name__ == '__main__':
    check_page_view()
