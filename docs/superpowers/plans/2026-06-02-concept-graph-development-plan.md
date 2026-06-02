# 概念图谱功能开发任务计划

> 版本：v1.0
> 日期：2026-06-02
> 状态：开发任务计划已完成

---

## 1. 方案评估摘要

### 1.1 评估结论

| 方面 | 评价 |
|------|------|
| **整体设计** | ⭐⭐⭐⭐ 优秀 - 渐进式设计，向后兼容 |
| **数据模型** | ⭐⭐⭐⭐ 良好 - 简洁扩展，需优化 |
| **语法设计** | ⭐⭐⭐⭐ 良好 - 清晰直观，有小问题 |
| **存储实现** | ⭐⭐⭐⭐ 良好 - 逻辑完整，需性能优化 |
| **可视化方案** | ⭐⭐⭐⭐ 良好 - 推荐使用 G6 |

### 1.2 关键发现

#### 优点
- 渐进式设计，降低实施风险
- 现有 `[[页面]]` 语法完全兼容
- 数据模型只新增 2 个字段
- 自动推断反向关系机制完善
- 文档详尽，代码示例完整

#### 需改进
1. **数据模型**：`inverseRelationshipType` 字段冗余，可移除
2. **正则表达式**：源文件正则和渲染正则需分开
3. **性能**：大数据量时需优化查询
4. **代码组织**：关系类型功能建议独立扩展

---

## 2. 开发任务计划

### Phase 1: 数据模型 + 语法解析（MVP）

#### 1.1 数据模型层
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 1.1.1 | `types/link.ts` | 扩展 Link/LinkRecord 接口 | P0 |
| 1.1.2 | `storage/db.ts` | 升级数据库版本 6→7 | P0 |
| 1.1.3 | `types/relationship.ts` | 新增预定义关系类型常量 | P0 |

#### 1.2 解析层
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 1.2.1 | `utils/parser.ts` | 扩展 LinkParse 接口 | P0 |
| 1.2.2 | `utils/parser.ts` | 修改 parseBlockLinks 函数 | P0 |
| 1.2.3 | `utils/parser.ts` | 实现 parseRelationshipPart 函数 | P0 |
| 1.2.4 | `utils/parser.test.ts` | 新增测试用例 | P1 |

#### 1.3 存储层
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 1.3.1 | `storage/indexedDB.ts` | 修改 saveLinks 方法 | P0 |
| 1.3.2 | `storage/indexedDB.ts` | 实现 createInverseLink 方法 | P0 |
| 1.3.3 | `storage/indexedDB.ts` | 实现 updateLinksWithRelationshipType | P1 |
| 1.3.4 | `storage/indexedDB.ts` | 实现 findExistingLinksToSource | P1 |
| 1.3.5 | `storage/indexedDB.ts` | 实现 createRootBlockWithLink | P1 |
| 1.3.6 | `storage/indexedDB.ts` | 新增查询方法 | P1 |

#### 1.4 同步机制
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 1.4.1 | `stores/blocks.ts` | 回车自动推断反向关系 | P0 |
| 1.4.2 | `composables/useRelationshipSync.ts` | 同页面内多链接同步 | P1 |
| 1.4.3 | - | 级联删除例外处理 | P1 |

#### 1.5 测试
| 任务 ID | 描述 | 优先级 |
|---------|------|--------|
| 1.5.1 | 数据模型单元测试 | P1 |
| 1.5.2 | 解析器测试 | P1 |
| 1.5.3 | 存储层测试 | P1 |

---

### Phase 2: 概念图谱可视化

#### 2.1 依赖安装
| 任务 ID | 描述 | 优先级 |
|---------|------|--------|
| 2.1.1 | 安装 @antv/g6 | P0 |

#### 2.2 组件开发
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 2.2.1 | `components/ConceptGraph.vue` | 概念图谱主组件 | P0 |
| 2.2.2 | `components/ConceptGraph.vue` | 图数据构建 | P0 |
| 2.2.3 | `components/ConceptGraph.vue` | 布局切换 | P1 |
| 2.2.4 | `components/ConceptGraph.vue` | 深度控制 | P1 |

#### 2.3 UI 集成
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 2.3.1 | `components/Page/index.vue` | 添加 ConceptGraph 组件 | P0 |
| 2.3.2 | `styles/components/_page.scss` | 侧边栏样式 | P1 |

#### 2.4 测试
| 任务 ID | 描述 | 优先级 |
|---------|------|--------|
| 2.4.1 | ConceptGraph 组件测试 | P1 |
| 2.4.2 | 可视化 E2E 测试 | P2 |

---

### Phase 3: 编辑器交互增强

#### 3.1 渲染层
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 3.1.1 | `extensions/WikiLinkExtension.ts` | 修改渲染正则 | P0 |
| 3.1.2 | `extensions/WikiLinkExtension.ts` | 关系类型颜色 | P0 |

#### 3.2 交互层
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 3.2.1 | `extensions/RelationshipTriggerExtension.ts` | 关系类型触发扩展 | P0 |
| 3.2.2 | `components/RelationshipMenu.vue` | 关系类型选择菜单 | P0 |
| 3.2.3 | `components/Editor.vue` | 编辑器集成 | P0 |
| 3.2.4 | - | 点击区域分离 | P0 |

#### 3.3 自定义关系类型
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 3.4.1 | `components/CustomRelationshipSettings.vue` | 自定义关系设置 | P1 |
| 3.4.2 | `components/Settings/SettingsModal.vue` | 设置面板集成 | P1 |
| 3.4.3 | `storage/indexedDB.ts` | 自定义关系存储 | P1 |
| 3.4.4 | `types/custom-relationship.ts` | 自定义关系数据模型 | P1 |

---

### Phase 4: 高级功能

#### 4.1 图谱交互
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 4.1.1 | `components/ConceptGraph.vue` | 节点点击跳转 | P1 |
| 4.1.2 | `components/ConceptGraph.vue` | 缩放拖拽 | P2 |
| 4.1.3 | `components/ConceptGraph.vue` | 悬停详情 | P2 |

#### 4.2 导出功能
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 4.2.1 | `utils/graphExport.ts` | PNG/SVG 导出 | P2 |
| 4.2.2 | `components/ConceptGraph.vue` | 导出按钮 | P2 |

#### 4.3 全库图谱
| 任务 ID | 文件 | 描述 | 优先级 |
|---------|------|------|--------|
| 4.3.1 | `views/GlobalGraph.vue` | 全库图谱视图 | P2 |
| 4.3.2 | `router/routes.ts` | 路由配置 | P2 |
| 4.3.3 | `components/Sidebar/SidebarNav.vue` | 导航入口 | P2 |

---

## 3. 文件修改汇总

### 新增文件
```
src/types/
├── relationship.ts                    # 预定义关系类型常量

src/composables/
├── useRelationshipSync.ts            # 同步机制

src/extensions/
├── RelationshipTriggerExtension.ts   # 关系类型触发

src/components/
├── RelationshipMenu.vue              # 关系类型菜单
├── CustomRelationshipSettings.vue    # 自定义关系设置
└── ConceptGraph.vue                  # 概念图谱可视化

src/utils/
└── graphExport.ts                    # 图谱导出

src/views/
└── GlobalGraph.vue                   # 全库图谱视图

src/types/
└── custom-relationship.ts           # 自定义关系类型
```

### 修改文件
```
src/types/
└── link.ts                           # Link 类型扩展

src/storage/
├── db.ts                            # 数据库版本升级
└── indexedDB.ts                      # 存储逻辑修改

src/utils/
└── parser.ts                        # 解析逻辑修改

src/extensions/
└── WikiLinkExtension.ts             # 渲染扩展

src/components/
├── Page/index.vue                    # 页面布局
└── Editor.vue                       # 编辑器集成
```

---

## 4. 实施顺序建议

### 建议 1：按 Phase 顺序实施
```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

### 建议 2：MVP 优先路径
如果需要快速验证，可以先实施：

1. **核心功能**（Phase 1.1-1.3）
   - 数据模型扩展
   - 语法解析
   - 基本存储

2. **可视化**（Phase 2）
   - 概念图谱展示

3. **交互增强**（Phase 3）
   - 菜单交互
   - 自定义关系

4. **高级功能**（Phase 4）
   - 按需实施

---

## 5. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据库迁移失败 | 高 | 添加迁移回滚机制 |
| 性能问题 | 中 | 添加查询索引，限制深度 |
| 编辑器冲突 | 中 | 独立扩展，避免修改现有代码 |
| G6 包体积大 | 低 | 按需加载，优化打包 |

---

## 6. 下一步行动

1. **确认任务计划** - 获取用户批准
2. **创建任务清单** - 在项目中创建任务追踪
3. **开始 Phase 1 实施** - 从数据模型开始

---

*文档生成时间：2026-06-02*
