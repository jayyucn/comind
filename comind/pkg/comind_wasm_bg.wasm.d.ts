/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const delete_page_cascade: (a: number, b: number) => [number, number, number];
export const delete_property: (a: number, b: number, c: number, d: number) => [number, number, number];
export const execute_batch: (a: any) => [number, number, number];
export const get_all_pages: () => [number, number, number];
export const get_backlinks: (a: number, b: number) => [number, number, number];
export const get_block: (a: number, b: number) => [number, number, number];
export const get_blocks_by_page: (a: number, b: number) => [number, number, number];
export const get_page: (a: number, b: number) => [number, number, number];
export const get_properties: (a: number, b: number) => [number, number, number];
export const get_relationship_types: () => [number, number, number];
export const init: () => [number, number];
export const save_block_tree: (a: any) => [number, number, number];
export const save_page: (a: any) => [number, number, number];
export const search: (a: number, b: number) => [number, number, number];
export const set_property: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_start: () => void;
