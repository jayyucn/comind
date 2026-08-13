# 通用查询引擎：字段注册表解耦，理想模型先行

Status: accepted

现有 `BlockQuery`（`src/types/blockQuery.ts`）的筛选能力绑死在 Block 实体上（`BlockField` 硬编码三种字段），无法复用于 Page 或未来实体。我们决定新建一个通用查询引擎：业务实体通过注册 **Field Descriptor**（key、label、数据类型、取值 getter）暴露可筛字段，引擎对实体完全无感知；引擎核心是无头纯 TS 模块（`src/core/query/`），不依赖 Vue/Pinia，内存求值，查询模型（ViewQuery = 条件组树 + 多键排序 + 单字段分组）为纯可序列化数据。完整规格见 `docs/2-architecture/generic-query-system.md`。

**Considered Options**

- *直接扩展 BlockQuery*：会让 Block 特有概念继续泄漏进每个新消费方，泛化成本随实体数增长。
- *SQL 下推到 WASM 层执行*：复杂度高一整个量级（查询翻译器 + 求值器双实现）；当前数据量级不需要。ViewQuery 纯数据化 + FieldDescriptor 可选 `path` 元数据，为日后下推预留了不破坏上层的通道。
- *新旧并存 vs 立即迁移*：选择**理想模型先行、暂不迁移旧代码**。代价是两套筛选语义并存一段时间——为此冻结旧模型的新增操作符，避免迁移成本滚雪球。旧扁平条件列表是新条件组树的退化形态，未来迁移无损。

**Consequences**

- savedFilter 的 WASM 持久化 API 无需改动（它存不透明 JSON 字符串）。
- 序列化带 `version: 1`，但迁移链机制暂缓——首个 v2 出现时才实现 migrate。
- 量级假设为千级以下（未经实测确认）；若出现万级实体，先优化求值器，十万级才回到本 ADR 重议下推。
