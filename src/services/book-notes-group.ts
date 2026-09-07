// 书 Page 笔记的章/节分组（ADR-0040 票 08 后续 / B 方案：结构=属性投影）。
// 笔记块写入时已由阅读器固化了归属快照：part = TOC 直接父级（章/卷层），
// chapter = 命中的最具体 TOC 条目（节/章层）。书 Page 侧不做任何 TOC 解析，
// 只按这两个属性把平铺的笔记块聚合成「章 → 节 → 笔记」大纲（视图投影，
// 不改块树、无只读概念）。分组数据供 BookNotesOutline 消费。
//
// 归一规则：
// - part 非空 → 两级（章 = part，节 = chapter）；part 空 → 一级（章 = chapter）
// - part 与 chapter 均空 → 无归属，丢弃（不进大纲，笔记仍在流中）
// - 顺序：保持输入（块流文档序），首现分组
export interface BookNoteMeta {
  blockId: string
  /** 章/卷层快照（TOC 直接父级），可空 */
  part: string
  /** 节/章层快照（命中的最具体 TOC 条目），可空 */
  chapter: string
  /** 高亮 CFI 锚点（跳回原文数据源），可空 */
  cfi: string | null
}

/** 分组内的定位锚点（点击滚动/跳回用的代表笔记） */
export interface NoteAnchor {
  blockId: string
  cfi: string | null
}

/** 节分组（二级） */
export interface NoteSectionGroup {
  title: string
  /** 该节笔记数 */
  count: number
  /** 该节第一条笔记（定位锚点） */
  first: NoteAnchor
}

/** 章分组（一级） */
export interface NoteChapterGroup {
  title: string
  /** 章内笔记总数（含各节） */
  count: number
  /** 章内第一条笔记（定位锚点，点击章行滚动目标） */
  first: NoteAnchor
  /** 二级节分组；单层（无 part）时为 [] */
  sections: NoteSectionGroup[]
}

/** 读取属性字符串值（Property 表 value 语义为字符串） */
function nonEmpty(v: string | null | undefined): string {
  return v?.trim() ?? ''
}

export function groupBookNotesByChapter(notes: BookNoteMeta[]): NoteChapterGroup[] {
  const chapters: NoteChapterGroup[] = []
  // 章 key → 章内各节 key 的锚点/计数（保持输入序）
  const chapterIndex = new Map<string, NoteChapterGroup>()

  for (const note of notes) {
    const part = nonEmpty(note.part)
    const chapter = nonEmpty(note.chapter)
    // 无归属笔记（无 TOC 的书）：不进大纲
    if (!part && !chapter) continue

    const anchor: NoteAnchor = { blockId: note.blockId, cfi: note.cfi }
    const key = part || chapter
    let group = chapterIndex.get(key)
    if (!group) {
      group = { title: key, count: 0, first: anchor, sections: [] }
      chapterIndex.set(key, group)
      chapters.push(group)
    }
    group.count++

    if (part) {
      // 两级：挂到该章下对应节（阅读器保证有 part 必有 chapter）
      let section = group.sections.find(s => s.title === chapter)
      if (!section) {
        section = { title: chapter, count: 0, first: anchor }
        group.sections.push(section)
      }
      section.count++
    }
    // 单层（part 空）：章即 chapter，直接挂在章下，无二级
  }

  return chapters
}
