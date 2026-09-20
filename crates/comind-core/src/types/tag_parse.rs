use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagParse {
    pub name: String,
    pub full_path: String,
    pub start: usize,
    pub end: usize,
}

impl TagParse {
    pub fn new(name: &str, full_path: &str, start: usize, end: usize) -> Self {
        TagParse {
            name: name.to_string(),
            full_path: full_path.to_string(),
            start,
            end,
        }
    }
}