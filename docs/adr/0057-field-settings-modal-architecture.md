# 0057 字段设置弹窗与字段入口组件架构

- Status: accepted
- Date: 2026-10-16
- 关联: ADR-0050（标签原生字段交互，D14 就地编辑表、D18 隐藏规则、D19/D20 字段展示位）、ADR-0031（TableView 字段面板）、0055（数值约束编辑）

## Context

字段定义的唯一配置入口是标签管理页右栏的字段模板区（七列就地编辑表：字段/类型/默认/来源/隐藏/形态/操作 + 条件子行）。两个结构性问题：

1. **列数压力**：每新增一个字段属性，模板表就要加一列或一组条件行，600–800px 右栏已接近承载上限；且 `description` 无持久化列（编译期类型有、`PersistedFieldDefinition` 无）、`spec` 仅会话内 store 回贴（刷新即丢）。
2. **路径过长**：在 block 上看到字段想改设置，需绕「block → 侧栏标签页 → 模板区找行」三步；block 字段区（`BlockFieldZone`）无任何设置入口。

## 决策

### D1 三层架构

```
FieldLabel.vue（通用入口组件）
  └─ emit('open-settings') ──→ App 级受控弹窗 FieldSettingsModal.vue（fieldId 非空即显示）
        └─ 保存 ──→ tagsStore.updateFieldDefinition（唯一写源）
```

- **FieldLabel**：类型图标（按字段类型分派，单源 `TYPE_ICONS`）+ 字段名，纯渲染组件，点击图标 emit 意图；弹窗开闭由调用方/App 层管理（对齐 BasePopover「store 持状态 + 调用方传锚点」模式）。图标兼任类型标识，永远渲染（隐藏会丢失信息）；`openable` 决定能否点开弹窗。**设置入口不分来源（修订）**：自身 / 引用 / 继承字段一律可打开弹窗且可自由编辑——定义全局共享，改一处处处同步，继承方与声明方同权；系统字段（`is_system`）也可打开，但弹窗内全部控件禁用、无保存按钮（只读查看）。`editable` prop 仅影响 tooltip 措辞。
- **FieldSettingsModal**：仿 BlockModal 的受控 props 新弹窗（居中、`min(94vw, 680px)`、radius-lg、遮罩 blur、Esc 键帽、30px ghost 图标按钮），不用无参单例的 SettingsModal（无法携带 fieldId）。
- 消费方两处：标签管理页字段模板卡片、`BlockFieldZone` list 变体字段行（行首图标列）。

### D2 字段模板区：七列表 → 流式方框卡片

- 每字段一个固定宽（240px）方框，`flex-wrap` 横向流动，不拉伸填满容器。
- 卡片纯展示：FieldLabel（图标+名）、描述（两行截断）、来源 badge；**零就地编辑控件**，所有编辑进完整设置弹窗。类型文字徽章删除（图标已表达类型）。
- 修订 ADR-0050 D14：就地编辑表退役；「来源」从表格列变为卡片展示项与弹窗「使用于」行。
- 标签管理页其余部分（tag 列表、身份条、单点管理语义）不动；「+ 添加字段」保持候选池（candidateFields）路径。

### D3 description 与 spec 落 Rust 持久化

- `PersistedFieldDefinition` 新增 `description`（TEXT）与 `spec`（**JSON TEXT 列**，整体序列化）两列，按 core 加列全流程落（entity native + sqljs 读写 + 两份 CREATE TABLE + ALTER TABLE 迁移 + wasm 重编）。
- spec 用 JSON TEXT 而非结构化列：结构随类型变化且会增长，与 multiSelect 的 JSON codec 模式对称；查询引擎不按 spec 过滤。
- 无存量数据迁移负担（两属性从未落库）；读取 NULL 归一为空 description / 空 spec，与 `normalizeHideWhen` 同判据风格。

### D4 弹窗内容：Tana 式单页两列行

- 单页长滚动，左窄标签（108px）+ 右宽控件，行间细线；不设分区标题。
- 行序：字段类型（条件区紧随其下：select/multiSelect → 选项管理，number → min/max/step/单位）→ 默认值 → 展示形态 → 隐藏 → 使用于 → 操作。
- 名称与描述在弹窗头部（字段名大号输入 + 描述占位输入）。
- **隐藏**：复用 `field-hide.ts` 五档枚举（`FIELD_HIDE_OPTIONS`），与模板区「隐藏」列同款下拉，非布尔开关。
- **使用于**：默认折叠——「N 个块有值」可点展开有值块列表（块属性反查），点击块项打开既有 BlockModal（叠层 z = dialog+10）。
- **操作**：删除字段（danger 样式，二次确认；删除 = 移除定义 + 清理块上值 + 各标签模板 field_ids 引用）。
- 头部下方常驻「全局生效」提示（字段定义全局共享，改定义作用于所有引用方）。

### D5 写入模式：草稿 + 保存

- 弹窗内编辑均为草稿，「保存」一次性走 `updateFieldDefinition`；未保存关闭需提示。
- 改类型时块上已有值保留（沿用模板区现状口径）；保存时 toast 提示兼容性。

## 已否决替代方案

- **spec 结构化列**（min/max/step/unit 各一列）：8 处 SQL × N 列，每加一种特化需再迁移。
- **弹窗即时写库**：schema 级复合操作（改类型/选项）会产生暴露给所有消费端的中间态。
- **扩展 SettingsModal 携带 fieldId**：改全局设置弹窗打开语义，无参单例与带参受控两种模式冲突。
- **布尔隐藏开关**：与 `field-hide.ts` 五档规则枚举冲突，属能力降级。
- **四分区弹窗**（基础/类型与约束/显示/来源）：被单页两列行取代——条件区插入位置在分区制下不自然。

## 后果

- 新组件 3 个：`FieldLabel.vue`、`FieldSettingsModal.vue`、（弹窗内）使用于块列表；`TYPE_ICONS` 类型图标映射为单源。
- `TagsLibrary.vue` 字段模板区模板段重写（七列表 → 卡片网格），相关测试更新。
- `BlockFieldZone.vue` list 变体行首新增图标列。
- 字段属性后续增长只改弹窗（加一行）与 spec JSON 结构，不再动模板表列。
