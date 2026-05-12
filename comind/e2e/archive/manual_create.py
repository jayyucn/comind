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

    # 手动创建树结构并检查 left 值是否正确更新
    def log_blocks(name):
        data = page.evaluate("""() => {
            const blocks = []
            document.querySelectorAll('.block').forEach((b, i) => {
                const vue = b.__vueParentComponent
                const block = vue?.props?.block
                const lines = b.querySelectorAll(':scope > .block-row .indent-line').length
                if (block) {
                    blocks.push({
                        i,
                        content: block.content.slice(0,15),
                        parentId: block.parentId?.slice(0,8) || null,
                        left: block.left,
                        lines
                    })
                }
            })
            return blocks
        }""")
        print(f'\n=== {name} ===')
        for b in data:
            print(f'  [{b["i"]}] "{b["content"]}" parentId={b["parentId"]} left={b["left"]} lines={b["lines"]}')

    log_blocks('初始状态')

    # 创建 test1
    page.locator('.block-content').first.click()
    page.wait_for_timeout(300)
    page.keyboard.type('test1')
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    log_blocks('Enter 后')

    # 输入 test2 并 Tab 缩进
    page.keyboard.type('test2')
    page.keyboard.press('Tab')
    page.wait_for_timeout(500)
    log_blocks('Tab 后')

    # Enter 创建新 block
    page.keyboard.press('Enter')
    page.wait_for_timeout(400)
    log_blocks('Enter 2')

    # 输入 test3（应该和 test2 同级）
    page.keyboard.type('test3')
    page.wait_for_timeout(300)
    log_blocks('输入 test3')

    # 缩进 test3 到更深层？不，Tab 会让 test3 缩进成 test2 的子节点
    # 但我们想要结构是 test1 -> test2, test3
    # 问题：Enter 后 Tab 会让新 block 缩进成上一个 block 的子节点
    # 需要先确认当前行为

    page.screenshot(path='e2e/screenshots/manual_tree.png', full_page=True)
    browser.close()
