import type { TableConfig } from '../../../../core/view'

/**
 * 旧配置兼容：早于「内容/页面/更新时间」默认列的查询块，落库的 `页面` 列是任务中心那套
 * `role: 'link'`（只画一个定位图钉，读不出页名，也谈不上跳转）。这里在**内存层**把它
 * 归一成 `cell: 'source-page'`（渲染页标题 + 整格可点跳转），不写库——用户下次拖列宽时
 * 自然带新 config 落盘。放在渲染链而非迁移脚本，是因为每个块的 config 都可能被手改过。
 *
 * 返回同一引用（未命中任何需要归一的列）时，调用方可据此跳过重算。
 */
export function normalizePageColumn(config: TableConfig): TableConfig {
  let touched = false
  const columns = config.columns.map((col) => {
    if (col.key !== 'page' || col.cell) return col
    touched = true
    return { ...col, cell: 'source-page', role: undefined }
  })
  return touched ? { ...config, columns } : config
}
