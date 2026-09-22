# ADR-0050: Tag 本位字段交互与 Tag 聚合页

> **状态：草案中（grill-with-docs 进行中）**。上游锚点见 ADR-0049「后续方向锚定」段（属性概念退役、tag 本位）与 CONTEXT.md 词条 **Tag / Tag Field / Property (RETIRING)**。

## Context

ADR-0049 完成了数据层的字段统一（FieldDefinition / FieldValue），并在方向锚定段裁定**属性概念退役、tag 本位**。本 ADR 承接其交互层落地方案。

## 决策（grill-with-docs 逐轮敲定）

### D1（已定）：挂载即显示
打 tag → 块上出现该 tag 的字段编辑区，无值字段以空占位可填。不存在独立属性入口。

### D2（已定）：程序化写值 = 「确保挂载 + 写字段值」原子意图
TaskHub `ensureTodo` 等程序化路径：先确保 `#task` 在 content，再写 status/priority 字段值。tag 本位的挂载前置，非属性补丁。

### D3（已定）：存量数据无需迁移
无 tag 但有字段值的存量块：值保留在库，tag 本位下无挂载即无编辑区（UI 不可见）；用户手动打 tag 后值自然恢复可见。不做回填脚本。

### D4（已定）：TaskHub 过滤源切 tags
数据源过滤从「`status` 值非空」（TaskHub.vue:91 现状）改为「`block.tags` 含系统 task tag」。挂了 `#task` 的块才是任务，与字段显示逻辑同源。

### D5（2026-09-22 修正）：左栏入口 = 标签管理，不新建实体
左栏入口只做 tag 列表/管理展示（查看、重命名、配置字段模板、删除守卫同 is_system 规则）；**不提供「新建 Tag」按钮**——Tag 实体的创建仍唯一走块上 `#名` 自动建（D6 决策 #2），管理页消费既有 Tag。取代本 ADR 初稿「新建标签入口」的表述。

### D6（已定）：撤销栈维持 ADR-0046 边界
程序化写值（含确保挂载的 content 变更）不入撤销栈——用户直觉：任务操作不是打字；手动 content 编辑（含删 `#task` 字样）照常可撤销。

### D7（设计稿已收，结构定稿）：tag 聚合页 = 独立新页面，形态对齐 Query Page

点击 chip → 导航到该 tag 的聚合页面，独立新页面。设计稿（`#项目` 示例）自上而下五段，逐段映射实现载体：

| 设计稿元素 | 实现映射 | 现状 |
|---|---|---|
| 面包屑「标签 / #项目」 | 返回标签管理（D5）的导航 | 新 UI |
| 大标题 `#项目` + 副标题「24 个成员 · 来自 9 个页面」 | 成员数 = 挂该 tag 的块数；来源页数 = 成员块去重 page_id 计数 | 由投影派生 |
| 视图切换 表格 / 看板 / 日历 | `viewKind` 三枚举已有 | ✅ 直接复用 |
| 统计卡 成员(count) / 工时合计(sum) / 平均工时(avg) | **口径已定：自动出全**——成员数(count)恒显；数值字段自动出 sum+avg 卡（如工时），非数值字段（select/date）不出统计卡，零配置。对过滤后卡片客户端求值（单 tag 块数量级小） | **缺口②：数值字段识别（FieldDefinition type == number）** |
| 工具栏 筛选 / 分组 / 排序 / 显示字段 | QueryToolbar 既有 scope（「显示字段」= per-tab 列显示，TaskHub 字段管理同款） | ✅ 复用 |
| 表格列：内容 | `content_preview` | ✅ |
| 表格列：**来源页** | `BlockCard.page_id` 已有；页标题经 TS pages store 映射；点击跳源页面 | 缺标题映射（轻量） |
| 表格列：状态(chip) / 截止 / 工时 | `properties` / `date_refs` + 字段类型渲染 | ✅ TableView 已有 |
| 数据过滤「tags 含此 tag」 | **`BlockCard` 无 tags 字段——缺口①**：投影需加 `tags: Vec<String>`（D4 TaskHub 过滤切换同样依赖，一处扩展两处受益） | 需 Rust 投影扩展 |

视图配置（筛选/分组/排序/显示字段）按 tag 维度持久化，沿用 TaskHub per-tab 配置先例。

### D8（已定）：数据层改名 —— Tag 前缀直改
`FieldDefinition` → **`TagFieldDefinition`**，`FieldValue` → **`TagFieldValue`**——与现名一一对应加前缀，语义即「tag 模板里的字段 / 其值」，迁移机械可脚本化（Rust 类型 + 表名 + TS 类型 + serde rename 评估）。

### D9（已定）：三阶段实施
- **阶段 1**：UI tag 驱动——挂载即显示（字段编辑区）、chip 点击导航聚合页、聚合页、左栏标签管理。
- **阶段 2**：TaskHub 过滤源切 tags（D4）+ `ensureTodo` 原子化（D2）。
- **阶段 3**：数据层改名（D8）+ PropertyService 适配层删除 + UI 命名迁移（Property* 组件退役）。
每阶段可独立提交、独立验证（vue-tsc / lint / vitest 门禁）。

## 开放问题

- D5 标签管理页设计稿（截图待用户重发，收到后细化）。
- `TagFieldDefinition` / `TagFieldValue` 表名是否随 Rust 类型同步改（含 serde rename 对已同步设备 payload 的兼容评估）。
