from playwright.sync_api import sync_playwright

def check_routing():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        # Check URL
        print(f"\nCurrent URL: {page.url}")

        # Check main content
        print("\n=== Main Content Area ===")
        main_content = page.locator('.main-content')
        if main_content.count() > 0:
            main_html = main_content.first.inner_html()
            print(f"Main content HTML length: {len(main_html)}")
            print(f"Main content preview: {main_html[:500]}...")

        # Check page-scroll-wrapper content
        print("\n=== Page Scroll Wrapper ===")
        wrapper = page.locator('.page-scroll-wrapper')
        if wrapper.count() > 0:
            wrapper_html = wrapper.first.inner_html()
            print(f"Wrapper HTML length: {len(wrapper_html)}")
            print(f"Wrapper preview: {wrapper_html[:500]}...")

        # Check for any page body
        print("\n=== Looking for page content ===")
        page_body = page.locator('.page-body')
        print(f"Found {page_body.count()} .page-body elements")

        # Check if there's a journal component
        journal = page.locator('.journal-hero')
        print(f"Found {journal.count()} .journal-hero elements")

        # Check the app layout structure
        print("\n=== App Layout Structure ===")
        app_layout = page.locator('.app-layout')
        if app_layout.count() > 0:
            layout_html = app_layout.first.inner_html()
            print(f"App layout children count: {app_layout.first.evaluate('el => el.children.length')}")

            # Get children
            children = app_layout.first.evaluate('''() => {
                return Array.from(document.querySelector('.app-layout').children).map(el => ({
                    tag: el.tagName,
                    class: el.className,
                    children: el.children.length
                }));
            }''')
            for child in children:
                print(f"  <{child['tag']}> class='{child['class']}' has {child['children']} children")

        browser.close()
        print("\n✅ Done!")

if __name__ == '__main__':
    check_routing()
