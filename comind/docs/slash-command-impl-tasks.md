# /date、/schedule、/deadline 实现任务拆解（基于 v2 inline 节点方案）

> 配套设计文档：`slash-command-redesign.md`（v2）
> 核心决策回顾：日期存为 `Block.content` 内文本 `{{kind:ISO|recurrence}}`，复用 WikiLink 渲染模式；status/priority 留外部属性；`/date` 仍插 WikiLink `[[YYYY-MM-DD]]`。

---

## 依赖总览

```
T1 date-ref 语法模块 ──┬──> T4 DateRefExtension ──┐
                       ├──> T5 useContentRenderer  │
                       ├──> T11 自动推进           │
                       └──> T12 date-ref 索引      │
T2 date-parser 扩展 ──────────────┐               │
T3 recurrence ────────────────────┼──> T11        │
T6 DateTimePickerPanel ─> T7 editor store ─────────┤
                                                   ├─> T8 编辑态点击编辑
T10 斜杠命令 ──────────────────────────────────────┤
T9 阅读态点击编辑 <── T5 ──────────────────────────┤
                                                   │
T13 property 清理 <── T11 ──> T14 展示组件清理 ──> T15 迁移
T16 测试与验证（依赖全部）
```

---

## Phase 0 · 基础层（无 UI，可并行）

### T1 · date-ref 语法模块（新建）
- **文件**：`src/utils/date-ref.ts`
- **目标**：dateRef 语法的**单一事实来源**，所有层（扩展/渲染/索引/命令/推进）共用
- **内容**：
  - `DATE_REF_REGEX = /\{\{(schedule|deadline):([^}|]+)(?:\|([^}]+))?\}\}/g`
  - `parseDateRefs(text: string): {kind, iso, recurrence}[]`
  - `serializeDateRef({kind, iso, recurrence}): string` → `{{kind:iso|rec}}`
  - `formatDateRefDisplay({kind, iso, recurrence}): string` → `📅 07-15 14:00 · 每周` / `⏰ ...`（逾期变红由 CSS 处理）
- **依赖**：无
- **验收**：纯函数单测；正则不与 `[[ ]]` / `(( ))` / `#` 冲突
- **风险**：recurrence 缺省为 `none`；同 block 多 dateRef 全部提取

### T2 · date-parser 扩展（修改）
- **文件**：`src/utils/date-parser.ts`（已存在）
- **目标**：支持「日期 + 时间」联合解析，输出本地 ISO（`2026-07-15T14:00`，不带 Z）
- **内容**：新增 `parseDateTime(input): {date: string, time?: string} | null`
  - 日期：today / tomorrow / yesterday / +N / -N / MM-DD / YYYY-MM-DD
  - 时间：HH:mm 或中文「下午2点」「早上9点半」
  - 无时间默认 `00:00`（全天）
- **依赖**：无（可与 T1 并行）
- **验收**：`/schedule 明天 14:00` → `2026-07-16T14:00`；`/deadline 明天下午2点` → `2026-07-16T14:00`

### T3 · recurrence 计算（新建）
- **文件**：`src/utils/recurrence.ts`
- **目标**：`calculateNextRecurrence(iso: string, rule: string): string`
- **规则**：daily +1天 / weekly +7天 / monthly +1月（月末自动调整，如 1/31→2/28）/ yearly +1年（2/29 非闰年→2/28）
- **依赖**：无
- **验收**：边界用例（1/31+1月、2024-02-29+1年）正确

---

## Phase 1 · 渲染层

### T4 · DateRefExtension（新建）
- **文件**：`src/extensions/DateRefExtension.ts`
- **目标**：编辑态用 ProseMirror Decoration 渲染可点击 dateRef span（仿 `WikiLinkExtension.ts`）
- **内容**：
  - 用 `DATE_REF_REGEX`（来自 T1）匹配文本节点
  - `Decoration.inline(from, to, {class:'date-ref', 'data-kind','data-iso','data-recurrence'})`
  - 显示文本由 `formatDateRefDisplay` 生成
  - 点击 span → 派发自定义事件（携带 PM 文档坐标 `from`/`to` + blockId + 解析值）
- **依赖**：T1
- **验收**：编辑态 dateRef 显示为高亮可点击 span；点击触发事件，WikiLink 不受影响

### T5 · useContentRenderer 扩展（修改）
- **文件**：`src/composables/useContentRenderer.ts`（已存在）
- **目标**：阅读态将 `{{...}}` 渲染为带 data-* 的 span（仿 `renderTypedLinks`）
- **内容**：渲染流水线新增 dateRef 分支；输出 `<span class="date-ref" data-kind data-iso data-recurrence>显示文本</span>`
- **依赖**：T1
- **验收**：阅读态正确渲染；不破坏 WikiLink / relationship / tag 渲染
- **注意**：content 走 `v-html`，禁止用 Vue `{{ }}` 直接绑定原始 content（已在设计文档标注）

---

## Phase 2 · 交互层

### T6 · DateTimePickerPanel.vue（新建）
- **文件**：`src/components/DateTimePickerPanel.vue`
- **目标**：日期/时间/重复选择器面板，多模式
- **内容**：
  - `mode: 'date' | 'datetime'`（/date 用 date；/schedule、/deadline 用 datetime）
  - 日期选择 + 时间选择（datetime 模式）+ 重复规则下拉（none/daily/weekly/monthly/yearly）
  - 预设快捷（今天/明天/下周）
  - 确认 emit `confirm({kind, iso, recurrence})`；取消 emit `cancel`
- **依赖**：无（UI 独立，可最早开工）
- **验收**：组件可独立渲染；两种模式切换正常；重复下拉可选

### T7 · editor store 面板状态（修改）
- **文件**：`src/stores/editor.ts`（已存在）
- **目标**：承载日期编辑面板的开关与目标信息
- **内容**：
  - state：`dateRefEditor: {open, blockId, from, to, kind, iso, recurrence} | null`
  - actions：`openDateRefEditor(payload)` / `closeDateRefEditor()`
- **依赖**：T6
- **验收**：store 状态变化可驱动面板开关

### T8 · 编辑态点击编辑闭环（修改）
- **文件**：`src/extensions/DateRefExtension.ts` + `src/stores/editor.ts` + 编辑器命令
- **目标**：点击编辑态 dateRef → 弹面板 → 确认后改 content
- **内容**：
  - DateRefExtension 点击事件 → 写 editor store（from/to 来自 decoration PM 坐标）
  - 面板 confirm → 用 `editor.chain().insertContentAt({from, to}, serializeDateRef(newVal))` 替换文档区间
  - 替换后 ProseMirror `tr.mapping` 自动重渲染 Decoration
- **依赖**：T4, T6, T7
- **验收**：点 dateRef → 弹面板（预填旧值）→ 改 → content 更新、装饰重渲染
- **注意**：操作在 **PM 文档坐标**，不是字符串 replace（content 编辑时是 PM doc）

### T9 · 阅读态点击编辑闭环（修改）
- **文件**：`src/composables/useContentRenderer.ts` + 渲染容器事件
- **目标**：阅读态点击 dateRef 也能编辑
- **内容**：span 绑定 click → 从 `data-*` 取值 + 计算该 span 在 content 字符串中的区间 → 打开面板 → 确认后字符串替换并保存 block
- **依赖**：T5, T7
- **验收**：阅读态点击触发编辑，保存后 content 含新 `{{...}}`

### T10 · 斜杠命令集成（修改）
- **文件**：`src/composables/useSlashCommands.ts`（已存在）+ `src/components/SlashCommandMenu.vue`（已存在）
- **目标**：三条命令插入正确语法；废弃命令处理
- **内容**：
  - `/date` → 插入 `[[YYYY-MM-DD]]`（WikiLink，沿用现有行为）
  - `/schedule` → 打开面板（mode=datetime, kind=schedule），确认后于光标处插入 `{{schedule:...}}`
  - `/deadline` → 同上 kind=deadline
  - `/time` → 插入 `HH:mm`（保留）
  - 废弃 `/today` `/tomorrow` `/yesterday`：从菜单移除，或重定向提示用 `/date`
- **依赖**：T2, T6, T7
- **验收**：三条命令插入正确语法；废弃命令不可见/有提示

---

## Phase 3 · 索引与推进

### T11 · 自动推进（Done 语义）（修改）
- **文件**：状态切换 action 所在（定位 `stores/blocks.ts` 或 task 相关 action）
- **目标**：带 recurrence 的任务标记 Done 时，dateRef 自动推进 + status 重置 Todo
- **内容**：
  ```ts
  function advanceDateRefInContent(content, recurrence) {
    return content.replace(DATE_REF_REGEX, (full, kind, iso, rec) => {
      if (!rec || rec === 'none' || rec !== recurrence) return full
      return serializeDateRef({kind, iso: calculateNextRecurrence(iso, rec), recurrence: rec})
    })
  }
  ```
  - markDone：若 content 含带 recurrence 的 dateRef → 替换 content；status 重置 Todo（status 是外部属性）
- **依赖**：T1, T3
- **验收**：带 weekly 的任务 Done 后日期+7、status=Todo；无 recurrence 不动
- **风险**：需先定位 markDone 实际位置（可能在 blocks-store 或独立 task action）

### T12 · date-ref 索引（新建）
- **文件**：`src/services/date-ref-index.ts`
- **目标**：支撑日历视图 / 按日期筛选
- **内容**：
  - 从所有 block content 提取 dateRef → `(blockId, kind, iso)` map（用 T1 `parseDateRefs`）
  - 增量更新：content 变更时更新对应 block 条目
  - 查询 API：`queryByDateRange(kind, from, to)` / `queryOverdue()`
- **依赖**：T1
- **验收**：索引与 content 一致；查询返回正确 block 列表

---

## Phase 4 · 清理与迁移

### T13 · property store 清理（修改）
- **文件**：`src/stores/property.ts`（已存在）+ `src/types/property.ts`（已存在）
- **目标**：日期类属性从外部属性系统移除，仅留 status/priority
- **内容**：
  - `setProperty` 不再处理 deadline/scheduled/recurrence
  - 删除 `types/property.ts` 中 datetime 类型定义
- **依赖**：T11（推进不再依赖 property）
- **验收**：setProperty 拒绝日期类；status/priority 行为不变

### T14 · 展示组件清理（修改）
- **文件**：`PropertyInline.vue` / `PropertyDisplay.vue`（定位确认路径）
- **目标**：移除日期右侧徽章显示（改由 DateRefExtension 内联）
- **内容**：删除 deadline/scheduled/recurrence 显示逻辑
- **依赖**：T13
- **验收**：日期不再以右侧徽章出现；status/priority 徽章保留

### T15 · 存量数据迁移（条件执行）
- **文件**：迁移脚本（新建，或 `services/migrate.ts`）
- **目标**：若已有 block 用 properties.deadline/scheduled/recurrence，转为 content 中 `{{...}}`
- **内容**：扫描 → 拼接 `{{kind:iso|rec}}` 插入 content 开头 → 清除 properties 日期字段
- **依赖**：T1, T13
- **验收**：迁移后 properties 无日期字段，content 含 `{{...}}`；幂等可重跑
- **注意**：当前项目为空（仅 README），若确认无存量数据可跳过

---

## Phase 5 · 验证

### T16 · 测试与验证
- **单测**：T1 date-ref 正则 / T2 date-parser / T3 recurrence / T5 useContentRenderer dateRef 分支 / T12 索引
- **手动**：
  1. `/schedule 下周一` 插入 `{{schedule:2026-07-20}}`，编辑态+阅读态渲染正确
  2. `/deadline 明天 14:00 每周` 插入 `{{deadline:...|weekly}}`
  3. 点击 dateRef 弹面板，改后 content 更新
  4. 带 weekly 任务 markDone → 日期+7、status=Todo
  5. `/date` 仍插 `[[YYYY-MM-DD]]` 且可跳转 journal 页
- **依赖**：全部

---

## 建议开工顺序

**第一批（无 UI 阻塞，可立即并行）**：T1 → T2 → T3
**第二批（渲染）**：T4 → T5
**第三批（交互）**：T6 → T7 → T8 → T9 → T10
**第四批（索引/推进/清理）**：T11 → T12 → T13 → T14 →（T15 视数据而定）
**收尾**：T16

> 风险最高：T8（PM 文档坐标替换）、T11（定位 markDone 位置）、T9（阅读态区间映射）。建议实现时优先验证这三处的数据流。
