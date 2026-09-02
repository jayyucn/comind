use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 阅读高亮（ADR-0040 D7）：阅读器态实体，text 供重绘/面板展示。
/// 仅桌面本地 —— 绝不注册进 SyncTable（D5 铁律）；写想法时才回填 block_id 关联笔记 Block。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookHighlight {
    pub id: String,
    pub book_page_id: String,
    pub cfi: String,
    pub text: String,
    pub chapter: String,
    pub color: String,            // 默认 'yellow'
    pub block_id: Option<String>, // 关联笔记 Block，可空（D7 可选升级）
    pub created_at: i64,
    pub updated_at: i64,
}

impl BookHighlight {
    pub fn new(book_page_id: &str, cfi: &str, text: &str, chapter: &str, color: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        BookHighlight {
            id: Uuid::new_v4().to_string(),
            book_page_id: book_page_id.to_string(),
            cfi: cfi.to_string(),
            text: text.to_string(),
            chapter: chapter.to_string(),
            color: if color.is_empty() { "yellow".to_string() } else { color.to_string() },
            block_id: None,
            created_at: now,
            updated_at: now,
        }
    }
}

/// 阅读进度（ADR-0040 D6）：上次位置的文字级 CFI 锚点，每书一行（book_page_id 主键）。
/// 排版参数变化不漂移；同高亮一样仅桌面本地。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookProgress {
    pub book_page_id: String,
    pub cfi: String,
    pub updated_at: i64,
}
