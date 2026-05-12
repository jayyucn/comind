from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 800, 'height': 600})
    page.goto('http://localhost:5210')
    page.wait_for_load_state('networkidle')
    page.evaluate("""() => new Promise(r => { const req = indexedDB.deleteDatabase('comind-db'); req.onsuccess = () => r('ok'); req.onerror = () => r('err'); })""")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    def log_blocks(name):
        data = page.evaluate("""() => {
            const blocks = []
            document.querySelectorAll('.block').forEach((b, i) => {
                const vue = b.__vueParentComponent
                const block = vue?.props?.block
                const lines = b.querySelectorAll(':scope > .block-row .indent-line').length
                if (block) {
                    blocks.push({
                        content: block.content.slice(0,12).padEnd(12),
                        parentId: block.parentId?.slice(0,8) || 'root    ',
                        left: block.left,
                        lines
                    })
                }
            })
            return blocks
        }""")
        print(f'\n=== {name} ===')
        for b in data:
            print(f'  "{b["content"]}" pid={b["parentId"]} left={b["left"]:3d} lines={b["lines"]}')

    # 创建完整树结构
    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # test1 (root)
    page.keyboard.type('test1')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)

    # test2 (child of test1)
    page.keyboard.type('test2')
    page.keyboard.press('Tab')  # indent
    page.wait_for_timeout(400)

    # test3 (sibling of test2)
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test3')
    page.wait_for_timeout(200)

    # test4, test5, test6 (children of test3)
    for name in ['test4', 'test5', 'test6']:
        page.keyboard.press('Enter')
        page.wait_for_timeout(200)
        page.keyboard.type(name)
        page.keyboard.press('Tab')  # indent to become child of previous
        page.wait_for_timeout(400)

    # 但这会创建阶梯结构，我们需要 test4/5/6 都是 test3 的直接子节点
    # 所以需要反缩进 test5 和 test6

    # 实际上让我重新设计：按 Enter 后 Tab 只缩进一次
    # 让我重新开始

    log_blocks('最终状态')

    page.screenshot(path='e2e/screenshots/final_tree.png', full_page=True)
    browser.close()
