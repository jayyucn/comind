from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')

    body_text = page.locator('body').inner_text()
    print("Body text:", repr(body_text[:500]))
    print()

    for sel in ['.block', '.block-content', '.tiptap', '.editor-wrapper', 'div']:
        count = page.locator(sel).count()
        if count > 0:
            print(f"{sel}: {count} found")

    print()
    print("App HTML:")
    html = page.evaluate("document.getElementById('app').innerHTML")
    print(html[:2000])

    browser.close()
