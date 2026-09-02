// foliate-js（npm 1.0.1）不带 TypeScript 类型声明，这里为其 epub.js 解析模块
// 提供本项目用到的最小类型面（按 node_modules/foliate-js/epub.js 实际 API 手写）。
// 只声明导入链路用到的方法，其余字段（sections/toc/rendition 等）由票 03 扩展。

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

  export class EPUB {
    constructor(loader: EPUBLoader)
    /** 解析 container.xml/OPF/NCX，完成后返回自身；损坏文件抛错 */
    init(): Promise<EPUB>
    metadata: EPUBMetadata
    /** 提取封面（manifest cover-image 项）；无封面返回 null */
    getCover(): Promise<Blob | null>
  }
}
