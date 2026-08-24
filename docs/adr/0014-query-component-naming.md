# ADR-0014: query 组件命名约定 —— 编排器用 `Query*`，谓词/筛选树用 `Filter*`

- 状态：已采纳（Accepted）
- 日期：2026-08-16
- 范围：`src/components/query/` 下组件的命名前缀约定。纯命名/可读性决策，不影响类型、行为或运行时。本 ADR 是 ADR-0013 的**配套件**，仅澄清「为何有的组件叫 Query、有的叫 Filter」。
- 关联代码：
  - `src/components/query/QueryChipBar.vue`（由 `FilterChipBar.vue` 改名而来；编排整个 `ViewQuery` 的芯片行）
  - `src/components/query/QueryToolbar.vue`（查询工具条展示壳，早先已用 `Query` 前缀）
  - `src/components/query/FilterChip.vue`（渲染单条扁平筛选条件的 chip，**保留 `Filter`**）
  - `src/components/query/FilterBuilder.vue`（构建 `ConditionGroup`/查询树的面板，**保留 `Filter`**）
- 来源：用户对「`FilterChipBar.vue` 是否应改名为 `QueryChipBar.vue`」的 `/grill-with-docs` 决策。

---

## 背景 / 问题陈述

`src/components/query/` 目录下的组件一度混用两种前缀：

- `QueryToolbar.vue`、`core/query`（引擎）——用 `Query`
- `FilterChipBar.vue`、`FilterChip.vue`、`FilterBuilder.vue`——用 `Filter`

但 `FilterChipBar.vue` 实际持有整个 `ViewQuery`，在芯片行里编排 **排序 + 分组 + 筛选** 三类 chip（`modelValue: ViewQuery`）。名字里的 `Filter` 以偏概全——它管的是整个查询，不只是筛选。于是产生命名疑问：`FilterChipBar` 是否该改名？若改，是否要把 `FilterChip`、`FilterBuilder` 一并改掉以保持前缀统一？

经核对代码与领域模型，发现三者的语义层级并不相同：

| 组件 | 实际职责 | 对应领域概念 |
|------|----------|--------------|
| `FilterChipBar` → `QueryChipBar` | 编排 `sorts \| group \| filters` 三类芯片行，持有完整 `ViewQuery` | `ViewQuery`（整个查询） |
| `FilterChip` | 仅 `v-for` 渲染**扁平筛选条件**；sort/group 用的是内联 `<button class="agg-chip">`，从不经 `FilterChip` | `Condition`（单条谓词） |
| `FilterBuilder` | 构建 `ConditionGroup`/查询树；TaskHub 中 `showSortGroup` 默认 `true`（连 sort/group 一起建），PagesLibrary 高级面板中 `showSortGroup=false`（只建筛选，ADR-0013 D5） | 筛选树 / 查询树 |

矛盾点：`FilterChipBar` 的 `Filter` 是误称（它是 query 级）；而 `FilterChip` 的 `Filter` 是**准确的**（它永远只是单条筛选条件）；`FilterBuilder` 的 `Filter` 在「仅建筛选树」语义下也准确，即便它历史上有 `showSortGroup` 能力。

---

## 决策（D1）：只改名编排器，谓词/树组件保留 `Filter`

- **`FilterChipBar.vue` → `QueryChipBar.vue`**：它是 query 级编排器，与 `QueryToolbar` 的 `Query` 前缀一致，且精确对应其持有的 `ViewQuery` 模型。
- **`FilterChip.vue` 保留原名**：它只渲染单条扁平筛选条件（`Condition`），命名为 `FilterChip` 名实相符；若改名 `QueryChip` 反而误导（sort/group 芯片根本不是 `FilterChip`）。
- **`FilterBuilder.vue` 保留原名**：它构建的是筛选树 / 查询树，历史命名稳定；`showSortGroup` 只是其可选能力，不改变「构建筛选结构」的本质职责。

### 命名约定（后续组件遵循）

- **`Query*` 前缀**：表示「query 级编排器 / 展示壳」——持有或驱动完整 `ViewQuery`（如 `QueryChipBar`、`QueryToolbar`）。
- **`Filter*` 前缀**：表示「筛选树的叶子或构建器」——单条 `Condition` 或 `ConditionGroup` 树（如 `FilterChip`、`FilterBuilder`）。

---

## 后果 / 权衡

- **正面**：组件名如实反映领域模型层级（`ViewQuery` vs `Condition`），未来读者无需看实现即可判断组件粒度；与 `QueryToolbar`、`core/query` 的前缀一致。
- **负面**：目录内 `Query*` 与 `Filter*` 并存，不如「全 `Query*`」或「全 `Filter*`」统一。`FilterChip` 名虽准确，但与 `QueryChipBar` 同处一栏时字面不一致。
- **权衡取舍**：选择**准确性 > 表面一致性**。理由——`FilterChip` 改名 `QueryChip` 会直接违背其语义（它不是查询 chip，是筛选条件 chip）；而 `QueryChipBar` 改名 `FilterChipBar` 则掩盖其 query 级职责。两害相权，保留叶子组件的真实名、修正编排器的误称，是信息损失最小的解。
- **可还原性**：纯重命名，机械可回退；但改动已落地（含引用更新与测试文件改名），回退成本随引用扩散而上升，故记入本 ADR 以免反复摇摆。
