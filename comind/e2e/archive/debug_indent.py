from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 500})
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 用 JS 检查 blocks store 的数据
    result = page.evaluate("""() => {
        // 尝试从 Vue 组件获取数据
        const blockEl = document.querySelector('.block')
        if (!blockEl) return 'no .block found'
        
        // 从 __vue__ 获取组件实例
        const app = document.querySelector('#app')?.__vue_app__
        if (!app) return 'no vue app'
        
        // 直接看 pinia store
        // 我们通过检查 DOM 来推断
        const blocks = document.querySelectorAll('.block')
        const info = []
        blocks.forEach((b, i) => {
            const id = b.getAttribute('data-block-id')
            const lines = b.querySelectorAll(':scope > .block-row .indent-line').length
            info.push({i, id: id?.slice(0,8), lines})
        })
        return info
    }""")
    print('DOM check:', result)

    # 也打印 blocks 数据
    data = page.evaluate("""() => {
        // 从 localStorage 或 indexedDB 获取不太方便，
        // 直接用 console.log 看不了，返回 DOM 结构
        const blocks = document.querySelectorAll('.block')
        return Array.from(blocks).map((b, i) => ({
            i,
            id: b.getAttribute('data-block-id'),
            childCount: b.querySelectorAll(':scope > .block-children > .block').length,
            rowLines: b.querySelectorAll(':scope > .block-row .indent-line').length,
            allIndentLines: b.querySelectorAll('.indent-line').length,
        }))
    }""")
    import json
    print(json.dumps(data, indent=2))

    page.screenshot(path='e2e/screenshots/debug_indent.png', full_page=True)
    browser.close()
