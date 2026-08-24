use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub block_id: String,
    pub page_id: String,
    pub page_title: String,
    pub content: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOptions {
    pub query: String,
    pub limit: Option<usize>,
}

impl SearchResult {
    pub fn new(block_id: &str, page_id: &str, page_title: &str, content: &str, score: f64) -> Self {
        SearchResult {
            block_id: block_id.to_string(),
            page_id: page_id.to_string(),
            page_title: page_title.to_string(),
            content: content.to_string(),
            score,
        }
    }
}