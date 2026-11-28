# 0066 网页链接块与四种视图

- Status: accepted
- Date: 2026-11-24
- 关联: ADR-0009（分层边界）、ADR-0025（块复制粘贴）、ADR-0032（z-index 分层）、ADR-0039（块入口与入口菜单）、ADR-0046（撤销单栈）、ADR-0063（`format` 承载块级样式属性）

## Context

**外部网页链接在 CoMind 里只是一段纯文本。**

- 正文渲染段的 `link` 类型只由 `[[target]]` / `((type))[[target]]` 语法产生（`render_segment_service`），裸 URL 不生成任何可点段，正文链也没有 URL 识别器。粘进来的网址既不可点，也读不出指向。
- 结果：笔记里记下的网址，回看时只能靠域名与路径名猜内容，猜不出就逐个点开试。这是本决策要解决的**唯一场景**（回看辨识），不是书签管理。

飞书的对应模型（官方帮助文档已确认）是「一个链接对象 + 四种可切换视图」，不是四种块类型：

| 视图 | 呈现 | 依赖 |
|---|---|---|
| 链接视图 | 展示 URL 本身 | 无 |
| 标题视图 | 展示网页标题作为链接文字 | 网页 `<title>` |
| 卡片视图 | 标题 + 摘要 + 域名（+ 图标 / 封面图） | OG / meta 元数据 |
| 预览视图 | 直接内嵌网页、可交互、可拖拽改高 | 站点允许被 iframe 嵌入 |

现有基础设施决定了若干条不可绕行的边界：

- `Block.format` 是自由 JSON（`Record<string, unknown>`），随块持久化 —— 视图与元数据无需改存储层。
- Rust 侧对块 `type` **无白名单**（`normalize_block_type` 只归一见 `bullet → text`），新增块类型不必动 Rust；但 `is_text_like` 是硬编码 `matches!`，不进名单的类型不生成 `renderSegments`。
- `image` 块已是「无编辑态、`editorComponent` 复用 `renderComponent`」的视图型块，有现成范式。
- `src-tauri` 无任何 HTTP client（仅 dialog / notification / os / fs 插件；sync 走 tokio-tungstenite）。
- Tauri CSP 为 `default-src 'self'`，未声明 `frame-src` / `connect-src` ⇒ 远程 iframe 被拦，前端 `fetch` 亦被拦。

## 决策

### D1 一个块类型 `web-link`，四种视图是 `format` 属性

```ts
format.link?: {
  view?: 'link' | 'title' | 'card' | 'preview'   // 缺省 'link'
  previewHeight?: number                          // 预览视图高度，px
  meta?: {
    title?: string
    desc?: string
    domain?: string
    iconAssetId?: string
    coverAssetId?: string
    fetchedAt?: number
    error?: 'network' | 'status' | 'timeout' | 'decode'
  }
}
```

视图是块的显示属性，切换只走 `updateBlockFormat`。该函数只合并 `format` 后 `_scheduleSave`、**不进撤销栈**（ADR-0046 的单栈不被视图偏好污染），因此切换视图天然可逆、零历史噪声。

理由与 ADR-0063 D2 同构：四种形态共用同一份内容与元数据，做成四个块类型只会换来四份注册表、四个入口字形、四套剪贴载荷分支，而类型信息在查询层不可见（`BlockCard` 无 `type`）。

### D2 URL 存 `content`，元数据存 `format.link.meta`

`content` 就是 URL 原文。链接视图直接渲染 `content`；标题视图用 `meta.title` 替换显示文字，**不改动 `content`**。元数据一律进 `format`，不进 `FieldValue`（字段必须属于某个 tag，ADR-0049）。

代价：正文（`content`）在卡片 / 预览视图下不可见也不可编辑，改地址走菜单「编辑链接」。

### D3 元数据获取只有一条通道：Rust 侧命令

`fetch_web_link_metadata(url)` 在 Rust 内发请求，返回 `{ finalUrl, title, desc, siteName, iconUrl, coverUrl }`。

- 前端 `fetch` 被 CSP `connect-src` 回落拦死，且在 dev/网页端还有 CORS，不能作为主路径。
- Rust 侧可跟随重定向、可设 UA（多数站点拒绝默认 UA）、可做字符集解码（中文站点大量 GBK/GB18030，按 UTF-8 硬解会得到乱码标题）。

**失败是常态分支，不是异常**：站点拒绝、超时、编码不可解都返回结构化错误码，由 D6 规定可见结果。

### D4 抓取时机：粘贴即异步，元数据到达不改视图

粘贴识别出 URL 后立即落地为链接块并发起抓取，不阻塞输入。抓取结果只刷新当前视图的渲染内容，**不自动切换到卡片视图** —— 视图是用户的选择。

「转为网页链接」对存量块同样触发一次抓取。

### D5 默认落链接视图；粘贴后「显示为」面板自动浮出一次

新建链接块默认 `view = 'link'`（与飞书一致，不夺走原文 URL）。补偿手段是面板：粘贴完成后面板立即浮出一次，把四种视图摆在注意力还在的时候；面板消失后，切换入口是 hover 面板与块入口菜单二级项（D10）。

### D6 卡片视图按封面自适应两型

| 条件 | 排版 |
|---|---|
| 有 `coverAssetId` | 大图卡：封面在上（16:9 裁切），标题 + 摘要 + 域名在下 |
| 无封面 | 窄卡：图标左（24px），标题 + 摘要右，底部域名行 |

**抓不到元数据时**的确定样貌：标题位用域名（无域名用 URL 首段），摘要位写「未能获取网页信息」，右上角给「重试」。不退回链接视图（会被误读为切换失败），不做骨架加载态（会被误读为永远在加载）。

### D7 图标与封面落地为本地 asset

抓取时把 favicon 与 `og:image` 下载到 `assetStorage`，`format.link.meta` 只存 asset id。理由有三：离线回看时卡片不裂图（本场景的核心）；CSP `img-src` 回落 `'self'` 会拦远程图；远程封面普遍有防盗链，直引即裂。

代价：占磁盘、封面不会自动更新。

### D8 预览视图：放宽 `frame-src`，sandbox 不给 `allow-same-origin`

- CSP 增加 `frame-src https:`。
- `sandbox="allow-scripts allow-popups allow-forms"`：脚本可运行（否则现代站点全白），但被关进不透明源，拿不到 cookie、本地存储与父窗口，`window.parent` 与 Tauri IPC 均不可达。
- 仅允许 `http` / `https`，其余 scheme 一律不渲染 iframe。
- 高度可拖拽调整，写入 `format.link.previewHeight` 并随块持久化。
- **跨源无法探测白板**（读不到 iframe 内容），因此不做「不可嵌入」的智能提示，改为常驻一行兜底说明 + 「在新窗口打开」。没有任何智能判断，只有确定存在的出口。

### D9 编辑边界

| 视图 | 正文可编辑 | 说明 |
|---|---|---|
| 链接视图 / 标题视图 | 可 | 直接改 URL；失焦或确认后重抓元数据 |
| 卡片视图 / 预览视图 | 不可 | 改地址走块菜单「编辑链接」 |

### D10 发现性靠 hover，不做提示点；存量走显式转换

- 悬停块上浮出「显示为」面板，块入口菜单提供同一组二级项。
- 不给「可展开为卡片」加任何常驻视觉提示 —— 接受「不悬停就发现不了」这一代价，换取界面零噪声。
- 存量裸 URL 不做整页扫描，提供「转为网页链接」动作（块菜单 + 多选批量），由用户逐块决定，避免意外的大批量网络请求。

### D11 序列化与搬移

| 路径 | 约定 |
|---|---|
| 复制为纯文本 / 导出 markdown | 直接落 `content`（URL 原文），由 markdown 渲染器当自动链接；**不**注入标题文本（标题来自元数据，属于显示层） |
| 预览视图 | 不进 markdown —— iframe 不进任何纯文本面 |
| 块复制粘贴 / 跨页搬移 | `content` + `format`（含视图选择与元数据、asset id）随载荷走，**不重新抓取** |

### D12 全局「自动抓取网页信息」开关

设置项默认开启。关闭后粘贴只落链接视图，元数据仅通过显式「获取网页信息 / 转为网页链接」触发。本地优先应用主动外联应当可关。

## 已否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 四个独立块类型（`web-link-card` 等） | 查询层读不到 `type`，换不来可聚合性；四份注册表、四套入口字形与剪贴载荷分支，而内容与元数据完全相同 |
| URL 存 `format`，`content` 留给用户备注 | 搜索搜不到 URL；粘贴与复制语义要单独处理；与「`content` 是正文唯一真源」的现有模型相悖 |
| 前端 `fetch` + 公共 CORS 代理 | 依赖第三方代理的可用性、隐私与限流；桌面端反被 CSP 拦死 |
| 纯手动填写标题与摘要 | 与「回看辨识」的场景直接冲突 —— 要认出来就得先手动输入 |
| 抓不到就自动退回链接视图 | 用户切过去会看到「又变回链接」，误读为功能失效 |
| 无元数据时保留骨架 + 加载态等重试 | 看起来永远在加载，比明确失败更差 |
| 整页一键扫描并把所有裸 URL 批量转块 | 误判不可撤销、请求量不可控；批量面留给多选 |
| 封面与图标直接引用远程 URL | 离线裂图、防盗链裂图，且被 `img-src` 回落拦；本场景恰好要求离线可见 |
| 预览视图改用服务端代理 + 本地渲染 | 需本地服务与资源改写，嵌进来的页面几乎必然不可用，与白板无差别 |
| 视图切换写入撤销栈 | 视图是显示偏好，进历史会让撤销语义失真 |
| 给可展开的链接加常驻提示点 | 笔记流里每条链接都带一个点，噪声大于收益 |

## 后果

### 改动面

| 位置 | 动作 |
|---|---|
| `src-tauri/Cargo.toml` | 新增 `reqwest`（rustls + gzip + charset） |
| `src-tauri/src/web_link.rs` | 新增：抓取、`<head>` 解析（手写标签扫描，不引 HTML 解析器）、图标/封面落 asset |
| `src-tauri/src/commands.rs` / `src-tauri/src/lib.rs` | 新增并注册 `fetch_web_link_metadata` |
| `src-tauri/tauri.conf.json` | CSP 增 `frame-src https:` |
| `src/utils/web-link.ts` | 新增：视图枚举、`format.link` 读写单源、URL 判定、展示回退链 |
| `src/services/web-link-meta.ts` | 新增：调用命令 + 载荷归一 + 错误码归一 |
| `src/composables/useWebLinkSettings.ts` | 新增：自动抓取开关（localStorage）+ 面板首展提示 |
| `src/components/Block/handlers/web-link/` | 新增：handler 注册、`WebLinkBlock.vue`（四视图 + 悬停面板）、`WebLinkEntryMenuItems.vue` |
| `src/components/Block/index.vue` | 引入 handler（`import './handlers/web-link'`） |
| `src/components/BlockList.vue` | 粘贴分发：整段是一个网址时落链接块（空块就地转，否则插入新块） |
| `src/composables/useSlashCommands.ts` | `/web` 插入链接块（走 `convertBlockType`） |
| `src/components/Block/components/BlockMenuCommon.vue` | 通用段新增「转为网页链接」（D10 存量转换入口，仅整块恰为 URL 的文本块显示） |
| `src/components/Block/composables/useBlockMenuActions.ts` | 新增 `convertToWebLink` 动作与 `canConvertToWebLink` 判定 |
| `src/types/block.ts` | `Block['type']` 联合加 `'web-link'` |
| `src/components/Settings/SettingsModal.vue` | 「自动获取网页信息」开关 |

### 已知代价

1. **默认视图是链接视图 + 无常驻提示** ⇒ 从不悬停的用户拿不到卡片的价值。这是明确接受的取舍（D5 / D10）。
2. **预览视图对拒绝嵌入的站点是白板**，且跨源无法自动识别，只能给常驻出口。
3. **放宽 `frame-src` 等于允许任意远程页面进入 webview**，攻击面大于当前配置；缓解手段只有 sandbox 无 `allow-same-origin`。
4. **封面与图标落本地** 会随链接数量增长占用磁盘，且不会随站点更新。
5. **元数据不会自动过期更新**，只有显式重抓。

### 实测结论（2026-11-25，桌面端 dev 实测）

**拒嵌比例**：对 10 个中文常用站点采样响应头，5 个显式拒嵌（知乎/简书/V2EX `X-Frame-Options`，GitHub `XFO:deny` + `frame-ancestors`，知乎另带 CSP `frame-ancestors`），996m2/微信公众号/少数派/阮一峰/B站/抖音无拒嵌头。约半数站点预览视图可嵌入；无头但用 JS 自抗嵌的站点无法提前探测，跨源运行时也读不到，只能按「白板 + 常驻新窗口出口」处理。实测 996m2 在 webview iframe（本 ADR 的 sandbox 配置）中正常加载渲染。

**中文编码**：和讯网（GBK）按 UTF-8 硬解得乱码；修复后（reqwest `charset` 特性 + 按响应头/BOM 解码 + 解析器 ASCII 大小写不敏感 + 支持不带引号的属性值）实测 `fetch_web_link_metadata` 正确返回中文标题「和讯网」与摘要，favicon 落盘为本地 asset。

**封面防盗链**：简书图床、少数派 rssfile 图床均不校验 `Referer`（无 Referer 直下 200）。但 996m2 页面声明的图标 URL 实际 404（声明与实存不符是常态分支，非异常）——该站无封面时卡片走窄卡兜底，验证了 D6 的域名兜底路径。整体结论：下载落本地的策略未被防盗链实质阻挡，失败主要来自「声明的资源本身不存在」。

**粘贴实测**：整段恰为一个 URL 的粘贴在空块上就地转 `web-link` 块（非空/非空块场景回落普通粘贴拆行）；修复过程中发现并落地：转块时必须用 `patchWebLink` 保留已在途的元数据。四视图（链接/标题/卡片/预览）在真实页面渲染验证通过。

### 未做

- 导出 markdown 时把链接块降级为 `[标题](URL)`：现在直接落 URL 原文（可被 markdown 渲染器识别为链接），标题属于显示层不进文本面。
- 链接块的字段化与查询投影（不参与看板 / 查询 / 表格视图）。
- 链接去重、失效检测、站点归档（快照）。
- 移动端预览视图（`android` 包内未验证 iframe 行为）。
