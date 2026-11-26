//! 网页链接块的元数据抓取（ADR-0066 D3）。
//!
//! 前端发不出这个请求：Tauri CSP 的 `connect-src` 回落到 `default-src 'self'`
//! 会拦掉一切跨源 `fetch`，dev/网页端还叠一层 CORS。所以抓取只能落在 Rust 侧。
//!
//! 约定：**失败是常态分支**，返回的错误码是 `network` / `status` / `timeout` / `decode`
//! 四个之一，由前端渲染成卡片上的确定文案；不抛带堆栈的错误。
//! favicon 与封面在这里直接落进 workspace assets（前端 `asset://<id>` 引用），
//! 好处是不用过 IPC 传图片字节，且离线回看时卡片不裂图。

use std::time::Duration;

use serde::Serialize;
use url::Url;

use crate::assets::{read_asset_manifest, write_asset_manifest, AssetMeta};

/// 抓取超时。抓不完就当失败，不能让卡片一直挂着加载态。
const FETCH_TIMEOUT: Duration = Duration::from_secs(12);
/// 封面体积上限：超过就放弃（避免把几十 MB 的图塞进笔记库）
const MAX_COVER_BYTES: usize = 4 * 1024 * 1024;
const MAX_ICON_BYTES: usize = 256 * 1024;
/// 部分站点对无 UA 的请求直接 403
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

pub const ERR_NETWORK: &str = "network";
pub const ERR_STATUS: &str = "status";
pub const ERR_TIMEOUT: &str = "timeout";
pub const ERR_DECODE: &str = "decode";

#[derive(Debug, Clone, Serialize)]
pub struct WebLinkMetadata {
    pub final_url: String,
    pub domain: String,
    pub title: Option<String>,
    pub desc: Option<String>,
    pub site_name: Option<String>,
    pub icon_asset_id: Option<String>,
    pub cover_asset_id: Option<String>,
}

/// 抓取 + 落资产。`assets_dir` 由调用方给出（与 `save_asset_file` 同一目录）。
pub async fn fetch_metadata(url: &str, assets_dir: &std::path::Path) -> Result<WebLinkMetadata, String> {
    let parsed = Url::parse(url).map_err(|_| ERR_DECODE.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(ERR_DECODE.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| ERR_NETWORK.to_string())?;

    let response = client.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            ERR_TIMEOUT.to_string()
        } else {
            ERR_NETWORK.to_string()
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        // 站点主动拒绝（403/404/5xx）与「站点不可达」是两种可见结果，错误码要分开
        return Err(ERR_STATUS.to_string());
    }

    let final_url = response.url().to_string();
    let charset_header = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .and_then(charset_from_content_type)
        .map(|s| s.to_string());
    let bytes = response.bytes().await.map_err(|e| {
        if e.is_timeout() {
            ERR_TIMEOUT.to_string()
        } else {
            ERR_DECODE.to_string()
        }
    })?;
    // 不能直接用 `response.text()`：它只认 `Content-Type` 里的 charset，缺省按 UTF-8，
    // 于是 GBK 站点（`Content-Type: text/html` + `<meta charset=gb2312>`）整段变乱码。
    // 中文站点里这种组合很常见，必须先嗅探再解码。
    let html = decode_html(&bytes, charset_header.as_deref());

    let head = PageHead::parse(&html);

    let icon_url = head
        .icon_href
        .as_deref()
        .and_then(|href| join(&final_url, href))
        .or_else(|| {
            let host = Url::parse(&final_url).ok()?.host_str()?.to_string();
            Some(format!("https://{}/favicon.ico", host))
        });

    let cover_url = head.cover_href.as_deref().and_then(|href| join(&final_url, href));

    let icon_asset_id = match icon_url.as_deref() {
        Some(u) => download_asset(&client, u, "wl-icon", MAX_ICON_BYTES, assets_dir).await,
        None => None,
    };
    let cover_asset_id = match cover_url.as_deref() {
        Some(u) => download_asset(&client, u, "wl-cover", MAX_COVER_BYTES, assets_dir).await,
        None => None,
    };

    let domain = Url::parse(&final_url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string()))
        .unwrap_or_default();

    Ok(WebLinkMetadata {
        final_url,
        domain,
        title: head.title.or(head.og_title),
        desc: head.desc.or(head.og_desc),
        site_name: head.site_name,
        icon_asset_id,
        cover_asset_id,
    })
}

/// 字节 → 字符串。charset 依次取「响应头 → `<meta>` 声明 → BOM → UTF-8 兜底」。
fn decode_html(bytes: &[u8], header_charset: Option<&str>) -> String {
    let label = header_charset
        .and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes()))
        .or_else(|| encoding_rs::Encoding::for_bom(bytes).map(|(enc, _)| enc))
        .or_else(|| {
            sniff_meta_charset(bytes).and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes()))
        });
    match label {
        Some(enc) => enc.decode(bytes).0.into_owned(),
        None => String::from_utf8_lossy(bytes).into_owned(),
    }
}

/// `text/html; charset=gbk` / `charset="gb2312"` → `gbk` / `gb2312`
fn charset_from_content_type(value: &str) -> Option<&str> {
    let lower = value.to_ascii_lowercase();
    let start = lower.find("charset=")? + "charset=".len();
    let rest = value[start..].trim_start_matches(['"', '\'', ' ']);
    let end = rest
        .find(|c: char| c == ';' || c == '"' || c == '\'' || c.is_ascii_whitespace())
        .unwrap_or(rest.len());
    let label = &rest[..end];
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

/// 从文档开头找 `<meta charset=...>` 或 `<meta http-equiv content="text/html; charset=...">`。
///
/// 只扫前 8KB：声明按规范必须落在 `<head>` 早期，扫全文是浪费，还可能撞到正文里被
/// 转义前的示例代码。
fn sniff_meta_charset(bytes: &[u8]) -> Option<String> {
    let window = &bytes[..bytes.len().min(8192)];
    let text = String::from_utf8_lossy(window).to_ascii_lowercase();
    let mut from = 0usize;
    while let Some(rel) = text[from..].find("charset=") {
        let start = from + rel + "charset=".len();
        from = start;
        let rest = text[start..].trim_start_matches(['"', '\'', ' ']);
        let end = rest
            .find(|c: char| c == ';' || c == '"' || c == '\'' || c == '>' || c == '/' || c.is_ascii_whitespace())
            .unwrap_or(rest.len());
        let label = rest[..end].trim().to_string();
        if !label.is_empty() {
            return Some(label);
        }
    }
    None
}

fn join(base: &str, href: &str) -> Option<String> {
    if href.starts_with("data:") {
        return None;
    }
    Url::parse(base).ok()?.join(href).ok().map(|u| u.to_string())
}

/// 下载并登记为 asset。任何失败都返回 None —— 图缺失不影响卡片成立。
async fn download_asset(
    client: &reqwest::Client,
    url: &str,
    prefix: &str,
    limit: usize,
    assets_dir: &std::path::Path,
) -> Option<String> {
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    // 只收图片：防盗链站点常回一个 HTML 错误页，存下来就是裂图
    let ext = match content_type.split(';').next().unwrap_or("").trim() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/x-icon" | "image/vnd.microsoft.icon" => "ico",
        "image/avif" => "avif",
        _ => return None,
    };
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > limit {
        return None;
    }

    let id = format!("{}-{}", prefix, uuid::Uuid::new_v4().simple());
    std::fs::create_dir_all(assets_dir).ok()?;
    let file_name = format!("{}.{}", id, ext);
    std::fs::write(assets_dir.join(&file_name), &bytes).ok()?;

    let mut manifest = read_asset_manifest(assets_dir).ok()?;
    manifest.insert(
        id.clone(),
        AssetMeta {
            file: file_name,
            name: format!("{}.{}", prefix, ext),
            mime_type: content_type.split(';').next().unwrap_or("").trim().to_string(),
            created_at: now_millis(),
        },
    );
    write_asset_manifest(assets_dir, &manifest).ok()?;
    Some(id)
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// `<head>` 里我们关心的那几项。手写扫描而不是引入 HTML 解析器：
/// 只取 title 与 meta/link 标签属性，DOM 树本身毫无用处，多一个重量级依赖不值得。
#[derive(Debug, Default, PartialEq)]
struct PageHead {
    title: Option<String>,
    og_title: Option<String>,
    desc: Option<String>,
    og_desc: Option<String>,
    site_name: Option<String>,
    icon_href: Option<String>,
    cover_href: Option<String>,
}

impl PageHead {
    fn parse(html: &str) -> Self {
        let mut head = PageHead::default();

        // title 必须从整串取：下面的循环按 `<` 切段，正文里的结束标签已被切走
        if let Some(start) = find_ascii_ci(html, "<title") {
            let after = &html[start + "<title".len()..];
            if let Some(gt) = after.find('>') {
                let body = &after[gt + 1..];
                if let Some(end) = find_ascii_ci(body, "</title") {
                    head.title = clean(&body[..end]);
                }
            }
        }

        for tag in html.split('<').skip(1) {
            let name = tag_name(tag);
            if name.eq_ignore_ascii_case("meta") {
                let key = attr(tag, "property")
                    .or_else(|| attr(tag, "name"))
                    .map(|v| v.to_lowercase());
                let content = attr(tag, "content");
                let (Some(key), Some(content)) = (key, content) else {
                    continue;
                };
                match key.as_str() {
                    "og:title" => {
                        head.og_title.get_or_insert(content);
                    }
                    "og:description" => {
                        head.og_desc.get_or_insert(content);
                    }
                    "description" => {
                        head.desc.get_or_insert(content);
                    }
                    "og:site_name" => {
                        head.site_name.get_or_insert(content);
                    }
                    "og:image" | "twitter:image" | "twitter:image:src" => {
                        head.cover_href.get_or_insert(content);
                    }
                    _ => {}
                }
            } else if name.eq_ignore_ascii_case("link") {
                let rel = attr(tag, "rel").map(|v| v.to_lowercase()).unwrap_or_default();
                if rel.split_whitespace().any(|r| r == "icon" || r == "shortcut") {
                    if let Some(href) = attr(tag, "href") {
                        if head.icon_href.is_none() {
                            head.icon_href = Some(href);
                        }
                    }
                }
            }
        }

        head
    }
}

/// 标签名：`<meta name=...>` 里的 `meta`（`<` 已被 split 吃掉）
fn tag_name(tag: &str) -> &str {
    let end = tag
        .find(|c: char| c.is_ascii_whitespace() || c == '>' || c == '/')
        .unwrap_or(tag.len());
    &tag[..end]
}

/// ASCII 大小写不敏感的子串查找，返回字节下标
fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()].eq_ignore_ascii_case(n))
}

/// 取标签上的某个属性值。
///
/// 支持三种现实写法：`name="v"`、`name='v'`、**`name=v`（无引号，HTML5 合法）**。
/// 最后一种是中文站点的常见写法（实测 996m2.com 的 `description` 全是无引号），
/// 早先只认引号会把它们整条漏掉。
///
/// 按字节扫描而不是把整段 `to_lowercase()` 再切片：标签里混入非 ASCII 文本时，
/// 小写化会改变字节长度，用同一组下标去切原文会切在非法 char 边界上。
fn attr(tag: &str, name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let needle = name.as_bytes();
    if needle.is_empty() || bytes.len() < needle.len() {
        return None;
    }
    for i in 0..=bytes.len() - needle.len() {
        if !bytes[i..i + needle.len()].eq_ignore_ascii_case(needle) {
            continue;
        }
        // 必须是独立属性名（前面是空白），否则 `og:image` 会被 `image` 命中
        if i != 0 && !bytes[i - 1].is_ascii_whitespace() {
            continue;
        }
        let mut j = i + needle.len();
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'=' {
            continue;
        }
        j += 1;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() {
            return None;
        }
        let quote = bytes[j];
        if quote == b'"' || quote == b'\'' {
            let body = &tag[j + 1..];
            return body.find(quote as char).map(|end| &body[..end]).and_then(clean);
        }
        // 无引号：值到空白或 `>` 为止
        let body = &tag[j..];
        let end = body
            .find(|c: char| c.is_ascii_whitespace() || c == '>')
            .unwrap_or(body.len());
        return clean(&body[..end]);
    }
    None
}

/// 去标签、压空白、解常见实体；空串归一为 None
fn clean(raw: &str) -> Option<String> {
    let decoded = raw
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    let text = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_title_desc_and_og_image() {
        let html = r#"<html><head>
            <title> 9%传奇引擎 </title>
            <meta name="description" content="站点简介">
            <meta property="og:title" content="OG 标题">
            <meta property="og:image" content="/cover.png">
            <meta property="og:site_name" content="996引擎">
            <link rel="shortcut icon" href="/favicon.ico">
        </head></html>"#;
        let head = PageHead::parse(html);
        assert_eq!(head.title.as_deref(), Some("9%传奇引擎"));
        assert_eq!(head.desc.as_deref(), Some("站点简介"));
        assert_eq!(head.og_title.as_deref(), Some("OG 标题"));
        assert_eq!(head.cover_href.as_deref(), Some("/cover.png"));
        assert_eq!(head.site_name.as_deref(), Some("996引擎"));
        assert_eq!(head.icon_href.as_deref(), Some("/favicon.ico"));
    }

    #[test]
    fn attr_requires_attribute_boundary() {
        // `image` 不该在 `og:image=` 里被命中
        let tag = "meta property=\"og:image\" content=\"x.png\"";
        assert_eq!(attr(tag, "content").as_deref(), Some("x.png"));
        assert_eq!(attr(tag, "image"), None);
    }

    #[test]
    fn clean_decodes_entities_and_collapses_whitespace() {
        assert_eq!(clean(" a &amp; b\n c ").as_deref(), Some("a & b c"));
        assert_eq!(clean("   "), None);
    }

    #[test]
    fn parses_unquoted_attributes() {
        // 实测 996m2.com 的真实写法：无引号 + 无 <title>
        let html = r#"<html lang=en><head><meta charset=utf-8><meta name=description content=996传奇引擎，专业提供传奇SF><link rel=icon href=static/img/logo.png type=image/x-icon></head></html>"#;
        let head = PageHead::parse(html);
        assert_eq!(head.desc.as_deref(), Some("996传奇引擎，专业提供传奇SF"));
        assert_eq!(head.icon_href.as_deref(), Some("static/img/logo.png"));
        assert_eq!(head.title, None);
    }

    #[test]
    fn tag_names_are_case_insensitive() {
        let html = "<HTML><HEAD><TITLE>大写标题</TITLE><META NAME=DESCRIPTION CONTENT=大写描述></HEAD></HTML>";
        let head = PageHead::parse(html);
        assert_eq!(head.title.as_deref(), Some("大写标题"));
        assert_eq!(head.desc.as_deref(), Some("大写描述"));
    }

    #[test]
    fn content_type_charset_is_parsed() {
        assert_eq!(charset_from_content_type("text/html; charset=gbk"), Some("gbk"));
        assert_eq!(charset_from_content_type("text/html; charset=\"GB2312\""), Some("GB2312"));
        assert_eq!(charset_from_content_type("text/html"), None);
    }

    #[test]
    fn meta_charset_is_sniffed() {
        let html = br#"<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312">"#;
        assert_eq!(sniff_meta_charset(html).as_deref(), Some("gb2312"));
        assert_eq!(sniff_meta_charset(b"<html><head><meta charset=utf-8>").as_deref(), Some("utf-8"));
        assert_eq!(sniff_meta_charset(b"<html><head>"), None);
    }

    #[test]
    fn decodes_gbk_page_without_header_charset() {
        // 「和讯网」的 GBK 字节；响应头只有 `text/html`，charset 只在 meta 里
        let gbk = [0xba, 0xcd, 0xd1, 0xb6, 0xcd, 0xf8];
        let mut html = b"<html><head><meta charset=gb2312><title>".to_vec();
        html.extend_from_slice(&gbk);
        html.extend_from_slice(b"</title></head></html>");
        let decoded = decode_html(&html, None);
        assert!(decoded.contains("和讯网"), "got {decoded:?}");
        let head = PageHead::parse(&decoded);
        assert_eq!(head.title.as_deref(), Some("和讯网"));
    }

    #[test]
    fn header_charset_wins_over_meta() {
        let html = b"<meta charset=gb2312><title>ok</title>".to_vec();
        assert!(decode_html(&html, Some("utf-8")).contains("<title>ok</title>"));
    }

    #[test]
    fn join_rejects_data_uri_and_resolves_relative() {
        assert_eq!(join("https://a.com/x/y", "/c.png").as_deref(), Some("https://a.com/c.png"));
        assert_eq!(join("https://a.com/x/", "c.png").as_deref(), Some("https://a.com/x/c.png"));
        assert_eq!(join("https://a.com/", "data:image/png;base64,xx"), None);
    }
}
