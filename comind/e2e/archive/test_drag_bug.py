"""
复现拖拽位置 bug: 拖 1 到 3 下面，结果在 2 和 3 之间
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright


def test_bug():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, slow_mo=300)
        page = browser.new_page()
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1000)

        # 创建 3 个同级 block
        page.locator('.block-content').first.click()
        page.keyboard.type('Block-1')
        page.keyboard.press('Enter')
        page.keyboard.type('Block-2')
        page.keyboard.press('Enter')
        page.keyboard.type('Block-3')
        page.wait_for_timeout(500)

        page.screenshot(path='e2e/screenshots/bug_01_initial.png', full_page=True)

        # 注入调试日志
        page.evaluate('''() => {
            const orig = document.elementFromPoint;
            document.elementFromPoint = function(x, y) {
                const el = orig.call(document, x, y);
                const block = el?.closest?.('.block');
                if (block) {
                    console.log(`[DRAG-DEBUG] elementFromPoint(${x.toFixed(0)}, ${y.toFixed(0)}) => block ${block.dataset.blockId?.slice(0,6)} text="${block.querySelector('.block-text')?.textContent?.slice(0,15)}"`);
                }
                return el;
            };
        }''')

        # 拖拽 Block-1 到 Block-3 下方
        blocks = page.locator('.block').all()
        print(f"初始 Block 数量: {len(blocks)}")

        # 找到 Block-1 的 bullet
        block1 = blocks[0]
        bullet = block1.locator('.block-bullet')
        bullet_box = bullet.bounding_box()

        # 找到 Block-3 的位置
        block3 = blocks[2]
        block3_box = block3.bounding_box()

        print(f"Block-1 bullet: {bullet_box}")
        print(f"Block-3: {block3_box}")

        if bullet_box and block3_box:
            start_x = bullet_box['x'] + bullet_box['width'] / 2
            start_y = bullet_box['y'] + bullet_box['height'] / 2

            # 拖到 Block-3 的下半部分（after 位置）
            end_x = block3_box['x'] + block3_box['width'] / 2
            end_y = block3_box['y'] + block3_box['height'] * 0.75

            print(f"\n拖拽 Block-1 到 Block-3 的 after 位置")
            print(f"  起点: ({start_x:.0f}, {start_y:.0f})")
            print(f"  终点: ({end_x:.0f}, {end_y:.0f})")

            # 逐步移动（模拟真实拖拽）
            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.wait_for_timeout(200)

            # 慢慢移到 Block-2 区域
            block2 = blocks[1]
            block2_box = block2.bounding_box()
            mid_x = block2_box['x'] + 50
            mid_y = block2_box['y'] + block2_box['height'] / 2

            page.mouse.move(mid_x, mid_y)
            page.wait_for_timeout(300)
            page.screenshot(path='e2e/screenshots/bug_02_over_block2.png', full_page=True)

            # 继续移到 Block-3 区域
            page.mouse.move(end_x, end_y)
            page.wait_for_timeout(300)
            page.screenshot(path='e2e/screenshots/bug_03_over_block3.png', full_page=True)

            # 释放
            page.mouse.up()
            page.wait_for_timeout(800)

            page.screenshot(path='e2e/screenshots/bug_04_result.png', full_page=True)

            # 检查结果
            blocks_after = page.locator('.block').all()
            texts = []
            for b in blocks_after:
                try:
                    t = b.locator('.block-text').inner_text(timeout=3000)
                    texts.append(t)
                except:
                    texts.append('(?)')

            print(f"\n结果: {texts}")
            print(f"期望: ['Block-2', 'Block-3', 'Block-1']")
            if texts == ['Block-2', 'Block-3', 'Block-1']:
                print("✅ 正确!")
            else:
                print("❌ 位置错误!")

            # 读取控制台日志
            logs = page.evaluate('() => window.__dragLogs || []')

        browser.close()


if __name__ == '__main__':
    test_bug()
