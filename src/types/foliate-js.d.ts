// foliate-js（npm 1.0.1）不带 TypeScript 类型声明，这里为其 epub.js 解析模块
// 提供本项目用到的最小类型面（按 node_modules/foliate-js/epub.js 实际 API 手写）。
// 覆盖导入链路（票 01）与阅读器链路（票 03：sections/toc/resolveHref/loadBlob）。

declare module 'foliate-js/epub.js' {
  /** EPUB 构造所需的 zip 加载层（loadText/loadBlob 返回 null 表示条目不存在） */
  export interface EPUBLoader {
    loadText: (uri: string) => string | null | Promise<string | null>
    loadBlob: (uri: string) => Blob | null | Promise<Blob | null>
    getSize: (uri: string) => number
  }

  /** OPF 元数据；title/author 为 webpub 形态：字符串、语言映射或贡献者对象/数组 */
  export interface EPUBMetadata {
    title?: string | Record<string, string>
    author?: unknown
    language?: string[] | string
    [key: string]: unknown
  }

  /**
   * 目录项（EPUB 3 nav / EPUB 2 NCX 统一形态，见 epub.js parseNav/parseNCX）：
   * label 为展示文本；href 为 zip 根相对路径（可带 #fragment）；subitems 为嵌套子目录。
   */
  export interface EPUBTOCItem {
    label?: string | null
    href?: string | null
    subitems?: EPUBTOCItem[] | null
  }

  /**
   * spine 章节（EPUB.sections 数组元素）。主文档自渲染（ADR-0040 D1）只用
   * createDocument()（返回按 mediaType 解析的章节 Document）与 id（zip 内路径，
   * 作为章节内相对引用的基准）；load/unload 供 foliate 整装 view.js 的 iframe 管理用，本项目不用。
   */
  export interface EPUBSection {
    /** manifest item 的 zip 内路径（已 resolve 为 zip 根相对） */
    id: string
    /** 解析章节 XHTML 为 Document（foliate 不做资源 URL 替换，由调用方处理） */
    createDocument(): Promise<Document>
    size?: number
    linear?: string | null
    cfi?: string
  }

  /** resolveHref 的返回：index 为 spine 下标，anchor 用于在章节内定位（书内链接锚点） */
  export interface EPUBResolvedHref {
    index: number
    anchor: (doc: Document) => Element | Range | 0 | null
  }

  export class EPUB {
    constructor(loader: EPUBLoader)
    /** 解析 container.xml/OPF/NCX，完成后返回自身；损坏文件抛错 */
    init(): Promise<EPUB>
    metadata: EPUBMetadata
    /** spine 章节列表（顺序即阅读顺序） */
    sections: EPUBSection[]
    /** 目录树（EPUB 3 nav 优先，回退 EPUB 2 NCX）；无目录时可能为 null/undefined */
    toc?: EPUBTOCItem[] | null
    /** 按 zip 内路径加载资源（图片等），条目不存在返回 null；内部经 encryption 解码 */
    loadBlob: (uri: string) => Blob | null | Promise<Blob | null>
    /** 提取封面（manifest cover-image 项）；无封面返回 null */
    getCover(): Promise<Blob | null>
    /** 书内链接（TOC/正文 href，zip 根相对，可带 #fragment）→ spine 下标 + 锚点；无法解析返回 null */
    resolveHref(href: string): EPUBResolvedHref | null
  }
}
