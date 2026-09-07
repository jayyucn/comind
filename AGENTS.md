# AGENT.md

减少大语言模型常见编码错误的行为准则。可根据需要与项目专属规范合并使用。
**取舍原则**：本准则优先稳妥而非追求速度。简单琐碎任务可灵活酌情处理。

## 1. 编码前先思考
**不做主观臆断，不掩饰疑惑，明确列出方案取舍。**
着手实现前：
- 清晰列明自身预设条件，存在不确定之处及时提问。
- 若存在多种解读方式，全部列出，切勿自行默认选定一种。
- 若有更简洁的实现方式，主动提出，必要时合理拒绝冗余方案。
- 遇到模糊不清的需求立刻暂停，明确指出疑惑点并进行询问。
## 2. 简约优先原则

**用最少代码解决问题，不做无依据的冗余设计。**
- 不额外实现需求以外的功能。
- 一次性使用的代码不做抽象封装。
- 不添加未被要求的灵活性和可配置性设计。
- 不为不可能出现的场景编写异常处理逻辑。
- 若写出200行代码却可用50行实现，主动重构精简。
自我审视：资深工程师是否会认为这段代码过度复杂？若是，立即简化。
## 3. 精准限定修改范围
**只改动必要代码，仅清理自身改动产生的冗余内容。**
修改已有代码时：
- 不擅自优化周边代码、注释及代码格式。
- 不对无故障的代码进行重构。
- 遵循项目现有编码风格，即便自身写法存在差异也保持统一。
- 发现无关的无效代码仅作标注，不擅自删除。
自身改动产生冗余无用内容时：
- 删除因自身修改而变得无用的导入项、变量及函数。
- 未经许可，不删除原本就存在的无效代码。
校验标准：每一行修改的代码都必须直接对应用户需求。
## 4. 目标导向执行

**明确验收标准，循环迭代直至验证通过。**
将任务转化为可验证目标：
- “新增校验逻辑”→“编写非法输入测试用例，再调整代码使测试通过”
- “修复漏洞”→“编写可复现漏洞的测试用例，再调整代码修复问题”
- “重构模块X”→“确保重构前后所有测试用例均可正常通过”
多步骤任务需先列出简要执行规划：
```
1. [步骤] → 验证：[校验项]
2. [步骤] → 验证：[校验项]
3. [步骤] → 验证：[校验项]
```
清晰的验收标准可自主循环推进任务，模糊标准（如“实现可用即可”）则需要反复沟通确认。
***
**准则生效判定**：代码差异中无效改动减少、因设计过度复杂导致的返工变少、疑惑询问均在编码前提出，而非出错后补救。

## 样式约定：z-index

详见 `docs/adr/0012-z-index-layering.md`，两条铁律：

1. **禁止组件内硬编码 z-index**：一律用 `var(--z-*)`（组件 scoped 样式，定义于 `src/styles/tokens/_semantic.scss`）或 `$z-*`（全局 SCSS，定义于 `src/styles/tokens/_primitives.scss`，需 `@use`）。
2. **浮层必须 Teleport 到 body**：渲染在 `transform/filter/backdrop-filter/opacity<1` 祖先内的浮层，z-index 会困于局部堆叠上下文而失效（已知陷阱：`.block-children` 的 `translateY(0)`）。

## 代理技能

### 问题追踪（Issue tracker）

Issue 以 GitHub issue 形式存放在 `jayyucn/comind` 中（使用 `gh` CLI）。参见 `docs/agents/issue-tracker.md`。

### 分流标签（Triage labels）

五个标准标签（`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`），按原样使用。参见 `docs/agents/triage-labels.md`。

### 领域文档（Domain docs）

单一上下文约定：仓库根目录一份 `CONTEXT.md` + `docs/adr/`。参见 `docs/agents/domain.md`。

## graphify（知识图谱）

本项目在 graphify-out/ 中维护知识图谱，包含 God Nodes、社区结构和跨文件关系。

凡涉及本代码库的问题，graphify skill 应自动加载；若未加载，回答前需显式加载。该 skill 安装在用户级目录（`~/.workbuddy/skills/graphify`）。

规则：
- 代码库问题的默认路径：无论用户问“某功能如何工作”“谁调用/使用了什么”“某符号定义在哪里”，还是本仓库的架构 / 文件关系，都必须先加载 graphify skill 并运行 `graphify query "<问题>"`（或 `graphify path "<A>" "<B>"` / `graphify explain "<概念>"`），之后才可 grep、Explore 或读源码——仅当 graphify 无结果时才回退到这些方式。前提：`graphify-out/graph.json` 存在。
- graphify-out/ 出现脏文件属正常现象（hook 或增量更新后产生）；脏图谱文件不是跳过 graphify 的理由。仅当任务本身涉及图谱过期或错误、或用户明确要求不使用时才跳过。
- 若 graphify-out/wiki/index.md 存在，做广泛导航时优先使用它，而不是直接浏览源码。
- 仅当 query/path/explain 未提供足够上下文时，才通读 graphify-out/GRAPH_REPORT.md 做整体架构审阅。
- 修改代码后运行 `graphify update .`，保持图谱最新（仅 AST，无 API 成本）。

## codegraph（符号级索引）

本仓库的符号级索引（数据在 `.codegraph/`；当前 561 个文件 / 8,050 个符号节点 / 18,176 条边）。精确回答“某符号定义在哪里 / 谁引用了它 / 哪些测试可能受影响”。全局安装为 `codegraph`（npm 包 `@colbymchenry/codegraph`）；通过 CLI 驱动——其 MCP server 可能在本机运行，但未注册到本 agent。

- `codegraph context "<任务>"` — 汇总与任务相关的文件 + 关键代码片段（markdown 输出）。读代码前用它收窄改动面。
- `codegraph query "<符号>" -k <类型>` — 定位符号的定义与引用（类型：function、class、component 等）。符号名不一定与 graphify 一致（例如 `useBlockStore` 出现在 graphify 的 God Nodes 中，但不在 codegraph 索引里）——跨工具未命中时换词重试。
- `codegraph affected <文件...>` — 列出受改动影响的测试文件；运行这些测试。
- `codegraph sync` — 编辑后增量重建索引（保持符号层新鲜）。
- `codegraph status` — 索引统计 / 新鲜度（“Index is up to date”）。

## 两层导航（codegraph + graphify）

- 精确层 — codegraph：符号、导入、影响面分析、任务上下文（“在哪 / 改什么会坏 / 要碰哪些文件”）。
- 战略层 — graphify：文件间及跨文档关系、社区、God Nodes（“模块之间如何连接 / 整体架构长什么样”）。遵循上文 graphify 规则。

编码任务的推荐循环：
1. `codegraph context "<任务>"` → 收窄改动面。
2. `graphify query "<问题>"` 或 `graphify path "A" "B"` → 编辑前先理解跨模块联系。
3. 修改代码。
4. `codegraph affected <文件>` → 运行受影响的测试；`codegraph sync` → 刷新符号索引。
5. `graphify update .` → 重建战略层图谱。
6. 当 graphify 暴露出意外关联时，用 `codegraph query "<符号>" -k <类型>` 定位到确切的定义 / 引用点。

口径说明：codegraph 只统计代码文件（561）；graphify 还索引文档（744）——统计范围不同，不矛盾。`graphify update` 不需要 LLM；`graphify label` / 完整管线需要。
