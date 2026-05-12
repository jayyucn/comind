"""诊断各类失败"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5175"

def clear_idb(p):
    p.evaluate("""() => {
        indexedDB.databases().then(ds => ds.forEach(db => indexedDB.deleteDatabase(db.name)));
    }""")
    time.sleep(0.2)

def type_blocks(p, names):
    p.locator(".block-content").first.click()
    time.sleep(0.15)
    for i, n in enumerate(names):
        p.keyboard.type(n)
        if i < len(names) - 1:
            p.keyboard.press("Enter")
            time.sleep(0.1)
    p.keyboard.press("Escape")
    time.sleep(0.4)

def dom_order(p):
    return p.evaluate("""() => {
        const items = [];
        function walk(block) {
            const text = block.querySelector('.block-content')?.textContent?.trim();
            if (text) items.push(text);
            const child = block.querySelector('.block-children');
            if (child) child.querySelectorAll(':scope > .block').forEach(walk);
        }
        document.querySelectorAll('.block-list > .block').forEach(walk);
        return items;
    }""")

def db_order(p):
    return p.evaluate("""() => new Promise(r => {
        const req = indexedDB.open('comind');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('blocks')) { r([]); return; }
            const tx = db.transaction('blocks', 'readonly');
            tx.objectStore('blocks').getAll().onsuccess = e => {
                const result = [];
                e.target.result.forEach(b => {
                    result.push({id: b.id, content: b.content, parentId: b.parentId, pos: b.pos});
                });
                r(result);
            };
        };
    })""")

def do_drag(p, from_text, to_text, dy=0):
    src = p.locator(".block").filter(has_text=from_text).locator(".block-bullet")
    dst = p.locator(".block").filter(has_text=to_text)
    box_s = src.bounding_box()
    box_d = dst.bounding_box()
    p.mouse.move(box_s["x"]+box_s["width"]/2, box_s["y"]+box_s["height"]/2)
    p.mouse.down()
    time.sleep(0.05)
    p.mouse.move(box_d["x"]+box_d["width"]/2, box_d["y"]+box_d["height"]/2+dy, steps=10)
    p.mouse.up()
    time.sleep(0.4)

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp("http://localhost:9222")
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    page.goto(BASE, timeout=15000)
    page.wait_for_load_state("networkidle", timeout=15000)
    time.sleep(0.5)

    # === 诊断 S-02: 向下拖拽 ===
    print("=== 诊断 S-02 向下拖拽 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    type_blocks(page, ["A", "B", "C"])

    src = page.locator(".block").filter(has_text="A").locator(".block-bullet")
    dst = page.locator(".block").filter(has_text="C")
    bs = src.bounding_box()
    bd = dst.bounding_box()
    print(f"A bullet: {bs}")
    print(f"C block:   {bd}")

    # 尝试在 C 中心位置（不偏）
    page.mouse.move(bs["x"]+bs["width"]/2, bs["y"]+bs["height"]/2)
    page.mouse.down()
    time.sleep(0.05)
    page.mouse.move(bd["x"]+bd["width"]/2, bd["y"]+bd["height"]/2, steps=10)
    page.mouse.up()
    time.sleep(0.5)
    print(f"拖到 C 中心，DOM: {dom_order(page)}")

    # === 诊断 X-02: 缩进 ===
    print("\n=== 诊断 X-02 缩进 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    type_blocks(page, ["P", "C"])

    # 检查缩进前的结构
    before = page.evaluate("""() => {
        const blocks = document.querySelectorAll('.block');
        const result = [];
        blocks.forEach(b => {
            result.push({
                text: b.querySelector('.block-content')?.textContent?.trim(),
                hasChildren: !!b.querySelector('.block-children'),
                childrenCount: b.querySelectorAll('.block-children > .block').length,
                parentIdAttr: b.getAttribute('data-parent-id'),
            });
        });
        return result;
    }""")
    print(f"缩进前: {before}")

    # 按 Tab
    page.locator(".block").filter(has_text="C").locator(".block-content").click()
    page.keyboard.press("Tab")
    time.sleep(0.5)

    after = page.evaluate("""() => {
        const blocks = document.querySelectorAll('.block');
        const result = [];
        blocks.forEach(b => {
            result.push({
                text: b.querySelector('.block-content')?.textContent?.trim(),
                hasChildren: !!b.querySelector('.block-children'),
                childrenCount: b.querySelectorAll('.block-children > .block').length,
                parentIdAttr: b.getAttribute('data-parent-id'),
            });
        });
        return result;
    }""")
    print(f"缩进后: {after}")

    db = db_order(page)
    print(f"DB 数据: {db}")

    # === 诊断 L-04: DB持久化 ===
    print("\n=== 诊断 L-04 DB持久化 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    type_blocks(page, ["X", "Y"])

    before_db = db_order(page)
    print(f"拖拽前 DB: {[b['content'] for b in before_db]}")

    do_drag(page, "X", "Y", 30)

    dom = dom_order(page)
    after_db = db_order(page)
    print(f"拖拽后 DOM: {dom}")
    print(f"拖拽后 DB: {[b['content'] for b in after_db]}")

    # 检查 blocks store 的实际数据
    store_data = page.evaluate("""() => new Promise(r => {
        const req = indexedDB.open('comind');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('blocks')) { r([]); return; }
            const tx = db.transaction('blocks', 'readonly');
            tx.objectStore('blocks').getAll().onsuccess = e => r(e.target.result.map(b => ({id:b.id, parentId:b.parentId, pos:b.pos})));
        };
    })""")
    print(f"DB pos/id 数据: {store_data}")

    ctx.close()
    browser.close()
    print("\n=== 完成 ===")