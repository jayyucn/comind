"""综合诊断 - 拖拽、缩进、循环检测"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5175"

def clear_idb(p):
    p.evaluate("""() => {
        indexedDB.databases().then(ds => ds.forEach(db => indexedDB.deleteDatabase(db.name)));
    }""")
    time.sleep(0.2)

def dom_blocks(p):
    """返回 DOM 中所有 block 的文本（平铺）"""
    return p.evaluate("""() => {
        const items = [];
        function walk(els) {
            els.forEach(el => {
                const text = el.querySelector('.block-content')?.textContent?.trim();
                if (text) items.push(text);
                const child = el.querySelector('.block-children:not([style*="max-height: 0"])');
                if (child) walk(Array.from(child.querySelectorAll(':scope > .block')));
            });
        }
        walk(Array.from(document.querySelectorAll('.block-list > .block')));
        return items;
    }""")

def db_all(p):
    return p.evaluate("""() => new Promise(r => {
        const req = indexedDB.open('comind');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('blocks')) { r([]); return; }
            const tx = db.transaction('blocks', 'readonly');
            tx.objectStore('blocks').getAll().onsuccess = e =>
                r(e.target.result.map(b => ({id: b.id, content: b.content, parentId: b.parentId, pos: b.pos})));
        };
    })""")

def do_drag(p, from_text, to_text, dy=0):
    src = p.locator(".block").filter(has_text=from_text).locator(".block-bullet")
    dst = p.locator(".block").filter(has_text=to_text)
    b1 = src.bounding_box()
    b2 = dst.bounding_box()
    p.mouse.move(b1["x"]+b1["width"]/2, b1["y"]+b1["height"]/2)
    p.mouse.down()
    time.sleep(0.08)
    p.mouse.move(b2["x"]+b2["width"]/2, b2["y"]+b2["height"]/2+dy, steps=12)
    p.mouse.up()
    time.sleep(0.5)

def indent_block(p, text):
    p.locator(".block").filter(has_text=text).locator(".block-content").click()
    time.sleep(0.1)
    p.keyboard.press("Tab")
    time.sleep(0.5)

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp("http://localhost:9222")
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()

    page.goto(BASE, timeout=15000)
    page.wait_for_load_state("networkidle", timeout=15000)
    time.sleep(0.8)

    # ── D1: 向下拖拽精确诊断 ──────────────────────────────
    print("=== D1: 向下拖拽精确诊断 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)

    # 用 4 个块做诊断
    def create4(p, names):
        p.locator(".block-content").first.click()
        time.sleep(0.15)
        for i, n in enumerate(names):
            p.keyboard.type(n)
            if i < len(names) - 1:
                p.keyboard.press("Enter")
                time.sleep(0.1)
        p.keyboard.press("Escape")
        time.sleep(0.5)

    create4(page, ["A", "B", "C", "D"])
    print(f"初始顺序: {dom_blocks(page)}")

    # 拖 A 到 D 下方
    dst_block = page.locator(".block").filter(has_text="D")
    b_src = page.locator(".block").filter(has_text="A").locator(".block-bullet").bounding_box()
    b_dst = dst_block.bounding_box()

    print(f"A bullet y={b_src['y']:.0f}, D block center y={b_dst['y']+b_dst['height']/2:.0f}")
    print(f"D block height={b_dst['height']}, bottom={b_dst['y']+b_dst['height']:.0f}")

    page.mouse.move(b_src["x"]+b_src["width"]/2, b_src["y"]+b_src["height"]/2)
    page.mouse.down()
    time.sleep(0.08)
    # 拖到 D 块中心以下
    page.mouse.move(b_dst["x"]+b_dst["width"]/2, b_dst["y"]+b_dst["height"]+20, steps=12)
    page.mouse.up()
    time.sleep(0.6)
    print(f"拖 A 到 D 下方后: {dom_blocks(page)}")

    # 也测一下拖到 D 块内部的中心
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    create4(page, ["A", "B", "C", "D"])
    page.mouse.move(b_src["x"]+b_src["width"]/2, b_src["y"]+b_src["height"]/2)
    page.mouse.down()
    time.sleep(0.08)
    # 拖到 D 块的中心
    page.mouse.move(b_dst["x"]+b_dst["width"]/2, b_dst["y"]+b_dst["height"]/2, steps=12)
    page.mouse.up()
    time.sleep(0.6)
    print(f"拖 A 到 D 中心后: {dom_blocks(page)}")

    # ── D2: 缩进子节点 DOM 检测 ─────────────────────────
    print("\n=== D2: 缩进子节点 DOM 检测 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    type_blocks_fn = lambda p, names: (
        p.locator(".block-content").first.click(),
        [p.keyboard.type(n) or (p.keyboard.press("Enter") if i < len(names)-1 else None)
         for i, n in enumerate(names)],
        p.keyboard.press("Escape"),
        time.sleep(0.5)
    )[1]
    page.locator(".block-content").first.click()
    time.sleep(0.15)
    page.keyboard.type("Parent")
    page.keyboard.press("Enter")
    time.sleep(0.1)
    page.keyboard.type("Child")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # 检查缩进前
    before_info = page.evaluate("""() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(b => ({
            text: b.querySelector('.block-content')?.textContent?.trim(),
            hasChildrenEl: !!b.querySelector(':scope > .block-children'),
            parentAttr: b.getAttribute('data-parent-id'),
        }));
    }""")
    print(f"缩进前: {before_info}")

    # 缩进
    indent_block(page, "Child")
    time.sleep(0.3)

    # 检查缩进后
    after_info = page.evaluate("""() => {
        const blocks = document.querySelectorAll('.block');
        return Array.from(blocks).map(b => ({
            text: b.querySelector('.block-content')?.textContent?.trim(),
            hasChildrenEl: !!b.querySelector(':scope > .block-children'),
            parentAttr: b.getAttribute('data-parent-id'),
        }));
    }""")
    print(f"缩进后: {after_info}")

    # Block 组件是否正确渲染
    parent_children = page.locator(".block").filter(has_text="Parent").locator("").count()
    print(f"Parent 下的子块数: {page.locator('.block:has(.block-content:text(\"Parent\")) .block-children > .block').count()}")

    # 使用更可靠的 locator
    try:
        pc = page.locator(".block:has(.block-content:text-is('Parent')) .block-children").first
        has_ch = pc.is_visible()
        print(f"Parent.block-children visible: {has_ch}")
        if has_ch:
            child_count = page.locator(".block:has(.block-content:text-is('Parent')) .block-children").locator("> .block").count()
            print(f"Parent.block-children > .block count: {child_count}")
    except Exception as e:
        print(f"检测失败: {e}")

    # ── D3: 循环检测（父子树建立后，父不能入子） ─────────
    print("\n=== D3: 循环检测 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    page.locator(".block-content").first.click()
    time.sleep(0.15)
    page.keyboard.type("P")
    page.keyboard.press("Enter")
    time.sleep(0.1)
    page.keyboard.type("C")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    # C 缩进成 P 的子节点
    indent_block(page, "C")
    time.sleep(0.3)

    db_before = db_all(page)
    print(f"缩进后 DB: {db_before}")

    # 尝试拖 P 到 C（循环检测应该阻止）
    do_drag(page, "P", "C", 30)
    time.sleep(0.5)

    dom_after = dom_blocks(page)
    db_after = db_all(page)
    print(f"拖拽后 DOM: {dom_after}")
    print(f"拖拽后 DB: {db_after}")

    P_after = next((b for b in db_after if b["content"] == "P"), None)
    print(f"P 拖后 parentId: {P_after['parentId'] if P_after else 'N/A'}")

    # ── D4: L-04 诊断（拖拽后 DB 未更新） ───────────────
    print("\n=== D4: DB 持久化诊断 ===")
    clear_idb(page)
    page.reload()
    time.sleep(0.6)
    page.locator(".block-content").first.click()
    time.sleep(0.15)
    page.keyboard.type("X")
    page.keyboard.press("Enter")
    time.sleep(0.1)
    page.keyboard.type("Y")
    page.keyboard.press("Escape")
    time.sleep(0.5)

    db_before = db_all(page)
    print(f"拖前 DB: {[b['content'] for b in db_before]}")

    do_drag(page, "X", "Y", 30)
    time.sleep(0.5)

    dom_after = dom_blocks(page)
    db_after = db_all(page)
    print(f"拖后 DOM: {dom_after}")
    print(f"拖后 DB content: {[b['content'] for b in db_after]}")
    print(f"拖后 DB pos:    {[(b['content'], b['pos']) for b in db_after]}")

    # 更长的等待
    time.sleep(2)
    db_late = db_all(page)
    print(f"延迟 2s 后 DB: {[(b['content'], b['pos']) for b in db_late]}")

    ctx.close()
    browser.close()
    print("\n=== 完成 ===")