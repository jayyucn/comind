# Phase 3.5 - 版本化系统 - 验证检查清单

## 版本化系统后端
- [ ] Checkpoint 1: G2 快照格式稳定（字段顺序固定，SHA-256 哈希可重复）
- [ ] Checkpoint 2: G2 快照内容完整（Block 本体 + Property 列表 + 出向 Link 列表）
- [ ] Checkpoint 3: SQLite block_versions 表正确创建（含索引）
- [ ] Checkpoint 4: BlockVersionRepository CRUD 操作正常
- [ ] Checkpoint 5: BlockVersionService create/list/restore/cleanup 功能完整
- [ ] Checkpoint 6: 前向 restore 正确（创建新版本，restored_from 字段正确，更新时间为当前时间）
- [ ] Checkpoint 7: Restore 时 Property 正确恢复（删除当前，创建快照中的）
- [ ] Checkpoint 8: Restore 时只恢复目标 Page 仍存在的 Links
- [ ] Checkpoint 9: 分层保留清理任务按策略执行（应用启动 + 每6小时定时）
- [ ] Checkpoint 10: Tauri 版本化命令正确调用 Rust service
- [ ] Checkpoint 11: CoreClient 版本化方法接口完整（TauriClient + WasmClientAdapter）
- [ ] Checkpoint 12: Web 端 IndexedDB 版本存储正常（Dexie）
- [ ] Checkpoint 13: 哈希去重逻辑正确（相同快照不重复创建版本）

## 双层防抖架构
- [ ] Checkpoint 14: Layer 1 落盘防抖（2秒尾部防抖）正常工作
- [ ] Checkpoint 15: Layer 2 快照冷却（3分钟间隔锁）正常工作
- [ ] Checkpoint 16: 快照豁免规则生效（退出/手动/重大操作 bypass 冷却）
- [ ] Checkpoint 17: 配置项支持（落盘防抖阈值、快照冷却间隔、保留窗口）
- [ ] Checkpoint 18: 30秒极限节流（持续编辑超过30秒强制落盘）正常工作

## 版本化 UI
- [ ] Checkpoint 19: BlockHistoryButton hover 入口显示正确
- [ ] Checkpoint 20: 快捷键 Cmd/Ctrl + H 可用
- [ ] Checkpoint 21: BlockHistoryDrawer 右侧抽屉滑出流畅
- [ ] Checkpoint 22: 版本列表显示完整（时间戳、source、message、restored_from）
- [ ] Checkpoint 23: 文本 diff 渲染正确（红绿对比）
- [ ] Checkpoint 24: 属性变更 diff 渲染正确（行级）
- [ ] Checkpoint 25: 关系变更 diff 渲染正确（行级）
- [ ] Checkpoint 26: Restore 操作流程完整（按钮 → 确认 → toast → 跳转）
- [ ] Checkpoint 27: 悬空关系标红显示（is-dangling class + "已删除"标签）
- [ ] Checkpoint 28: 抽屉打开时横向布局适配（GraphView 自动收起）

## 测试与集成
- [ ] Checkpoint 29: 单元测试全部通过
- [ ] Checkpoint 30: 集成测试全部通过
- [ ] Checkpoint 31: E2E 测试覆盖版本化关键流程
- [ ] Checkpoint 32: 编译检查通过（npm run build）
- [ ] Checkpoint 33: 前端功能验证通过
- [ ] Checkpoint 34: 浏览器日志无错误
