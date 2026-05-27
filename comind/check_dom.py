from playwright.sync_api import sync_playwright

def check_dom_structure():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Navigating to http://localhost:5178...")
        page.goto('http://localhost:5178')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(2000)

        # Get full DOM structure
        print("\n=== DOM Structure ===")

        # Find all elements with classes
        elements = page.evaluate('''() => {
            const elements = [];
            const seen = new Set();

            // Find all elements with class attribute
            document.querySelectorAll('*').forEach(el => {
                if (el.className && typeof el.className === 'string' && el.className.trim()) {
                    const key = el.className;
                    if (!seen.has(key)) {
                        seen.add(key);
                        elements.push({
                            tag: el.tagName,
                            class: el.className,
                            id: el.id || null,
                            text: el.innerText?.substring(0, 50) || ''
                        });
                    }
                }
            });

            return elements;
        }''')

        print(f"Found {len(elements)} unique elements with classes")
        for el in elements[:30]:
            print(f"  <{el['tag']}> class='{el['class']}' id='{el['id']}'")

        # Check for page-container specifically
        print("\n=== Checking page-container ===")
        page_container = page.locator('.page-container')
        print(f"Found {page_container.count()} .page-container elements")

        if page_container.count() == 0:
            # Check what elements are inside the router view
            print("\n=== Router View Contents ===")
            router_view = page.locator('router-view')
            print(f"Router view elements: {router_view.count()}")

            # Check for page component
            print("\n=== Page Component ===")
            page_component = page.locator('[class*="page"]').all()
            print(f"Elements with 'page' in class: {len(page_component)}")
            for el in page_component[:5]:
                print(f"  <{el.evaluate('el => el.tagName')}> class='{el.evaluate('el => el.className')}'")

        browser.close()
        print("\n✅ Done!")

if __name__ == '__main__':
    check_dom_structure()
