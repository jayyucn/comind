from playwright.sync_api import sync_playwright

def take_screenshots():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})

        # Navigate to the app
        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # Take full page screenshot
        print("Taking full page screenshot...")
        page.screenshot(path='/tmp/full_page.png', full_page=True)
        print("Saved to /tmp/full_page.png")

        # Take screenshot of main content area
        main_content = page.locator('.main-content')
        if main_content.count() > 0:
            main_content.screenshot(path='/tmp/main_content.png')
            print("Saved main content to /tmp/main_content.png")

        # Take screenshot of sidebar
        sidebar = page.locator('.sidebar')
        if sidebar.count() > 0:
            sidebar.screenshot(path='/tmp/sidebar.png')
            print("Saved sidebar to /tmp/sidebar.png")

        # Check computed styles of key elements
        print("\n=== Computed Styles ===")

        # Check body
        body_styles = page.evaluate('''() => {
            const body = document.body;
            const s = getComputedStyle(body);
            return {
                fontFamily: s.fontFamily,
                fontSize: s.fontSize,
                backgroundColor: s.backgroundColor,
                color: s.color,
                lineHeight: s.lineHeight
            };
        }''')
        print(f"Body: {body_styles}")

        # Check page container
        page_styles = page.evaluate('''() => {
            const el = document.querySelector(".page-container");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                display: s.display,
                maxWidth: s.maxWidth,
                padding: s.padding
            };
        }''')
        print(f"Page container: {page_styles}")

        # Check page body
        page_body = page.evaluate('''() => {
            const el = document.querySelector(".page-body");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                display: s.display,
                gap: s.gap,
                paddingBottom: s.paddingBottom
            };
        }''')
        print(f"Page body: {page_body}")

        # Check main content
        main_styles = page.evaluate('''() => {
            const el = document.querySelector(".main-content");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                maxWidth: s.maxWidth,
                minHeight: s.minHeight
            };
        }''')
        print(f"Main content: {main_styles}")

        # Check sidebar
        sidebar_styles = page.evaluate('''() => {
            const el = document.querySelector(".sidebar");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                width: s.width,
                backgroundColor: s.backgroundColor,
                borderRight: s.borderRight
            };
        }''')
        print(f"Sidebar: {sidebar_styles}")

        # Check block
        block_styles = page.evaluate('''() => {
            const el = document.querySelector(".block");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                position: s.position,
                userSelect: s.userSelect
            };
        }''')
        print(f"Block: {block_styles}")

        # Check block text
        block_text_styles = page.evaluate('''() => {
            const el = document.querySelector(".block-text");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                display: s.display,
                minHeight: s.minHeight,
                padding: s.padding,
                borderRadius: s.borderRadius,
                whiteSpace: s.whiteSpace,
                wordBreak: s.wordBreak
            };
        }''')
        print(f"Block text: {block_text_styles}")

        # Check bullet dot
        bullet_styles = page.evaluate('''() => {
            const el = document.querySelector(".bullet-dot");
            if (!el) return "Not found";
            const s = getComputedStyle(el);
            return {
                width: s.width,
                height: s.height,
                borderRadius: s.borderRadius,
                backgroundColor: s.backgroundColor,
                opacity: s.opacity
            };
        }''')
        print(f"Bullet dot: {bullet_styles}")

        browser.close()
        print("\n✅ Screenshots taken!")

if __name__ == '__main__':
    take_screenshots()
