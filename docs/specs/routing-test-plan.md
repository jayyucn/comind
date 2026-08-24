# 路由系统测试计划

> 版本：v1.0
> 日期：2026-04-26
> 关联文档：[routing-design.md](../../docs/routing-design.md)

---

## 1. 测试目标

验证 routing-design.md 中定义的**验收标准**是否满足：

| # | 验收标准 | 测试类型 |
|---|---------|---------|
| 1 | URL 正确：打开日记列表 URL 为 `/journal`，打开 Page URL 为 `/page/:id` | E2E |
| 2 | 刷新恢复：在 `/page/abc` 刷新页面，仍停留在 `/page/abc`，数据完整 | E2E |
| 3 | 分享可用：复制的 URL 打开后直接进入对应视图 | E2E |
| 4 | Back/Forward：浏览器 back/forward 按钮切换视图，不丢状态 | E2E |
| 5 | 404 优雅：访问不存在的 `/page/xxx` 不会崩溃，重定向到 `/journal` | E2E |
| 6 | 无回归：现有 Sidebar 导航、Journal 入口、SlashCommand 导航均正常 | E2E |

---

## 2. 测试环境

- 运行命令：`npm run dev`
- 测试框架：Playwright (E2E)
- 基础 URL：`http://localhost:5173`

---

## 3. 测试用例

### TC-01：首页重定向

**步骤：**
1. 访问 `/`
2. 检查 URL 是否重定向到 `/journal`

**预期：**
- URL 变为 `/journal`
- 显示日记列表视图

### TC-02：日记列表路由

**步骤：**
1. 访问 `/journal`
2. 检查页面内容

**预期：**
- URL 为 `/journal`
- 显示 JournalList 组件
- 显示日记条目列表

### TC-03：日记页面路由

**步骤：**
1. 确保存在日记页面（如 `2026-04-26`）
2. 访问 `/journal/2026-04-26`
3. 检查页面内容

**预期：**
- URL 为 `/journal/2026-04-26`
- 显示 PageView 组件
- 页面标题显示 `2026-04-26`

### TC-04：普通页面路由

**步骤：**
1. 创建一个普通页面，记录其 pageId
2. 访问 `/page/{pageId}`
3. 检查页面内容

**预期：**
- URL 为 `/page/{pageId}`
- 显示 PageView 组件
- 页面标题正确显示

### TC-05：刷新恢复

**步骤：**
1. 访问任意页面 URL（如 `/page/xxx`）
2. 刷新页面
3. 检查 URL 和数据

**预期：**
- URL 保持不变
- 页面数据完整加载
- 编辑状态正常

### TC-06：浏览器历史（Back/Forward）

**步骤：**
1. 访问 `/journal`
2. 点击日记条目进入 `/journal/2026-04-26`
3. 点击浏览器 Back 按钮
4. 点击浏览器 Forward 按钮

**预期：**
- Back 后 URL 变为 `/journal`，显示日记列表
- Forward 后 URL 变为 `/journal/2026-04-26`，显示日记页面

### TC-07：404 优雅处理

**步骤：**
1. 访问不存在的页面 `/page/non-existent-id`
2. 检查页面行为

**预期：**
- 不崩溃
- 重定向到 `/journal` 或显示空页面
- 无 JavaScript 错误

### TC-08：Sidebar 导航

**步骤：**
1. 点击 Sidebar 中的"日记"入口
2. 点击 Sidebar 中的"最近"页面
3. 检查 URL 变化

**预期：**
- 点击"日记"后 URL 为 `/journal`
- 点击最近页面后 URL 正确（日记用 `/journal/xxx`，普通页用 `/page/xxx`）

### TC-09：WikiLink 导航

**步骤：**
1. 在 Block 中输入 `[[测试页面]]`
2. 点击生成的链接
3. 检查 URL 变化

**预期：**
- 页面导航正确
- URL 符合预期（日记用 `/journal/xxx`，普通页用 `/page/xxx`）

### TC-10：SlashCommand 创建页面

**步骤：**
1. 使用 SlashCommand 创建新页面
2. 检查是否正确导航到新页面

**预期：**
- 自动导航到新页面
- URL 正确

---

## 4. 自动化测试

测试文件位于：`e2e/routing.test.ts`

运行命令：
```bash
npx playwright test e2e/routing.test.ts
```

---

## 5. 测试报告

测试完成后，生成测试报告至：`e2e/routing-test-report.md`

---
