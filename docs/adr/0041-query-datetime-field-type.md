# ADR-0041: 查询引擎 datetime 字段类型与区间语义裁剪

- 状态：已采纳（Accepted）
- 日期：2026-09-06
- 范围：`src/core/query/`（types / operators / evaluate）、`src/composables/useBlockQueryRegistry.ts`、`src/components/query/`（SortMenu / ValueEditor / ConditionPopover / FieldManagerPanel）、`src/components/views/`（TableView / BoardView）。
- 关联：通用查询系统（ADR-0008 / 0009）、ViewQuery 序列化（ADR-0005）、操作符派生表（`core/query/operators.ts`）。
- 触发：grill-with-docs 对「任务 Block 增加更新时间排序」的刨根问底——day 粒度下同日更新全部并列，排序失去意义。

## 背景 / 问题陈述

任务视图需要按「更新时间」排序（最近编辑过的排前面）。查询引擎 v1 的 `date` 类型契约是 `yyyy-MM-dd`（day 粒度字符串）：筛选 `before/after/between/within` 与 `groupItems` 分桶全部按此假设实现。若直接把 `updated_at`（epoch 毫秒）降成 day 字符串塞进 `date` 字段，同一天内多次更新的任务在排序中并列（退化为稳定序），排序无意义；而把非标准值（`yyyy-MM-dd HH:mm`）塞进 `date` 类型会稀释类型契约，未来消费方（CalendarView、单元格渲染）会静默踩坑。

## 决策

**D1 — 新增一等 `datetime` FieldType，值格式 `yyyy-MM-dd HH:mm`（本地时间、零填充）。**
不污染 `date` 的 day 契约。零填充字符串的 `localeCompare` 结果与时序一致，排序无需改 `compareValues`。

**D2 — datetime 的操作符集裁剪为 `before/after/isEmpty/isNotEmpty`，不开放 `between/within`。**
原因：`between/within` 是闭区间字符串比较，datetime 值对 day 目标存在同日边界 bug（`'2026-09-06 10:44' <= '2026-09-06'` 为 false，同日记录被漏掉）。`before/after` 的语义则天然正确：`早于某天` = 严格早于（不含当天），`晚于某天` = 当天及之后（含当天）——与「今天之前更新的」「最近三天更新的」这类 day 意图吻合。

**D3 — datetime 的分组按 day 分桶（截取值前 10 位日期部分）；筛选值编辑器复用纯日期输入（无时间输入）。**
排序精度（分钟）与筛选值精度（day）解耦；分钟级筛选输入对任务场景无价值。

**D4 — day 粒度排序被否定（本 ADR 的直接动机）。**
同一天内多次更新的任务并列，排序退化为插入稳定序。分钟级粒度下同分钟并列概率趋近于零，剩余并列回退稳定排序即可，不做额外 tie-break。

**D5 — updatedAt 注册为 `key: 'updatedAt'`（label「更新时间」），进 `BUILTIN_KEYS`；默认表格列不含它（排序字段 ≠ 可见列，字段管理中可手动加列）。**

## 否决的备选（及理由）

- **date 类型内嵌时间字符串**：改动最小，但 `type='date'` 的 yyyy-MM-dd 契约被稀释，dateBucket 解析、CalendarView、单元格渲染等消费方全部需要特判，契约性 bug 埋雷。
- **`type: 'number'` + epoch 毫秒**：排序最精确，但筛选操作符退化为数字语义（eq/gt/lt），SortMenu 方向文案显示「1 → 9」，日期语义 UI 全丢。
- **保持 day 粒度**：见 D4，排序无意义，是本次刨根问底的起点。
