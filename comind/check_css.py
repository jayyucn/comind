from playwright.sync_api import sync_playwright

def check_css_application():
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

        print("\n=== CSS Rules Check ===")

        # Check all CSS rules for the wrapper div
        css_info = page.evaluate('''() => {
            const wrapper = document.querySelector('.block-list > div[data-parent-id]');
            const block = document.querySelector('.block');

            if (!wrapper) return { error: 'wrapper not found' };
            if (!block) return { error: 'block not found' };

            const wrapperStyle = getComputedStyle(wrapper);
            const blockStyle = getComputedStyle(block);

            // Get all CSS rules that match these elements
            const sheets = document.styleSheets;
            const matchingRules = [];

            for (let sheet of sheets) {
                try {
                    for (let rule of sheet.cssRules) {
                        if (rule.selectorText) {
                            const selector = rule.selectorText.toLowerCase();

                            // Check if this rule matches our elements
                            const wrapperMatches = wrapper.matches ? wrapper.matches(selector) : false;
                            const blockMatches = block.matches ? block.matches(selector) : false;

                            if (wrapperMatches || blockMatches) {
                                matchingRules.push({
                                    selector: rule.selectorText,
                                    cssText: rule.cssText.substring(0, 200)
                                });
                            }
                        }
                    }
                } catch (e) {
                    // Ignore cross-origin errors
                }
            }

            return {
                wrapperStyles: {
                    display: wrapperStyle.display,
                    width: wrapperStyle.width,
                    flexBasis: wrapperStyle.flexBasis
                },
                blockStyles: {
                    display: blockStyle.display,
                    width: blockStyle.width,
                    height: blockStyle.height
                },
                matchingRules: matchingRules.slice(0, 20)
            };
        }''')

        print(f"Wrapper styles: {css_info.get('wrapperStyles', css_info.get('error'))}")

        if 'blockStyles' in css_info:
            print(f"Block styles: {css_info['blockStyles']}")

        if css_info.get('matchingRules'):
            print(f"\nMatching CSS rules ({len(css_info['matchingRules'])} found):")
            for rule in css_info['matchingRules'][:10]:
                print(f"  {rule['selector']}")

        browser.close()

if __name__ == '__main__':
    check_css_application()
