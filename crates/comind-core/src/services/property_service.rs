use crate::{
    types::{FieldDefinition, FieldValue, Property},
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::collections::HashMap;
use std::error::Error;

/// 属性服务 —— **FieldValue 适配层**（ADR-0049 grill 决策 #6：内置字段读写全切 FieldValue，
/// Property 表冻结遗留；block_version 模块待删除，不在切换范围）。
///
/// 对外契约保持 **Property JSON 形状不变**（id/block_id/key/value/type/...），
/// TS 侧 `getProperties` / `setProperty` / query 投影等消费方零改动。
///
/// 值编码契约（与 TS `utils/property-codec` 单源对齐）：
/// - `FieldValue.value_json` = Property 的 **DB 字符串**（string/page 直通存原文，
///   其余类型 JSON 编码——解释权在 property-codec，本层不解释内容）；
/// - `FieldValue.value_type` = Property 的 `type`。
///
/// 未知 key 自动建 `FieldDefinition`（is_system=false，title=key）——与
/// content `#foo` 自动建 Tag 同一哲学。
pub struct PropertyService;

impl PropertyService {
    // ── 内部：FieldDefinition 解析 / 双向映射 ────────────────────

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
            is_system: false,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
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

    /// FieldValue + FieldDefinition → Property 形状（is_hidden/schema_version 无对应列，合成 0）。
    fn synthesize(fv: &FieldValue, defs: &HashMap<String, FieldDefinition>) -> Property {
        let (key, fd_type) = defs
            .get(&fv.field_definition_id)
            .map(|fd| (fd.key.clone(), fd.r#type.clone()))
            .unwrap_or_default();
        Property {
            id: fv.id.clone(),
            block_id: fv.block_id.clone(),
            key,
            value: fv.value_json.clone(),
            // 用写入时快照的 value_type 解码（field_def.type 后改不影响历史行）
            r#type: if fv.value_type.is_empty() {
                fd_type
            } else {
                fv.value_type.clone()
            },
            sort_order: fv.seq,
            is_hidden: 0,
            is_deleted: 0,
            schema_version: 0,
            created_at: fv.created_at,
            updated_at: fv.updated_at,
            version: fv.version,
            deleted_at: fv.deleted_at,
        }
    }

    /// Property 形状 → FieldValue 行（保 id / 时间戳 / seq —— 撤销重放要求快照忠实带回）。
    fn to_field_value(
        storage: &mut dyn StorageAdapter,
        prop: &Property,
    ) -> Result<(FieldValue, String), Box<dyn Error>> {
        let fd = Self::resolve_field_def(storage, &prop.key, &prop.r#type)?;
        Ok((
            FieldValue {
                id: prop.id.clone(),
                block_id: prop.block_id.clone(),
                field_definition_id: fd.id.clone(),
                value_json: prop.value.clone(),
                value_type: prop.r#type.clone(),
                seq: prop.sort_order,
                created_at: prop.created_at,
                updated_at: prop.updated_at,
                version: 0,
                deleted_at: None,
            },
            fd.id,
        ))
    }

    // ── 读（合成 Property 形状） ────────────────────────────────

    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Property, Box<dyn Error>> {
        let fv = repository::FieldValueRepository::get_by_id(storage.field_values(), id)?;
        let defs = Self::field_defs_by_id(storage)?;
        Ok(Self::synthesize(&fv, &defs))
    }

    pub fn get_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<Property>, Box<dyn Error>> {
        let defs = Self::field_defs_by_id(storage)?;
        Ok(repository::FieldValueRepository::get_by_block_id(
            storage.field_values(),
            block_id,
        )?
        .iter()
        .map(|fv| Self::synthesize(fv, &defs))
        .collect())
    }

    pub fn get_by_block_ids(
        storage: &mut dyn StorageAdapter,
        block_ids: &[String],
    ) -> Result<Vec<Property>, Box<dyn Error>> {
        let defs = Self::field_defs_by_id(storage)?;
        Ok(repository::FieldValueRepository::get_by_block_ids(
            storage.field_values(),
            block_ids,
        )?
        .iter()
        .map(|fv| Self::synthesize(fv, &defs))
        .collect())
    }

    pub fn get_all(storage: &mut dyn StorageAdapter) -> Result<Vec<Property>, Box<dyn Error>> {
        let defs = Self::field_defs_by_id(storage)?;
        Ok(repository::FieldValueRepository::get_all(storage.field_values())?
            .iter()
            .map(|fv| Self::synthesize(fv, &defs))
            .collect())
    }

    pub fn get_by_block_id_and_key(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
    ) -> Result<Option<Property>, Box<dyn Error>> {
        let props = Self::get_by_block_id(storage, block_id)?;
        Ok(props.into_iter().find(|p| p.key == key))
    }

    // ── 写（保 id / 撤销重放语义） ──────────────────────────────

    /// 全形状保存：id 已存在（含软删）→ 复活/覆盖；否则同 (block, key) 存活行 → 覆盖；
    /// 再否则插入。返回合成后的 Property 与 FieldDefinition id（batch op 据此登记 SyncTable）。
    pub fn save_shape(
        storage: &mut dyn StorageAdapter,
        prop: &Property,
    ) -> Result<(Property, String), Box<dyn Error>> {
        let (mut fv, fd_id) = Self::to_field_value(storage, prop)?;

        // ① 按 id 复活/覆盖（撤销重放：快照忠实带回 id，不可重生成）
        if let Some(existing) = repository::FieldValueRepository::get_by_id_including_deleted(
            storage.field_values(),
            &prop.id,
        )? {
            fv.created_at = existing.created_at; // 创建时间不被重放覆盖
            if existing.deleted_at.is_some() {
                repository::FieldValueRepository::undelete(storage.field_values(), &existing.id)?;
            }
            repository::FieldValueRepository::update(storage.field_values(), &fv)?;
            let defs = Self::field_defs_by_id(storage)?;
            return Ok((Self::synthesize(&fv, &defs), fd_id));
        }

        // ② 同 (block, field_def) 已有存活行 → 原地覆盖（保持原 id）
        let existing_by_key = repository::FieldValueRepository::get_by_block_id(
            storage.field_values(),
            &prop.block_id,
        )?
        .into_iter()
        .find(|v| v.field_definition_id == fd_id);
        if let Some(existing) = existing_by_key {
            let keep_id = existing.id;
            let keep_created = existing.created_at;
            fv.id = keep_id;
            fv.created_at = keep_created;
            repository::FieldValueRepository::update(storage.field_values(), &fv)?;
            let defs = Self::field_defs_by_id(storage)?;
            return Ok((Self::synthesize(&fv, &defs), fd_id));
        }

        // ③ 全新插入
        repository::FieldValueRepository::create(storage.field_values(), &fv)?;
        let defs = Self::field_defs_by_id(storage)?;
        Ok((Self::synthesize(&fv, &defs), fd_id))
    }

    // ── 既有公开签名（内部全部切 FieldValue） ───────────────────

    pub fn create(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value: &str,
        r#type: &str,
        sort_order: i64,
        is_hidden: i64,
        schema_version: i64,
    ) -> Result<Property, Box<dyn Error>> {
        let _ = (is_hidden, schema_version); // FieldValue 无对应列，接收但丢弃
        let prop = Property {
            id: Self::generate_id(),
            block_id: block_id.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            r#type: r#type.to_string(),
            sort_order,
            is_hidden: 0,
            is_deleted: 0,
            schema_version: 0,
            created_at: chrono::Utc::now().timestamp_millis(),
            updated_at: chrono::Utc::now().timestamp_millis(),
            version: 0,
            deleted_at: None,
        };
        Ok(Self::save_shape(storage, &prop)?.0)
    }

    pub fn upsert(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value: &str,
        r#type: &str,
        sort_order: i64,
        is_hidden: i64,
        schema_version: i64,
    ) -> Result<Property, Box<dyn Error>> {
        Self::create(storage, block_id, key, value, r#type, sort_order, is_hidden, schema_version)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        value: Option<&str>,
        r#type: Option<&str>,
        sort_order: Option<i64>,
        is_hidden: Option<i64>,
    ) -> Result<Property, Box<dyn Error>> {
        let _ = is_hidden; // FieldValue 无对应列
        let mut prop = Self::get_by_id(storage, id)?;
        if let Some(v) = value {
            prop.value = v.to_string();
        }
        if let Some(t) = r#type {
            prop.r#type = t.to_string();
        }
        if let Some(so) = sort_order {
            prop.sort_order = so;
        }
        prop.updated_at = chrono::Utc::now().timestamp_millis();
        Ok(Self::save_shape(storage, &prop)?.0)
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

    pub fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}
