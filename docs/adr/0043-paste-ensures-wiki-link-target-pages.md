# 粘贴即建页：粘贴触发对未解析 [[wiki 链接]] 目标的 Ensure 建页

Status: accepted

块内 `[[wiki 链接]]` 的**键入路径**在插入前先建页（`getOrCreatePageByTitle`，Editor.vue `handleWikiLinkSelect` 注释明言：不先建页则链接会被同步流程跳过、Link 表丢边）；但**粘贴路径**不建页——目标页不存在的 `[[xx]]` 随块 content 原样落库，保存时 Rust 抽链（`content_parse_service::extract_links`，目标 `get_by_title` miss 即 skip）不写 Link 行，图谱快照（Link⋈Block⋈Page INNER JOIN，`build_graph_snapshot`）因此无边，渲染只剩"死链"兜底（text 段外包 `.block-link`，点击由路由守卫懒建页）。结果形成语义分裂：**键入 `[[x]]` = 声明页面，粘贴 `[[x]]` = 引用已存在页面**。决定：所有粘贴形态统一为声明语义——在粘贴分发咽喉 `handleDocPaste`（BlockList.vue:380，`resolveClipboardForest` 决策之前）对剪贴板文本提取 `[[目标]]`，对不存在的目标用与键入同源的 `getOrCreatePageByTitle` **幂等建页**（trim、`type=normal`），之后块保存时既有抽链自然命中、Link 边与图谱边自动成立；本次实际新建 N>0 时 toast 汇总一次（如"已创建 2 个页面：产品评审、复盘模板"）。存量死链不处理，点击懒建兜底保留。

## 背景事实

- `Link` 表：`source_block_id / target_page_id(FK→Page) / display_text / relationship_type`——无"未解析链接/原始标题"存储；目标页不存在则任何路径都不可能有行。
- 覆盖入口三条，全部先经 `handleDocPaste`：① 内部块复制粘贴（ADR-0025 `BlockClipboardPayload`）；② 外部文本/HTML 粘贴（ADR-0026）；③ **inline 光标粘贴**——`handleDocPaste` 在块级判定不满足时 `return`（不 preventDefault），内容落 TipTap 默认单块文本插入，同样不建页。
- 失焦兜底不救 inline 粘贴：Editor.vue `onBlur` 的建页分支被 `menuVisible` 门禁包住，只处理"菜单还开着时游标所在的单个 `[[query`"，不扫闭合的 `[[xx]]`。
- 死链渲染（TS 兜底 `.block-link`）在 ensure 建页后**自愈**：目标存在后 Rust 正常产出 Link 段，TS 兜底不再触发。

## Considered Options

- **幽灵节点（未解析链接存储 + 图谱占位虚线节点，点击占位才建页）**：不产生多余页面、创建由用户控制；但引入新存储结构（Link 表加原始标题行或独立表）+ 图谱渲染占位改造，且"链接关系"在点击前仍是半成品、图谱完整边不成立。拒绝——用户主张的是真正走创建过程，而非占位。
- **粘贴前弹确认清单**：显式可控；但打断批量粘贴流，且与键入路径的静默建页语义分裂。拒绝。
- **维持现状（死链可点击 + 点击懒建）**：零改动；图谱缺口永存，且语义分裂不解决。拒绝。
- **落点 Rust 保存链路统一 ensure（`content_parse_service` miss→create）**：覆盖一切写块路径、单一实现；但 Rust 服务层获得"保存块即建页"的写副作用，须自行处理同步上报与标题规范化，风险面最大。拒绝（本次）——前端咽喉已覆盖全部粘贴形态；未来若出现新的非粘贴写入口且需同语义，再评估上移。
- **ensure 只放 `pasteBlocks`**：不覆盖 inline 光标粘贴（inline 不经 pasteBlocks）。拒绝——ensure 点上移一层到 `handleDocPaste`，一处覆盖三种形态。
- **回填存量死链（一次性迁移或按需 ensure）**：可能批量创建大量意图不明的页面，引入迁移与同步考量。拒绝——存量靠既有点击懒建兜底。

## 决策细节（改什么 / 不改什么）

- **ensure 点**：`handleDocPaste`（BlockList.vue:380）内、`resolveClipboardForest`（:402）决策之前，对剪贴板可读文本（text/plain 与 text/html，同 `resolveClipboardForest` 的 mime 读取参数）提取目标。
- **目标提取规则与 Rust `extract_links_from_content` 严格对齐**：`[[a|b]]` 取目标 `a`（显示文本 `b`）；target 与 alias 均 trim；`[[]]` 与纯空白目标跳过。对齐理由：ensure 的目的是让随后的抽链命中，规则不一致会导致建了页却链不上。
- **建页与键入同源**：复用 `getOrCreatePageByTitle`（幂等、trim、`type=normal`），包括其既有怪癖（如 `[[2026-09-01]]` 不存在时建 normal 而非 ideas 页）——与键入完全同构，键入路径日后若升级日期语义，粘贴路径自动同步受益。
- **不改**：TS 渲染兜底正则与装饰正则（ensure 后死链自愈，差异仅在 ensure 前短暂存在）；点击路由守卫懒建兜底（保留，覆盖存量与漏网入口）；存量死链；Rust 层零改动。
- **不新增手工写 Link**：ensure 后块保存走既有抽链即写边，无第二套写边逻辑。

## Consequences

- **语义统一**：`[[x]]` 从"引用已存在页面"变为"声明页面"——任何把含 `[[x]]` 的文本带进编辑器的粘贴都触发声明，键入与粘贴行为收敛。
- **图谱完整性**：粘贴新内容即刻可成边，不再需要点击中转或等待重存。
- **副作用面**：一次批量粘贴可能创建多个页面（toast 汇总告知）；新建的空页面在删除粘贴块后残留——与键入建页后删文本同理，不做回收。
- **幂等**：`getOrCreatePageByTitle` 幂等，同次粘贴多处引用同一目标只建一次；复制粘贴不改源数据，新块以新 `source_block_id` 建新 Link 边。
- **同步**：ensure 走既有 wasm 命令路径，与键入建页同样被 sync（ADR-0019）覆盖；Rust 服务层无新增副作用。
- **已知边界**：非粘贴的写入路径（程序化、未来导入）仍不 ensure；inline 粘贴的 ensure 与 TipTap 默认插入存在时序竞争（inline 不 preventDefault、ensure fire-and-forget：wasm 本地调用毫秒级、块保存有 debounce，ensure 几乎必然先完成；极端竞争 miss 时抽链 skip 无害，靠用户后续保存/点击自愈），miss 时依赖后续保存/点击自愈。
- **词表**：暂不新增领域词条（本会话定），行为以本 ADR 为准。
