from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 800})
    page.goto('http://localhost:5203')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1000)

    # 创建 Parent + 缩进 Child 的层级结构
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('Parent Block')
    page.wait_for_timeout(200)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('Child Block')
    page.wait_for_timeout(200)
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)

    # 截图
    page.screenshot(path='e2e/screenshots/indent_lines_check.png', full_page=True)
    print('Screenshot saved')

    # 检查 indent-line 元素
    indent_lines = page.locator('.indent-line').count()
    print(f'indent-line count: {indent_lines}')

    # 检查 Block indent 区域的 HTML
    second_block = page.locator('.block').nth(1)
    indent_html = second_block.locator('.block-indent').evaluate('el => el.outerHTML')
    print(f'Block indent HTML: {indent_html[:500]}')

    # 检查 indent-line 的计算样式
    if indent_lines > 0:
        line_style = page.locator('.indent-line').first.evaluate("""el => {
            const s = getComputedStyle(el);
            return {
                display: s.display,
                visibility: s.visibility,
                width: s.width,
                height: s.height,
                background: s.background,
                position: s.position,
                left: s.left,
                top: s.top,
                bottom: s.bottom,
                opacity: s.opacity
            }
        }""")
        print(f'indent-line style: {line_style}')
    else:
        print('No indent-line elements found!')

    browser.close()
