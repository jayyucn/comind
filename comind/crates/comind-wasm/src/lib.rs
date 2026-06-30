use wasm_bindgen::prelude::*;
use comind_core::types::*;

#[wasm_bindgen]
pub async fn get_block(block_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_blocks_by_page(page_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_page(page_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_all_pages() -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn save_block_tree(blocks: JsValue) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn save_page(page: JsValue) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn delete_page_cascade(page_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn search(query: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_backlinks(page_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_properties(block_id: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn set_property(block_id: &str, key: &str, value: &str, type_: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn delete_property(block_id: &str, key: &str) -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}

#[wasm_bindgen]
pub async fn get_relationship_types() -> Result<JsValue, JsValue> {
    Ok(JsValue::NULL)
}