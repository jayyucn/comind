//! workspace/assets/ 资产目录共享逻辑（与 sqlite/、markdown/ 并列）：
//! - assets.json 清单读写、id/扩展名校验（save/read/delete_asset_file 命令与 markdown 导出导入共用）
//! - markdown 导出：`asset://<id>` → `assets/<file>`，并把引用文件复制到 markdown/assets/（自包含导出）
//! - markdown 导入：`assets/<file>` / `../assets/<file>` → `asset://<id>`，缺文件时从导出目录回填并登记
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const ASSET_MANIFEST_FILE: &str = "assets.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetMeta {
    /// 磁盘上的实际文件名（如 asset_xxx.png）
    pub file: String,
    /// 原始文件名（用于展示与导出）
    pub name: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    pub created_at: u64,
}

/// 校验 id / 扩展名：只允许字母数字、下划线、连字符，防止路径穿越
pub fn is_safe_asset_component(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn asset_manifest_path(assets_dir: &Path) -> std::path::PathBuf {
    assets_dir.join(ASSET_MANIFEST_FILE)
}

pub fn read_asset_manifest(
    assets_dir: &Path,
) -> Result<HashMap<String, AssetMeta>, String> {
    let path = asset_manifest_path(assets_dir);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read asset manifest: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse asset manifest: {}", e))
}

pub fn write_asset_manifest(
    assets_dir: &Path,
    manifest: &HashMap<String, AssetMeta>,
) -> Result<(), String> {
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize asset manifest: {}", e))?;
    // 先写临时文件再替换，避免并发/中断留下半写的 assets.json（丢条目或解析失败）
    let tmp = assets_dir.join(format!("{}.tmp", ASSET_MANIFEST_FILE));
    std::fs::write(&tmp, content)
        .map_err(|e| format!("Failed to write asset manifest: {}", e))?;
    let path = asset_manifest_path(assets_dir);
    // Windows 上 rename 不能覆盖已存在文件，须先移除旧清单；同目录内 rename 接近原子
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to replace asset manifest: {}", e))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to replace asset manifest: {}", e))
}

/// 校验清单里的磁盘文件名并拼出安全路径（防 assets.json 被手工篡改后路径穿越）。
/// 合法形式为 `<id>.<ext>` 或 `<id>`，各段均通过 is_safe_asset_component。
pub fn asset_file_path(assets_dir: &Path, file: &str) -> Result<std::path::PathBuf, String> {
    let safe = match file.rsplit_once('.') {
        Some((base, ext)) => is_safe_asset_component(base) && is_safe_asset_component(ext),
        None => is_safe_asset_component(file),
    };
    if safe {
        Ok(assets_dir.join(file))
    } else {
        Err(format!("Unsafe asset file name in manifest: {}", file))
    }
}

/// 从原始文件名提取安全的扩展名（不含点，如 "png"）；无扩展名返回 None
pub fn asset_extension(file_name: &str) -> Option<String> {
    let ext = file_name.rsplit('.').next()?;
    if ext.len() == file_name.len() || ext.is_empty() || ext.len() > 8 {
        return None;
    }
    let ext = ext.to_ascii_lowercase();
    if is_safe_asset_component(&ext) {
        Some(ext)
    } else {
        None
    }
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// ext → mime（导入回填清单时使用）
fn mime_from_extension(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// 导出重写：把内容中的 `asset://<id>` 替换为 `assets/<file>`，
/// 并把引用到的资产文件复制到 export_assets_dir（markdown/assets/），使导出目录自包含。
/// 清单中无记录或源文件已缺失的 id 保持原引用不动（渲染走加载失败占位）。
pub fn rewrite_assets_for_export(
    content: &str,
    assets_dir: &Path,
    export_assets_dir: &Path,
) -> Result<String, String> {
    let re = Regex::new(r"asset://([A-Za-z0-9_-]+)").unwrap();
    let manifest = read_asset_manifest(assets_dir)?;

    let mut result = content.to_string();
    let mut dir_created = false;
    let mut seen: HashMap<String, String> = HashMap::new(); // id → 替换文本

    for cap in re.captures_iter(content) {
        let id = &cap[1];
        if seen.contains_key(id) {
            continue;
        }
        let Some(meta) = manifest.get(id) else {
            continue;
        };
        let src = match asset_file_path(assets_dir, &meta.file) {
            Ok(p) => p,
            Err(_) => continue, // 清单内文件名非法：视为缺失，保持原引用不动
        };
        if !src.exists() {
            continue;
        }
        if !dir_created {
            std::fs::create_dir_all(export_assets_dir)
                .map_err(|e| format!("Failed to create export assets directory: {}", e))?;
            dir_created = true;
        }
        let dst = export_assets_dir.join(&meta.file);
        if !dst.exists() {
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Failed to copy asset file: {}", e))?;
        }
        let replacement = format!("assets/{}", meta.file);
        seen.insert(id.to_string(), replacement);
    }

    for (id, replacement) in &seen {
        result = result.replace(&format!("asset://{}", id), replacement);
    }
    Ok(result)
}

/// 导入重写：把内容中的 `(assets/<file>)` / `(../assets/<file>)` 替换回 `(asset://<id>)`。
/// 若 workspace/assets/ 缺该文件且导入目录（markdown/assets/）有，则拷回并登记清单；
/// 两处都缺则保留相对路径不动（由后续渲染占位兜底）。
pub fn rewrite_assets_for_import(
    content: &str,
    import_assets_dir: &Path,
    assets_dir: &Path,
) -> Result<String, String> {
    let re = Regex::new(r"\((?:\.\./)?assets/([A-Za-z0-9_-]+)\.([A-Za-z0-9]{1,8})\)").unwrap();

    let mut result = content.to_string();
    let mut manifest = read_asset_manifest(assets_dir)?;
    let mut manifest_dirty = false;
    let mut replaced: HashMap<String, String> = HashMap::new(); // 完整匹配 → 替换文本

    for cap in re.captures_iter(content) {
        let full_match = &cap[0];
        if replaced.contains_key(full_match) {
            continue;
        }
        let (id, ext) = (&cap[1], &cap[2].to_ascii_lowercase());
        if !is_safe_asset_component(id) || !is_safe_asset_component(ext) {
            continue;
        }
        let file_name = format!("{}.{}", id, ext);
        let dst = assets_dir.join(&file_name);
        if !dst.exists() {
            let src = import_assets_dir.join(&file_name);
            if !src.exists() {
                continue; // 两处都缺，保留原样
            }
            std::fs::create_dir_all(assets_dir)
                .map_err(|e| format!("Failed to create assets directory: {}", e))?;
            std::fs::copy(&src, &dst)
                .map_err(|e| format!("Failed to restore asset file: {}", e))?;
            manifest.insert(
                id.to_string(),
                AssetMeta {
                    file: file_name.clone(),
                    name: file_name.clone(),
                    mime_type: mime_from_extension(ext).to_string(),
                    created_at: now_millis(),
                },
            );
            manifest_dirty = true;
        }
        replaced.insert(full_match.to_string(), format!("(asset://{})", id));
    }

    for (from, to) in &replaced {
        result = result.replace(from, to);
    }
    if manifest_dirty {
        write_asset_manifest(assets_dir, &manifest)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir {
        path: std::path::PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("comind-assets-{}-{}", name, uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn safe_asset_component_rejects_traversal() {
        assert!(is_safe_asset_component("asset_123_abc"));
        assert!(is_safe_asset_component("png"));
        assert!(!is_safe_asset_component(".."));
        assert!(!is_safe_asset_component("a/b"));
        assert!(!is_safe_asset_component("a\\b"));
        assert!(!is_safe_asset_component(""));
        assert!(!is_safe_asset_component("a b"));
    }

    #[test]
    fn asset_extension_extracts_and_validates() {
        assert_eq!(asset_extension("截图 2026.png"), Some("png".to_string()));
        assert_eq!(asset_extension("a.JPEG"), Some("jpeg".to_string()));
        assert_eq!(asset_extension("noext"), None);
        assert_eq!(asset_extension("x.verylongextension"), None);
        assert_eq!(asset_extension("hidden.traversal../x.png"), Some("png".to_string()));
    }

    #[test]
    fn manifest_roundtrip() {
        let dir = TempDir::new("manifest");
        let mut manifest = HashMap::new();
        manifest.insert(
            "asset_1".to_string(),
            AssetMeta {
                file: "asset_1.png".to_string(),
                name: "截图.png".to_string(),
                mime_type: "image/png".to_string(),
                created_at: 123,
            },
        );
        write_asset_manifest(&dir.path, &manifest).unwrap();
        let loaded = read_asset_manifest(&dir.path).unwrap();
        assert_eq!(loaded.get("asset_1").unwrap().file, "asset_1.png");
    }

    #[test]
    fn read_missing_manifest_returns_empty() {
        let dir = TempDir::new("missing-manifest");
        let manifest = read_asset_manifest(&dir.path).unwrap();
        assert!(manifest.is_empty());
    }

    #[test]
    fn manifest_write_replaces_and_leaves_no_tmp() {
        let dir = TempDir::new("atomic");
        let tmp = dir.path.join(format!("{}.tmp", ASSET_MANIFEST_FILE));

        let mut m1 = HashMap::new();
        m1.insert(
            "asset_1".to_string(),
            AssetMeta {
                file: "asset_1.png".to_string(),
                name: "a.png".to_string(),
                mime_type: "image/png".to_string(),
                created_at: 1,
            },
        );
        write_asset_manifest(&dir.path, &m1).unwrap();

        // 覆盖写入（Windows rename 不可覆盖已存在文件的回归路径）
        let m2: HashMap<String, AssetMeta> = HashMap::new();
        write_asset_manifest(&dir.path, &m2).unwrap();
        assert!(read_asset_manifest(&dir.path).unwrap().is_empty());
        assert!(!tmp.exists());
    }

    #[test]
    fn asset_file_path_rejects_unsafe_manifest_names() {
        let dir = Path::new("whatever");
        assert!(asset_file_path(dir, "asset_1.png").is_ok());
        assert!(asset_file_path(dir, "asset_1").is_ok());
        assert!(asset_file_path(dir, "../evil.png").is_err());
        assert!(asset_file_path(dir, "a/b.png").is_err());
        assert!(asset_file_path(dir, "a\\b.png").is_err());
        assert!(asset_file_path(dir, "asset_1.png/../../x").is_err());
        assert!(asset_file_path(dir, "..").is_err());
        assert!(asset_file_path(dir, "").is_err());
    }

    #[test]
    fn export_import_roundtrip_restores_reference() {
        let workspace = TempDir::new("ws");
        let assets_dir = workspace.path.join("assets");
        let export_dir = workspace.path.join("markdown");
        let export_assets_dir = export_dir.join("assets");

        // 登记一个资产
        std::fs::create_dir_all(&assets_dir).unwrap();
        std::fs::write(assets_dir.join("asset_1.png"), b"fakepng").unwrap();
        let mut manifest = HashMap::new();
        manifest.insert(
            "asset_1".to_string(),
            AssetMeta {
                file: "asset_1.png".to_string(),
                name: "截图.png".to_string(),
                mime_type: "image/png".to_string(),
                created_at: 1,
            },
        );
        write_asset_manifest(&assets_dir, &manifest).unwrap();

        // 导出：引用重写 + 文件复制
        let content = "![截图](asset://asset_1) 前后文字";
        let exported =
            rewrite_assets_for_export(content, &assets_dir, &export_assets_dir).unwrap();
        assert_eq!(exported, "![截图](assets/asset_1.png) 前后文字");
        assert!(export_assets_dir.join("asset_1.png").exists());

        // 导入（资产目录为空，需从导出目录回填）：引用还原 + 文件登记
        let imported_assets = workspace.path.join("assets2");
        let imported =
            rewrite_assets_for_import(&exported, &export_assets_dir, &imported_assets).unwrap();
        assert_eq!(imported, "![截图](asset://asset_1) 前后文字");
        assert!(imported_assets.join("asset_1.png").exists());
        let m = read_asset_manifest(&imported_assets).unwrap();
        assert_eq!(m.get("asset_1").unwrap().mime_type, "image/png");
    }

    #[test]
    fn export_keeps_ref_when_asset_missing() {
        let workspace = TempDir::new("missing");
        let assets_dir = workspace.path.join("assets");
        std::fs::create_dir_all(&assets_dir).unwrap();

        let content = "![x](asset://gone_id)";
        let exported =
            rewrite_assets_for_export(content, &assets_dir, &workspace.path.join("md/assets"))
                .unwrap();
        assert_eq!(exported, content); // 清单无记录 → 原样保留

        // 清单有记录但文件丢失 → 同样原样保留
        let mut manifest = HashMap::new();
        manifest.insert(
            "gone_id".to_string(),
            AssetMeta {
                file: "gone_id.png".to_string(),
                name: "gone.png".to_string(),
                mime_type: "image/png".to_string(),
                created_at: 1,
            },
        );
        write_asset_manifest(&assets_dir, &manifest).unwrap();
        let exported =
            rewrite_assets_for_export(content, &assets_dir, &workspace.path.join("md/assets"))
                .unwrap();
        assert_eq!(exported, content);
    }

    #[test]
    fn import_keeps_relative_ref_when_file_missing_everywhere() {
        let workspace = TempDir::new("no-backfill");
        let assets_dir = workspace.path.join("assets");
        let import_dir = workspace.path.join("markdown/assets");
        std::fs::create_dir_all(&assets_dir).unwrap();

        let content = "![x](assets/nofile_1.png)";
        let imported =
            rewrite_assets_for_import(content, &import_dir, &assets_dir).unwrap();
        assert_eq!(imported, content);
        assert!(read_asset_manifest(&assets_dir).unwrap().is_empty());
    }
}
