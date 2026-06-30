pub mod repository;
#[cfg(not(target_arch = "wasm32"))]
pub mod sqlite;
#[cfg(target_arch = "wasm32")]
pub mod sqljs;

pub use repository::*;
#[cfg(not(target_arch = "wasm32"))]
pub use sqlite::*;
#[cfg(target_arch = "wasm32")]
pub use sqljs::*;