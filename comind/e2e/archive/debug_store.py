from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 500})
    
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.evaluate("""() => new Promise(r => { const req = indexedDB.deleteDatabase('comind-db'); req.onsuccess = () => r('ok'); req.onerror = () => r('err'); })""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2000)

    # 创建简单嵌套: Root -> Child
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('Root')
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    page.keyboard.type('Child')
    page.keyboard.press('Tab')
    page.wait_for_timeout(600)

    # 从 Vue app 获取 pinia blocks store 数据
    data = page.evaluate("""() => {
        const app = document.querySelector('#app').__vue_app__
        // 无法直接访问 pinia store，通过全局变量暴露
        // 改用 DOM data 属性
        const blocks = document.querySelectorAll('.block')
        return Array.from(blocks).map((b, i) => {
            const vue = b.__vueParentComponent
            const props = vue?.props
            const block = props?.block
            return {
                i,
                id: block?.id?.slice(0,8),
                parentId: block?.parentId?.slice(0,8),
                left: block?.left,
                pageId: block?.pageId?.slice(0,8),
                rowLines: b.querySelectorAll(':scope > .block-row .indent-line').length,
            }
        })
    }""")
    print(json.dumps(data, indent=2))

    # 也获取完整的 blocks 列表（通过 window 暴露）
    all_data = page.evaluate("""() => {
        // 尝试从 __VUE_PINIA__ 或类似方式获取
        return typeof __PINIA__ !== 'undefined' ? 'found' : 'not found'
    }""")
    print('Pinia access:', all_data)

    page.screenshot(path='e2e/screenshots/debug_simple.png', full_page=True)
    browser.close()
