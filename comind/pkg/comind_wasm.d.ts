/* tslint:disable */
/* eslint-disable */

export function delete_page_cascade(page_id: string): any;

export function delete_property(block_id: string, key: string): any;

export function execute_batch(operations: any): any;

export function get_all_pages(): any;

export function get_backlinks(page_id: string): any;

export function get_block(block_id: string): any;

export function get_blocks_by_page(page_id: string): any;

export function get_page(page_id: string): any;

export function get_properties(block_id: string): any;

export function get_relationship_types(): any;

export function init(): void;

export function save_block_tree(blocks: any): any;

export function save_page(page: any): any;

export function search(query: string): any;

export function set_property(block_id: string, key: string, value: string, type_: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly delete_page_cascade: (a: number, b: number) => [number, number, number];
    readonly delete_property: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly execute_batch: (a: any) => [number, number, number];
    readonly get_all_pages: () => [number, number, number];
    readonly get_backlinks: (a: number, b: number) => [number, number, number];
    readonly get_block: (a: number, b: number) => [number, number, number];
    readonly get_blocks_by_page: (a: number, b: number) => [number, number, number];
    readonly get_page: (a: number, b: number) => [number, number, number];
    readonly get_properties: (a: number, b: number) => [number, number, number];
    readonly get_relationship_types: () => [number, number, number];
    readonly init: () => [number, number];
    readonly save_block_tree: (a: any) => [number, number, number];
    readonly save_page: (a: any) => [number, number, number];
    readonly search: (a: number, b: number) => [number, number, number];
    readonly set_property: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
