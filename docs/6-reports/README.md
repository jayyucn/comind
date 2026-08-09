# 验证报告

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09

项目的测试报告和评估结果。

## 文档列表

| 文件 | 说明 |
| --- | --- |
| [project-evaluation-2026-05-11.md](project-evaluation-2026-05-11.md) | 项目评估报告 - 总体评估、问题清单、优化路线图 |
| [block-ordering-verification-report.md](block-ordering-verification-report.md) | 块排序验证报告 |
| [interaction-spec-verification-report.md](interaction-spec-verification-report.md) | 交互规格验证报告 |
| [v0-4-feature-verification-report.md](v0-4-feature-verification-report.md) | v0.4 功能验证报告 - 暗色主题、设置模态框、嵌入块重构 |

## 本时段新增测试覆盖（2026-08-08 ~ 08-09）

### Rust Core 层

本次重构未新增独立 `.rs` 测试文件（Service 层通过 TS 侧集成测试验证）。

### Vitest 单元测试（新增）

| 测试文件 | 覆盖模块 | 用例数（估算） |
| --- | --- | --- |
| `src/stores/__tests__/blockCard.test.ts` | BlockCard Store 缓存/脏标记 | ~30 |
| `src/stores/__tests__/taskView.test.ts` | TaskView 视图方案 CRUD | ~40 |
| `src/composables/__tests__/useBlockQuery.test.ts` | BlockQuery 过滤/排序/分组 | ~70 |
| `src/stores/edit-render-timing.test.ts` | 编辑/渲染时序 | ~40 |
| `src/stores/blocks-store.test.ts`（追加） | Block 保存流程重构 | ~20 新增 |
| `src/composables/useRelationshipSync.test.ts`（更新） | 关系同步 Rust→TS | ~20 更新 |
| `src/components/TaskHub/views/BoardView.test.ts` | BoardView 渲染/交互 | ~25 |
| `src/components/TaskHub/views/TableView.test.ts` | TableView 渲染/排序 | ~40 |
| `src/components/Block/handlers/bullet/BulletRender.test.ts` | Bullet 渲染段结构化 | ~25 |
| `src/composables/useBlockRelationshipCleanup.test.ts` | 关系清理 | ~15 |

### Playwright E2E 测试（现有基础上待补）

新增组件 TaskHub / BlockTaskList 暂无独立 spec 文件，建议后续补充：
- `taskhub-views.spec.ts`：Table/Board/Calendar 三视图切换 + 过滤
- `block-save-retry.spec.ts`：保存失败红点 + 点击重试

### 删除/迁移的测试

- ❌ `src/utils/parser.test.ts`（~30 用例）→ 逻辑迁移至 Rust `content_parse_service.rs`，测试策略变更
- ❌ `src/utils/quiet-hours.test.ts`（~25 用例）→ 逻辑迁移至 Rust `notification_service.rs`
- 🔄 `src/utils/date-ref.test.ts`（精简 ~80%）→ 主逻辑移至 Rust `date_parser.rs`
- 🔄 `src/composables/useContentRenderer.test.ts`（精简 ~60%）→ 渲染段结构化移至 Rust

### 质量指标（基线）

- Playwright 测试：10/10 通过（基线；新增组件待补）
- 单元测试：250+ 通过（新增 ~325 用例，迁移删除 ~55）
- npm audit：0 vulnerabilities
- `npm run build`：TypeScript 类型检查 + Vite 构建双通过（见 `.trae/rules/compilation-check.md`）
