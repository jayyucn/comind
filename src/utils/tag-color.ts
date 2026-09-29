/**
 * 标签配色单源（ADR-0050 D11）。
 *
 * 存库的是**调色板 token 名**（如 `--tag-color-3`），不是 hex —— 色值只在
 * `styles/tokens/_semantic.scss` 定义一处，本模块只管「有哪几色 + 怎么落到样式」。
 * 两边的名单由 `tag-color.test.ts` 的守卫用例锁死（直接读 SCSS 比对），防漂移。
 *
 * 三个消费面（正文内联 chip / 标签管理页 / 聚合页）共用本模块，不各写一份映射。
 */

/**
 * 调色板：**token 名 + 展示名**，数组顺序即选色器里的展示顺序。
 *
 * 第 1 位就是默认色 `--color-tag` 的取值来源（后者被收敛为它的别名），故「无色」
 * （`color = ''`）与「选色 1」观感一致。10 色为柔和语义色板（灰=默认 / 红=重要 / 橙=待办 /
 * 琥珀=提醒 / 绿=完成 / 青=信息 / 蓝=概念 / 紫=思考 / 粉=个人），避开 indigo 强调色系
 * （全板距 `--color-accent` 最近为蓝 20.6°、紫 24.1°，柔和蓝紫 vs 鲜艳强调色可辨）。
 *
 * 展示名只服务无障碍（`aria-label` / tooltip）：色点本身无法被读屏描述，而 token 名
 * 是开发者语汇，不能直接给用户看。
 */
export const TAG_COLORS = [
  { token: '--tag-color-1', label: '灰色' },
  { token: '--tag-color-2', label: '红色' },
  { token: '--tag-color-3', label: '橙色' },
  { token: '--tag-color-4', label: '琥珀色' },
  { token: '--tag-color-5', label: '黄绿色' },
  { token: '--tag-color-6', label: '绿色' },
  { token: '--tag-color-7', label: '青色' },
  { token: '--tag-color-8', label: '蓝色' },
  { token: '--tag-color-9', label: '紫色' },
  { token: '--tag-color-10', label: '洋红色' },
] as const

export type TagColorToken = (typeof TAG_COLORS)[number]['token']

/** 全部 token 名（顺序同上）。由 `TAG_COLORS` 派生，避免两份名单漂移。 */
export const TAG_COLOR_TOKENS: readonly TagColorToken[] = TAG_COLORS.map((c) => c.token)

/**
 * 是否合法调色板 token。**必须校验**：`color` 来自存储（跨设备同步 / 旧版本 / 手改 DB），
 * 且会经内联 `style` 落进 DOM —— 不白名单就等于把 CSS 注入面开给数据。
 */
export function isTagColorToken(value: unknown): value is TagColorToken {
  return typeof value === 'string' && (TAG_COLOR_TOKENS as readonly string[]).includes(value)
}

/**
 * 「胶囊」形态：文字取该色、底色取该色 10% 淡染。用于正文内联 chip 与继承区父标签 chip。
 * 空串 / 非法值 → `undefined`，消费方落回 CSS 默认（`.block-tag` 的 `--color-tag`）。
 *
 * 底色用 `color-mix` 现算而不再存一组 tint token —— 与本仓既有做法一致
 * （`views/TableView.vue` 的 `chipStyle`：字段元数据给的同样是 token 名而非字面色值）。
 */
export function tagChipStyle(color: string | null | undefined): Record<string, string> | undefined {
  if (!isTagColorToken(color)) return undefined
  return {
    color: `var(${color})`,
    background: `color-mix(in srgb, var(${color}) 10%, transparent)`,
  }
}

/**
 * 「圆点」形态：实心色点。用于标题类出现点（管理页左栏行、详情标题）—— 那儿把整行文字
 * 染色会盖过层级，一个色点足以自证身份。空串 / 非法值 → `undefined`（不渲染色，只留占位）。
 */
export function tagDotStyle(color: string | null | undefined): Record<string, string> | undefined {
  if (!isTagColorToken(color)) return undefined
  return { color: `var(${color})` }
}
