

---

## 下一步行动建议

### 📋 当前进度总结

**已完成：**
- ✅ 补充 Core 层缺失的高级方法（`getTrashedPageByTitle`、`updatePage`、`deletePage`、`mergePage`）
- ✅ 替换 `App.vue` 中的旧 storage 调用
- ✅ 替换 `stores/pages.ts` 中的旧 storage 调用（`mergePage`、`deletePage`）
- ✅ 替换 `stores/blocks.ts` 中的旧 storage 调用（`updatePage`）
- ✅ 构建验证通过

**剩余工作：**

| 任务 | 描述 | 优先级 |
|------|------|--------|
| **删除旧文件** | 删除 `src/services/property.ts`（已被 Core 层完全替代） | 🔴 高 |
| **更新测试 mock** | 更新 `stores/property.test.ts` 中的 mock（使其使用 Core 层） | 🟡 中 |
| **运行测试** | 运行单元测试和 e2e 测试验证 | 🟡 中 |

---

### 🎯 建议下一步

**删除旧的 `src/services/property.ts`** - 这个文件已经被 Core 的 `PropertyService` 完全替代，且没有任何业务代码依赖它（只有测试文件引用）。
