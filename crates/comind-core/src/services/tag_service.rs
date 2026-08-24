use regex::Regex;
use std::sync::OnceLock;

pub struct TagService;

impl TagService {
    pub fn extract_tags(content: &str) -> Vec<String> {
        static RE: OnceLock<Regex> = OnceLock::new();
        let re = RE.get_or_init(|| Regex::new(r"#(\S+)").unwrap());
        re.find_iter(content)
            .map(|m| m.as_str()[1..].to_string())
            .collect()
    }
}