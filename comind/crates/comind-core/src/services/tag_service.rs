use regex::Regex;

pub struct TagService;

impl TagService {
    pub fn extract_tags(content: &str) -> Vec<String> {
        let re = Regex::new(r"#(\S+)").unwrap();
        re.find_iter(content)
            .map(|m| m.as_str()[1..].to_string())
            .collect()
    }
}