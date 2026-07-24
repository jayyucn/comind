# WebSocket 同步引擎 - 验证清单

## 代码编译检查
- [x] Checklist 1: `crates/comind-core` `cargo check` 通过
- [x] Checklist 2: `src-tauri` `cargo check` 通过
- [ ] Checklist 3: 前端 `npm run build` 通过（部分 TS 错误已存在，非本次修改引入）

## 单元测试检查
- [x] Checklist 4: LWW 合并测试通过（version 不同、version 相同 updated_at 不同、软删除优先）
- [x] Checklist 5: 消息序列化/反序列化测试通过
- [ ] Checklist 6: SyncState 表 CRUD 测试通过
- [ ] Checklist 7: debounce 合并逻辑测试通过

## 集成测试检查
- [ ] Checklist 8: 两台 SyncEngine 互发消息，数据一致
- [ ] Checklist 9: 全量同步集成测试通过（含循环 FK）
- [ ] Checklist 10: 离线编辑重连集成测试通过

## 功能验证检查
- [ ] Checklist 11: PC 端启动后显示 QR 码
- [ ] Checklist 12: Android 扫码后配对成功
- [ ] Checklist 13: 全量同步 - 7 张表数据一致（Block、Page、Link、Property、DateRef、RelationshipType、Template）
- [ ] Checklist 14: 实时同步 - PC 编辑 → Android 即时看到（< 500ms）
- [ ] Checklist 15: 实时同步 - Android 编辑 → PC 即时看到（< 500ms）
- [ ] Checklist 16: 软删除同步 - PC 删除 Block → Android 对应 Block 消失
- [ ] Checklist 17: 断线重连 → 双向全量同步 → 数据一致
- [ ] Checklist 18: 离线编辑不丢失 - Android 离线编辑 → 重连后 PC 收到
- [ ] Checklist 19: 定时全量校验 - 30 分钟后自动双向校验

## 安全验证检查
- [ ] Checklist 20: Server bind 到特定 LAN 接口（非 0.0.0.0）
- [ ] Checklist 21: 配对 token 速率限制生效（同一 IP 60s 内最多 3 次）
- [ ] Checklist 22: 配对成功后 QR 码立即销毁

## 性能验证检查
- [ ] Checklist 23: 全量同步单事务提交成功（无 FK 冲突）
- [ ] Checklist 24: 消息大小超限动态拆分成功
- [ ] Checklist 25: 心跳机制正常（30s ping / 90s timeout）

## MVP 验收标准
- [ ] Checklist 26: 所有验收标准（AC-1 至 AC-9）验证通过
- [ ] Checklist 27: MVP 多设备限制：已配对时不显示配对二维码按钮
- [ ] Checklist 28: config.json 持久化：重启后 client_id 保持不变
