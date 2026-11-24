//! 行内代码是**字面文本**。
//!
//! 前端把行内格式存进 `block.format.inlineMarks`（一组互不重叠的区间，偏移为
//! **UTF-16 码元**，与 JS `String.prototype.slice` 同口径）。其中 `code: true`
//! 的区间对应 markdown 的单反引号代码段：里面的 `#tag` / `[[页面]]` / `@日期` /
//! `key:: value` 都是**要原样显示的文字**，不得参与任何派生解析
//! （不打标、不建页、不建提醒、不写字段值、不渲染 chip）。
//!
//! 正文本身是纯文本，所以屏蔽的做法是「把代码区间按**字节等长**换成空格」再交给
//! 各解析器：所有 span / position / `find` 的字节坐标在掩码前后一一对应，消费者
//! 无需换算。

use serde_json::Value;

/// 行内代码区间的字节范围（左闭右开）。
///
/// `format` 是 `block.format` 的 JSON 文本；`content` 用来把 UTF-16 偏移换成字节偏移。
pub fn code_byte_ranges(format: Option<&str>, content: &str) -> Vec<(usize, usize)> {
    let Some(raw) = format else {
        return Vec::new();
    };
    // 绝大多数块没有行内代码：先做廉价的子串判断，省掉打字路径上每次保存的 JSON 解析
    if !raw.contains("\"code\"") {
        return Vec::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(marks) = value.get("inlineMarks").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for mark in marks {
        if mark.get("code").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let start = mark.get("start").and_then(Value::as_u64).unwrap_or(0) as usize;
        let end = mark.get("end").and_then(Value::as_u64).unwrap_or(0) as usize;
        if end <= start {
            continue;
        }
        let byte_start = utf16_to_byte(content, start);
        let byte_end = utf16_to_byte(content, end);
        if byte_end > byte_start {
            ranges.push((byte_start, byte_end));
        }
    }
    ranges.sort_unstable();
    ranges
}

/// 把覆盖到的字符替换成**等字节数**的空格。
///
/// 等长保证下游的字节偏移（tag span、link position、dateRef 的 `find` 结果）与原文
/// 一一对应；一个 3 字节汉字被换成 3 个空格，坐标不动。
pub fn mask_ranges<'a>(content: &'a str, ranges: &[(usize, usize)]) -> std::borrow::Cow<'a, str> {
    if ranges.is_empty() || content.is_empty() {
        return std::borrow::Cow::Borrowed(content);
    }

    let mut masked = String::with_capacity(content.len());
    let mut cursor = 0usize;
    for ch in content.chars() {
        let start = cursor;
        let end = cursor + ch.len_utf8();
        cursor = end;
        if ranges.iter().any(|&(s, e)| s < end && e > start) {
            for _ in 0..ch.len_utf8() {
                masked.push(' ');
            }
        } else {
            masked.push(ch);
        }
    }
    std::borrow::Cow::Owned(masked)
}

/// 派生解析的「可见文本」：把行内代码区间掩成空格。
pub fn visible_text<'a>(content: &'a str, format: Option<&str>) -> std::borrow::Cow<'a, str> {
    let ranges = code_byte_ranges(format, content);
    if ranges.is_empty() {
        return std::borrow::Cow::Borrowed(content);
    }
    mask_ranges(content, &ranges)
}

/// UTF-16 码元偏移 → UTF-8 字节偏移（越界夹到末尾）。
fn utf16_to_byte(content: &str, offset: usize) -> usize {
    let mut utf16 = 0usize;
    for (byte_idx, ch) in content.char_indices() {
        if utf16 >= offset {
            return byte_idx;
        }
        utf16 += ch.len_utf16();
    }
    content.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn format_with_code(start: usize, end: usize) -> String {
        format!(
            r#"{{"inlineMarks":[{{"start":{start},"end":{end},"code":true}}]}}"#
        )
    }

    /// 字节下标 → UTF-16 码元下标（`format` 里是后者）
    fn utf16_of(content: &str, byte_idx: usize) -> usize {
        content[..byte_idx].chars().map(|c| c.len_utf16()).sum()
    }

    /// 用**字节**下标构造 format（内部换成 UTF-16，测试读起来直观）
    fn format_from_bytes(content: &str, start: usize, end: usize) -> String {
        format_with_code(utf16_of(content, start), utf16_of(content, end))
    }

    #[test]
    fn no_format_means_no_ranges() {
        assert!(code_byte_ranges(None, "a `b` c").is_empty());
        assert!(code_byte_ranges(Some("{}"), "a `b` c").is_empty());
    }

    #[test]
    fn picks_only_code_marked_ranges() {
        let format = r#"{"inlineMarks":[{"start":0,"end":1,"bold":true},{"start":2,"end":3,"code":true}]}"#;
        assert_eq!(code_byte_ranges(Some(format), "ab cd"), vec![(2, 3)]);
    }

    #[test]
    fn converts_utf16_offsets_to_bytes() {
        // "中文abc"：两个汉字各 3 字节 / 1 码元；`abc` 在 UTF-16 [2,5) → 字节 [6,9)
        // "中文abc"：`abc` 的字节区间 [6,9)，UTF-16 区间 [2,5)
        let format = format_with_code(2, 5);
        assert_eq!(code_byte_ranges(Some(&format), "中文abc"), vec![(6, 9)]);
    }

    #[test]
    fn mask_keeps_byte_length_and_offsets() {
        let content = "前 #tag 后";
        let start = content.find("#tag").unwrap();
        let masked = mask_ranges(content, &[(start, start + 4)]);
        assert_eq!(masked.len(), content.len());
        // `#tag` 4 字节 → 4 空格；两侧原有空格保留
        assert_eq!(masked.as_ref(), format!("前{}后", " ".repeat(6)));
        // 保留的字符位置不变
        assert_eq!(masked.rfind('后'), content.rfind('后'));
    }

    #[test]
    fn visible_text_masks_hashtags_and_links() {
        let content = "看 `#not_a_tag` 和 #real";
        let start = content.find('`').unwrap();
        let end = content.rfind('`').unwrap() + 1;
        let format = format_from_bytes(content, start, end);
        let visible = visible_text(content, Some(&format));
        assert!(!visible.contains("#not_a_tag"));
        assert!(visible.contains("#real"));
        assert_eq!(visible.len(), content.len());
    }

    #[test]
    fn multibyte_inside_code_is_padded_by_byte_length() {
        let content = "a`中文`b";
        let start = content.find('`').unwrap();
        let end = content.rfind('`').unwrap() + 1;
        let format = format_from_bytes(content, start, end);
        let visible = visible_text(content, Some(&format));
        assert_eq!(visible.len(), content.len());
        // 两个反引号各 1 字节、两个汉字各 3 字节 → 8 个空格
        assert_eq!(visible.as_ref(), format!("a{}b", " ".repeat(8)));
    }

    #[test]
    fn invalid_format_is_ignored() {
        assert!(code_byte_ranges(Some("not json"), "a `b` c").is_empty());
    }
}
