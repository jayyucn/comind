# ADR-0037: Image Block 无编辑态、Hover 操作菜单与行内缩放

- 状态：已采纳（Accepted）
- 日期：2026-08-26
- 范围：
  - `src/components/Block/handlers/image/*`（ImageEditor/ImageRender 与 image handler）
  - `src/composables/useSlashCommands.ts`（`/image` 命令行为）
  - 新增/复用的 lightbox 组件（全屏放大查看层）
  - 图片块选中态的 bounding box + 角点手柄（需与 ADR-0035 块选区模型协调）
- 关联 ADR：
  - **ADR-0035**（跨 Block 文本选区）——图片块点击/选中行为需与块选区模型协调
  - **ADR-0012**（z-index 分层）——lightbox 浮层必须 Teleport 到 body 并用 `var(--z-*)`

---

## 背景 / 问题陈述

旧 Image Block 是**双态**的：

1. `/image` 把当前块切为 `image` 类型，并显示一个上传/拖拽编辑器（`ImageEditor.vue`）；
2. 失焦后进入只读态（`ImageRender.vue`），hover 时右上角只显示「复制链接 / 清空」两个按钮。

问题：

- 插图片需要先进编辑态再点上传，流程比其它 slash 命令多一步；
- 编辑态里图片本身并不编辑，却占用一个焦点态，和 bullet/code 等真正需要文本编辑的块不一致；
- hover 操作太少，且图片无法在文档内缩放——用户期望像 Notion 那样选中图片后出现边框与四角圆点手柄，可拖拽改变显示尺寸。

用户诉求：

- `/image` 后直接进入系统文件选择器；确认即显示图片，取消则清空 `/image` 输入；
- hover 图片时弹出操作菜单，支持缩放查看；
- 图片被选中后显示边框 + 四角圆点，可拖拽缩放行内尺寸。

**为何需要 ADR**：移除 image 编辑态会改变 `BlockTypeHandler` 的常规模式；对齐、行内缩放、lightbox 缩放是三类不同的「缩放」语义，须明确区分并持久化约定。

---

## 决策

### D1：Image Block 无编辑态，始终渲染

`image` 类型保留 `editorComponent`（满足 `BlockTypeHandler` 接口兼容），但它**不再展示上传区**，仅作占位；实际交互下沉到 `/image` 命令与 hover 工具栏。渲染层（`ImageRender.vue`）是唯一面向用户的界面。

### D2：`/image` 命令 = 打开系统文件选择器

命令在 slash 菜单中被选中（回车）后，立即异步打开原生 `<input type="file" accept="image/*">`：

- **确认**：读取文件 → `assetStorage.save(file)` → 写入 `content: "![${name}](asset://${id})"`，并把块类型切为 `image`；
- **取消**：不转换类型，删除 `/image` 文本，当前块保持为普通空文本块。

类型转换失败不应留下 `![]()` 占位。

### D3：Hover 工具栏为横向图标菜单

菜单项（Notion 式横向图标，分组排列）：

- **操作**：放大查看、复制图片、裁剪、替换图片、删除图片；
- **布局**：左对齐 / 居中对齐 / 右对齐。

- **裁剪**：工具栏点「裁剪」进入行内裁剪态（见 D13），确认后原图被裁剪结果替换。
- 「复制链接」**未实现**：ADR 早期版本列出的该项当时被排除（见 H3 修复记录），菜单当前不含该按钮；如后续需要再补。
- **不含** caption（图注）、comment（评论）——超出范围。

### D4：对齐信息存在 `block.format.align`

- 键值：`"left" | "center" | "right"`，默认 `"left"`；
- 仅控制行内图片在 Block 容器中的布局锚点；
- **不影响** lightbox：lightbox 中图片始终居中、fit-to-screen。

否决把对齐编码进 `content`（如 `![alt](url){#align:center}`）：对齐是展示属性，污染 content 语义会增加导出/序列化复杂度。

### D5：Lightbox 居中覆盖层，仅由菜单「放大查看」进入

- 触发：点击 hover 工具栏「放大查看」；**点击图片本身不进 lightbox**（见 D11 选中行为）；
- 初始状态：图片 fit-to-screen；
- 手势：滚轮缩放、拖拽平移、双击复位；
- 按钮：底部 `−` / `1:1` / `+` / `关闭`；
- 缩放范围 `10% ~ 500%`（实现层可调）；
- 关闭：点击遮罩 / `Esc` / 关闭按钮；
- **仅视图变换，不持久化**。

### D6：「删除图片」= 转为 bullet 空块并插入光标

> 注：本条为 2026-08-27 修订，取代原「只清空内容、保持 image 类型」的写法。原设计被新需求推翻——用户确认删除图片应把该块**转为 `bullet` 类型的空块**并将光标插入其中，而非保留 image 空占位。

- `updateBlockType(id, 'bullet')`（`updateBlockType` 只改 `type`、不动 content）；
- `updateBlockContent(id, '')` 清空旧 `![alt](url)`，否则 bullet 文本块会把图片语法当字面文本渲染；
- `editorStore.deactivateBlock()` + `activateBlock(id, 1)` 把光标插入新空块。

整块删除仍走既有 Block 级操作（如 Backspace 清空后删块）。

### D7：拖拽 / 粘贴保留，统一走 assetStorage

- 图片文件拖到空白处 → 创建新的 image block；
- 图片文件拖到已有 image block → 替换该块图片；
- 在 image block 上粘贴图片 → 替换该块图片。

三者共用同一套 `assetStorage.save` + `content` 写入逻辑，不经过编辑态。

### D8：图片加载失败/空 block 显示占位 + 错误提示

空或 asset 失效的 image block 不再显示上传 dropzone，而是渲染占位图与简短错误文案，hover 工具栏保留「替换图片」入口。

### D9：复制链接 / 复制图片语义

- **复制链接**：内部图（`asset://id`）复制其 blob/object URL（会话内有效）；外部图（普通 URL）复制原 URL。
- **复制图片**：从 `assetStorage.get(id)` 取原始 `blob`，经 `navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])` 写入剪贴板（已确认 `assetStorage.get` 可直接返回 blob）。

### D10：触屏与冻结页

- **触屏**：无 hover，图片被**选中（块选区）时**显示hover 工具栏，替代桌面 hover；
- **冻结页（ideas 只读）**：工具栏隐藏所有操作按钮，仅保留「放大查看」。

### D11：行内缩放（选中后拖四角）

图片块被**选中**时，渲染包围边框 + **四角圆点手柄**；拖拽任一角点缩放显示尺寸。

- 尺寸持久化于 `block.format`（`width` / `height`，单位 px）；未设置时按 `max-width:100%; max-height:400px` 自然约束；
- 角点拖拽**默认锁定纵横比**（按住 `Shift` 自由比例）；
- 与 D5 lightbox 缩放**正交**：lightbox 是临时视图变换（不持久化），行内缩放改变的是持久化的显示尺寸。

### D12：对齐锚点 × 行内缩放方向

行内缩放方向须尊重对齐锚点，避免与对齐「矛盾」：

- `left`：以左缘为锚，向右生长；
- `right`：以右缘为锚，向左生长；
- `center`：以中线为锚，双向对称。

### D13：行内裁剪（crop）

「裁剪」不在 initial 范围内（见原 D3），2026-08-27 经用户确认追加。设计为**图片上直接裁剪**，不使用独立弹层。

- **进入**：点工具栏「裁剪」，`cropOpen=true`；在图片上覆盖一层裁剪框（`.crop-layer`，覆盖 `.image-frame` 且 `overflow:hidden`），框外区域以 `box-shadow` 变暗、被裁切在图片范围内；初始框居中、占图 80%。
- **交互**：拖拽框体移动选区；框四角手柄缩放选区；边界 clamp（`CROP_MIN=40`）不允许拖出图片。
- **工具栏切换**：裁剪态下工具栏仅显示 **取消（X）/ 确认（Check）**；确认裁剪把选区按 `naturalWidth/clientWidth` 比例画到 canvas，`toBlob('image/png')` → `assetStorage.save` → `updateBlockContent('![name](asset://id)')` 替换原图。
- **比例保持**：确认后 `updateBlockFormat({ width: null, height: null })` 清空既有行内尺寸（D11），使裁剪结果按**其自身比例**自然显示，不被旧 `width/height` 拉伸；跨域图无 CORS 头时 canvas 被污染、`toBlob` 失败，提示「裁剪失败：图片受限」。

---

## 后果

- 插入图片心智模型简化：`/image` 即选即用；
- 三类「缩放」语义清晰分离：**行内缩放**（D11，持久化尺寸）／**对齐**（D4，布局锚点）／**lightbox 缩放**（D5，临时视图）；
- `format.align` 与 `format.width/height` 引入新块级展示字段，导出/序列化需透传 `format`；
- lightbox 为新的全局浮层组件，须遵循 ADR-0012 的 z-index 与 Teleport 约定；
- 四角手柄的拖拽手势需与块选区拖拽（ADR-0035）区分，避免误触发块移动。
