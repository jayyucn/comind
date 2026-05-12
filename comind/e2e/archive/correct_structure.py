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
                        content: block.content.slice(0,10).padEnd(10),
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

    # 创建正确结构：
    # test1 (root)
    # ├── test2 (child 1)
    # └── test3 (child 2) ← test2 的兄弟
    #     ├── test4 (grandchild 1)
    #     ├── test5 (grandchild 2)
    #     └── test6 (grandchild 3)

    page.locator('.block-content').first.click()
    page.wait_for_timeout(200)

    # test1 (root)
    page.keyboard.type('test1')
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)

    # test2 (child of test1)
    page.keyboard.type('test2')
    page.keyboard.press('Tab')  # indent to test1
    page.wait_for_timeout(400)

    # test3 (sibling of test2, child of test1)
    page.keyboard.press('Enter')  # create sibling
    page.wait_for_timeout(200)
    page.keyboard.type('test3')
    page.wait_for_timeout(200)

    # 现在 test3 和 test2 是同级（都是 test1 的子节点）
    # 需要让 test3 也缩进到 test1 下
    # 但 Enter 创建的是兄弟，所以 test3 现在是 test2 的兄弟
    # 让我们缩进 test3
    page.keyboard.press('Tab')  # 这会让 test3 成为 test2 的子节点，不是我们要的
    page.wait_for_timeout(400)

    # 反缩进 test3 回到 test1 下
    page.keyboard.press('Shift+Tab')
    page.wait_for_timeout(400)

    # 现在 test3 应该是 test1 的子节点，和 test2 同级
    # 创建 test4 作为 test3 的子节点
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test4')
    page.keyboard.press('Tab')  # indent to test3
    page.wait_for_timeout(400)

    # test5 作为 test3 的子节点
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test5')
    # test5 应该和 test4 同级，Enter 后自动同级
    page.wait_for_timeout(200)

    # test6 作为 test3 的子节点
    page.keyboard.press('Enter')
    page.wait_for_timeout(200)
    page.keyboard.type('test6')
    page.wait_for_timeout(500)

    log_blocks('最终结构')

    page.screenshot(path='e2e/screenshots/correct_tree.png', full_page=True)
    browser.close()
