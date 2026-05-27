from playwright.sync_api import sync_playwright

def take_final_screenshot():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

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

        # Take full page screenshot
        print("Taking screenshot...")
        page.screenshot(path='/tmp/final_screenshot.png', full_page=True)
        print("Saved to /tmp/final_screenshot.png")

        # Check if placeholder is visible
        placeholder = page.locator('.block-placeholder')
        print(f"\nPlaceholder visible: {placeholder.is_visible()}")

        if placeholder.count() > 0:
            print(f"Placeholder text: '{placeholder.first.inner_text()}'")

        browser.close()
        print("\n✅ Done!")

if __name__ == '__main__':
    take_final_screenshot()
