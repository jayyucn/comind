use crate::{
    types::{FieldDefinition, FieldValue},
    storage::{repository, StorageAdapter},
};
use std::collections::HashMap;
use std::error::Error;

/// 字段值服务 —— 块字段值（`FieldValue`）的唯一读写入口。
///
/// `FieldValue` 是库内实体（`field_value` 表），本层不引入任何中间形状：
/// 读返回库内行，写直接落库内行。`key` 是 `FieldDefinition.key` 的反规范化副本
/// （非落库列），由本层 join 定义表填充，供渲染 / 消费端免二次 IPC 查定义。
///
/// 值编码契约（与 TS `utils/field-value-codec` 单源对齐）：
/// - `value_json` = 值的 **DB 字符串**（string/page 直通存原文，其余类型 JSON 编码
///   —— 解释权在 codec，本层不解释内容）；
/// - `value_type` = 值的类型（写入时快照，定义后改不影响历史行）。
///
/// 未知 key 自动建 `FieldDefinition`（is_system=false，title=key）——与
/// content `#foo` 自动建 Tag 同一哲学。
pub struct FieldValueService;

impl FieldValueService {
    // ── 内部：FieldDefinition 解析 / key 填充 ──────────────────

    /// key → FieldDefinition；缺失则自动建（type 取调用方提示，缺省 text）。
    fn resolve_field_def(
        storage: &mut dyn StorageAdapter,
        key: &str,
        type_hint: &str,
    ) -> Result<FieldDefinition, Box<dyn Error>> {
        if let Some(fd) =
            repository::FieldDefinitionRepository::get_by_key(storage.field_definitions(), key)?
        {
            return Ok(fd);
        }
        let now = chrono::Utc::now().timestamp_millis();
        let fd = FieldDefinition {
            id: uuid::Uuid::new_v4().to_string(),
            key: key.to_string(),
            title: key.to_string(),
            r#type: if type_hint.is_empty() {
                "text".to_string()
            } else {
                type_hint.to_string()
            },
            closed_values: None,
            default_value: None,
            hide_when: "never".to_string(),
            display_form_override: "auto".to_string(),
            is_system: false,
            is_preset: false,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
            min: None,
            max: None,
            step: None,
            spec: None,
        };
        repository::FieldDefinitionRepository::create(storage.field_definitions(), &fd)?;
        Ok(fd)
    }

    fn field_defs_by_id(
        storage: &mut dyn StorageAdapter,
    ) -> Result<HashMap<String, FieldDefinition>, Box<dyn Error>> {
        Ok(repository::FieldDefinitionRepository::get_all(
            storage.field_definitions(),
        )?
        .into_iter()
        .map(|fd| (fd.id.clone(), fd))
        .collect())
    }

    /// 用定义表补齐反规范化的 `key`（DB 无此列，读路径统一在此填充）。
    /// 定义缺失（脏数据 / 未 join）时 `key` 留空，不报错——与旧合成路径同宽容度。
    fn fill_keys(values: &mut [FieldValue], defs: &HashMap<String, FieldDefinition>) {
        for fv in values.iter_mut() {
            if let Some(fd) = defs.get(&fv.field_definition_id) {
                fv.key = fd.key.clone();
            }
        }
    }

    // ── 读 ──────────────────────────────────────────────────────

    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<FieldValue, Box<dyn Error>> {
        let mut fv = repository::FieldValueRepository::get_by_id(storage.field_values(), id)?;
        let defs = Self::field_defs_by_id(storage)?;
        Self::fill_keys(std::slice::from_mut(&mut fv), &defs);
        Ok(fv)
    }

    pub fn get_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<FieldValue>, Box<dyn Error>> {
        let mut values = repository::FieldValueRepository::get_by_block_id(
            storage.field_values(),
            block_id,
        )?;
        let defs = Self::field_defs_by_id(storage)?;
        Self::fill_keys(&mut values, &defs);
        Ok(values)
    }

    pub fn get_by_block_ids(
        storage: &mut dyn StorageAdapter,
        block_ids: &[String],
    ) -> Result<Vec<FieldValue>, Box<dyn Error>> {
        let mut values = repository::FieldValueRepository::get_by_block_ids(
            storage.field_values(),
            block_ids,
        )?;
        let defs = Self::field_defs_by_id(storage)?;
        Self::fill_keys(&mut values, &defs);
        Ok(values)
    }

    pub fn get_all(storage: &mut dyn StorageAdapter) -> Result<Vec<FieldValue>, Box<dyn Error>> {
        let mut values = repository::FieldValueRepository::get_all(storage.field_values())?;
        let defs = Self::field_defs_by_id(storage)?;
        Self::fill_keys(&mut values, &defs);
        Ok(values)
    }

    pub fn get_by_block_id_and_key(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
    ) -> Result<Option<FieldValue>, Box<dyn Error>> {
        Ok(Self::get_by_block_id(storage, block_id)?
            .into_iter()
            .find(|v| v.key == key))
    }

    // ── 写 ──────────────────────────────────────────────────────

    /// 全形状保存：id 已存在（含软删）→ 复活/覆盖；否则同 (block, field_definition)
    /// 存活行 → 覆盖；再否则插入。返回保存后的行与 `FieldDefinition` id
    /// （batch op 据此登记 SyncTable）。
    ///
    /// `fv.key` 定位定义（未知 key 自动建）；`id` 由调用方给定——撤销重放必须忠实带回
    /// 快照 id，不可重生成。
    pub fn save(
        storage: &mut dyn StorageAdapter,
        fv: &FieldValue,
    ) -> Result<(FieldValue, String), Box<dyn Error>> {
        let fd = Self::resolve_field_def(storage, &fv.key, &fv.value_type)?;
        let mut fv = fv.clone();
        fv.field_definition_id = fd.id.clone();
        let fd_id = fd.id;

        // ① 按 id 复活/覆盖（撤销重放：快照忠实带回 id，不可重生成）
        if let Some(existing) = repository::FieldValueRepository::get_by_id_including_deleted(
            storage.field_values(),
            &fv.id,
        )? {
            fv.created_at = existing.created_at; // 创建时间不被重放覆盖
            if existing.deleted_at.is_some() {
                repository::FieldValueRepository::undelete(storage.field_values(), &existing.id)?;
            }
            repository::FieldValueRepository::update(storage.field_values(), &fv)?;
            return Ok((fv, fd_id));
        }

        // ② 同 (block, field_def) 已有存活行 → 原地覆盖（保持原 id）
        let existing_by_key = repository::FieldValueRepository::get_by_block_id(
            storage.field_values(),
            &fv.block_id,
        )?
        .into_iter()
        .find(|v| v.field_definition_id == fd_id);
        if let Some(existing) = existing_by_key {
            fv.id = existing.id;
            fv.created_at = existing.created_at;
            repository::FieldValueRepository::update(storage.field_values(), &fv)?;
            return Ok((fv, fd_id));
        }

        // ③ 全新插入
        repository::FieldValueRepository::create(storage.field_values(), &fv)?;
        Ok((fv, fd_id))
    }

    /// 新建一行（id 自动生成）。同 (block, key) 已有存活行时由 `save` 原地覆盖。
    pub fn create(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value_json: &str,
        value_type: &str,
        seq: i64,
    ) -> Result<FieldValue, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        let fv = FieldValue {
            id: uuid::Uuid::new_v4().to_string(),
            block_id: block_id.to_string(),
            field_definition_id: String::new(), // 由 save 按 key 解析后回填
            value_json: value_json.to_string(),
            value_type: value_type.to_string(),
            seq,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
            key: key.to_string(),
        };
        Ok(Self::save(storage, &fv)?.0)
    }

    pub fn upsert(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value_json: &str,
        value_type: &str,
        seq: i64,
    ) -> Result<FieldValue, Box<dyn Error>> {
        Self::create(storage, block_id, key, value_json, value_type, seq)
    }

    /// 局部更新（`None` = 不改该字段）；仍走 `save` 以保留「按 (block, key) 归一」语义。
    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        value_json: Option<&str>,
        value_type: Option<&str>,
        seq: Option<i64>,
    ) -> Result<FieldValue, Box<dyn Error>> {
        let mut fv = Self::get_by_id(storage, id)?;
        if let Some(v) = value_json {
            fv.value_json = v.to_string();
        }
        if let Some(t) = value_type {
            fv.value_type = t.to_string();
        }
        if let Some(s) = seq {
            fv.seq = s;
        }
        fv.updated_at = chrono::Utc::now().timestamp_millis();
        Ok(Self::save(storage, &fv)?.0)
    }

    pub fn delete(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::FieldValueRepository::delete(storage.field_values(), id)
    }

    pub fn delete_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::FieldValueRepository::delete_by_block_id(storage.field_values(), block_id)
    }

    /// 按 key + values 反查匹配的 block_id 列表（如 status=Todo/Doing 的 block）。
    pub fn query_block_ids_by_key_value(
        storage: &mut dyn StorageAdapter,
        key: &str,
        values: &[String],
    ) -> Result<Vec<String>, Box<dyn Error>> {
        let fd = Self::resolve_field_def(storage, key, "")?;
        let values_set: std::collections::HashSet<&String> = values.iter().collect();
        let mut block_ids: Vec<String> =
            repository::FieldValueRepository::get_by_field_definition_id(
                storage.field_values(),
                &fd.id,
            )?
            .into_iter()
            .filter(|fv| values_set.contains(&fv.value_json))
            .map(|fv| fv.block_id)
            .collect();
        block_ids.sort();
        block_ids.dedup();
        Ok(block_ids)
    }
}
