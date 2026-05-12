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

    # 通过 Vue API 直接创建 block 树
    result = page.evaluate("""async () => {
        const app = document.querySelector('#app').__vue_app__
        const pinia = app._context.provides.pinia
        const blockStore = pinia._s.get('blocks')
        const editorStore = pinia._s.get('editor')
        const pageStore = pinia._s.get('pages')

        // 获取当前页面 ID
        await pageStore.loadOrCreateDefaultPage()
        const pageId = pageStore.currentPageId
        await blockStore.loadPage(pageId)

        // 清空现有 blocks
        const existing = blockStore.blocks.slice()
        for (const b of existing) {
            // 删除... 可能没有 delete API，用内容清空代替
        }

        // 创建树结构：
        // test1 (root)
        // ├── test2 (child 1)
        // └── test3 (child 2) ← test2 后面有 test3
        //     ├── test4 (grandchild 1)
        //     ├── test5 (grandchild 2)
        //     └── test6 (grandchild 3)

        // Step 1: 更新第一个 block 为 test1
        const rootBlock = blockStore.blocks[0]
        rootBlock.content = 'test1'
        await blockStore.updateBlockContent(rootBlock.id, 'test1')

        // Step 2: 创建 test2 作为 test1 的子节点
        const test2 = await blockStore.createBlock({
            pageId,
            content: 'test2',
            parentId: rootBlock.id
        })

        // Step 3: 创建 test3 作为 test1 的子节点（test2 的兄弟）
        const test3 = await blockStore.createBlock({
            pageId,
            content: 'test3',
            parentId: rootBlock.id
        })

        // Step 4: 创建 test4 作为 test3 的子节点
        const test4 = await blockStore.createBlock({
            pageId,
            content: 'test4',
            parentId: test3.id
        })

        // Step 5: 创建 test5 作为 test3 的子节点
        const test5 = await blockStore.createBlock({
            pageId,
            content: 'test5',
            parentId: test3.id
        })

        // Step 6: 创建 test6 作为 test3 的子节点
        const test6 = await blockStore.createBlock({
            pageId,
            content: 'test6',
            parentId: test3.id
        })

        return {
            root: { id: rootBlock.id.slice(0,8), left: rootBlock.left },
            test2: { id: test2.id.slice(0,8), left: test2.left, parentId: test2.parentId?.slice(0,8) },
            test3: { id: test3.id.slice(0,8), left: test3.left, parentId: test3.parentId?.slice(0,8) },
            test4: { id: test4.id.slice(0,8), left: test4.left, parentId: test4.parentId?.slice(0,8) },
            test5: { id: test5.id.slice(0,8), left: test5.left, parentId: test5.parentId?.slice(0,8) },
            test6: { id: test6.id.slice(0,8), left: test6.left, parentId: test6.parentId?.slice(0,8) },
        }
    }""")

    print('Created blocks:')
    print(json.dumps(result, indent=2))

    page.wait_for_timeout(500)

    # 获取层级线数据
    lines_data = page.evaluate("""() => {
        const blocks = []
        document.querySelectorAll('.block').forEach((b, i) => {
            const vue = b.__vueParentComponent
            const block = vue?.props?.block
            const lines = b.querySelectorAll(':scope > .block-row .indent-line').length
            if (block) {
                blocks.push({
                    i,
                    content: block.content.slice(0,15),
                    left: block.left,
                    lines
                })
            }
        })
        return blocks
    }""")
    print('\nIndent lines:')
    print(json.dumps(lines_data, indent=2))

    page.screenshot(path='e2e/screenshots/api_created_tree.png', full_page=True)
    browser.close()
