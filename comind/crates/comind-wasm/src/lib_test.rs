#[cfg(test)]
mod wasm_tests {
    use wasm_bindgen_test::*;
    use serde_json::Value;
    use crate::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    fn test_init() {
        let result = init();
        assert!(result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_create_and_get_page() {
        init().unwrap();
        
        let page_json = r#"{
            "title": "WASM Test Page",
            "type": "normal"
        }"#;
        
        let result = save_page(page_json);
        assert!(result.is_ok());
        
        let page_str = result.unwrap();
        let page: Value = serde_json::from_str(&page_str).unwrap();
        
        assert!(page.get("id").is_some());
        assert_eq!(page.get("title").unwrap().as_str(), Some("WASM Test Page"));
        
        let page_id = page.get("id").unwrap().as_str().unwrap();
        let get_result = get_page(page_id);
        assert!(get_result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_get_all_pages() {
        init().unwrap();
        
        let result = get_all_pages();
        assert!(result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_search() {
        init().unwrap();
        
        let page_json = r#"{
            "title": "Search Test Page",
            "type": "normal"
        }"#;
        
        let result = save_page(page_json);
        assert!(result.is_ok());
        
        let page_str = result.unwrap();
        let page: Value = serde_json::from_str(&page_str).unwrap();
        let page_id = page.get("id").unwrap().as_str().unwrap();
        
        let blocks_json = format!(r#"[{{
            "id": "test-block-1",
            "page_id": "{}",
            "parent_id": null,
            "pos": 1000,
            "content": "This is a search test content with keywords",
            "format": "{}",
            "type": "bullet"
        }}]"#, page_id, "{}");
        
        let _ = save_block_tree(&blocks_json);
        
        let search_result = search("keywords");
        assert!(search_result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_backlinks() {
        init().unwrap();
        
        let result = get_backlinks("nonexistent-page");
        assert!(result.is_ok());
    }

    #[wasm_bindgen_test]
    fn test_get_relationship_types() {
        init().unwrap();
        
        let result = get_relationship_types();
        assert!(result.is_ok());
    }
}