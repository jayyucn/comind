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

    # 创建 test1 -> test2, test3 -> test4, test5, test6
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('test1')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test2')
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test3')
    # test3 和 test2 同级（Enter 后自动同级）
    page.wait_for_timeout(300)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test4')
    page.keyboard.press('Tab')
    page.wait_for_timeout(300)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test5')
    page.wait_for_timeout(200)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test6')
    page.wait_for_timeout(500)

    # 获取所有 blocks 数据
    data = page.evaluate("""() => {
        const blocks = []
        document.querySelectorAll('.block').forEach((b, i) => {
            const vue = b.__vueParentComponent
            const block = vue?.props?.block
            if (block) {
                blocks.push({
                    i,
                    id: block.id.slice(0,8),
                    parentId: block.parentId?.slice(0,8) || null,
                    left: block.left,
                    content: block.content.slice(0,20)
                })
            }
        })
        return blocks
    }""")
    print(json.dumps(data, indent=2))

    page.screenshot(path='e2e/screenshots/debug_tree.png', full_page=True)
    browser.close()
