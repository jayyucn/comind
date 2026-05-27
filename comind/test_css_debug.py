from playwright.sync_api import sync_playwright
import os

def test_css_and_debug():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Capture console logs
        console_logs = []
        console_errors = []

        def handle_console(msg):
            if msg.type == 'error':
                console_errors.append(f"[ERROR] {msg.text}")
            else:
                console_logs.append(f"[{msg.type.upper()}] {msg.text}")

        page.on('console', handle_console)

        # Navigate to the app
        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')

        # Take a full page screenshot
        print("Taking screenshot...")
        screenshot_path = '/tmp/app_screenshot.png'
        page.screenshot(path=screenshot_path, full_page=True)
        print(f"Screenshot saved to {screenshot_path}")

        # Get page title
        title = page.title()
        print(f"Page title: {title}")

        # Check for any error messages on the page
        error_elements = page.locator('text=/error|exception|failed/i').all()
        if error_elements:
            print(f"\n⚠️ Found {len(error_elements)} potential error elements on page")

        # Check CSS variables are loaded
        print("\n=== Checking CSS Variables ===")
        css_vars = page.evaluate('''() => {
            const root = document.documentElement;
            const vars = {
                'font-sans': getComputedStyle(root).getPropertyValue('--font-sans'),
                'text-base': getComputedStyle(root).getPropertyValue('--text-base'),
                'bg-base': getComputedStyle(root).getPropertyValue('--bg-base'),
                'accent': getComputedStyle(root).getPropertyValue('--accent'),
            };
            return vars;
        }''')
        for name, value in css_vars.items():
            print(f"  --{name}: {value.strip()}")

        # Check body styles
        print("\n=== Checking Body Styles ===")
        body_styles = page.evaluate('''() => {
            const body = document.body;
            const computed = getComputedStyle(body);
            return {
                'fontFamily': computed.fontFamily,
                'fontSize': computed.fontSize,
                'backgroundColor': computed.backgroundColor,
                'color': computed.color,
            };
        }''')
        for name, value in body_styles.items():
            print(f"  {name}: {value}")

        # Check for .block elements
        print("\n=== Checking Block Elements ===")
        blocks = page.locator('.block').all()
        print(f"Found {len(blocks)} .block elements")

        if blocks:
            # Check first block styles
            first_block = blocks[0]
            block_html = first_block.inner_html()
            print(f"First block HTML length: {len(block_html)} chars")
            print(f"First block HTML preview: {block_html[:200]}...")

            # Check if block has content
            block_text = first_block.inner_text()
            print(f"First block text: '{block_text}'")

            # Check block children
            block_children = first_block.locator('.block-children').all()
            print(f"First block has {len(block_children)} .block-children elements")

            # Check bullet elements
            bullets = first_block.locator('.bullet-dot, .bullet-chevron').all()
            print(f"First block has {len(bullets)} bullet elements")

            # Check tiptap content
            tiptap = first_block.locator('.tiptap').all()
            print(f"First block has {len(tiptap)} .tiptap elements")
            if tiptap:
                tip_html = tiptap[0].inner_html()
                print(f"Tiptap HTML: {tip_html[:100]}...")

        # Check sidebar
        print("\n=== Checking Sidebar ===")
        sidebar = page.locator('.sidebar').first
        if sidebar.count() > 0:
            print("Sidebar found")
            sidebar_items = page.locator('.sidebar-item').all()
            print(f"Sidebar has {len(sidebar_items)} items")
        else:
            print("⚠️ Sidebar not found!")

        # Print console errors
        if console_errors:
            print("\n=== Console Errors ===")
            for err in console_errors[:10]:
                print(f"  {err}")
            if len(console_errors) > 10:
                print(f"  ... and {len(console_errors) - 10} more errors")

        if console_logs:
            print("\n=== Console Logs (first 10) ===")
            for log in console_logs[:10]:
                print(f"  {log}")

        # Check for visible text content
        print("\n=== Page Content Analysis ===")
        all_text = page.inner_text('body')
        print(f"Total body text length: {len(all_text)} chars")
        print(f"Body text preview: {all_text[:300]}...")

        browser.close()
        print("\n✅ Test completed!")

if __name__ == '__main__':
    test_css_and_debug()
