#[cfg(not(target_arch = "wasm32"))]
use rusqlite::{Connection, Transaction, ToSql, params_from_iter};

/// 抽象「能执行 SQL 的东西」：原生连接与事务连接共用同一套 repo 自由函数，
/// 从而消除 `SQLiteAdapter` 与 `SQLiteTransactionAdapter` 之间约 2000 行逐字复制。
///
/// 详见 `docs/adr/0018-repository-convergence.md`。
///
/// 注意：本 trait 的方法含有泛型（`query_map<T, F>`），因此不是 dyn 兼容的 —— 调用方改用
/// 泛型 `fn f<E: Executor>(exec: &E)`，由编译器单态化，既消除逐字复制又保留零成本抽象。
#[cfg(not(target_arch = "wasm32"))]
pub trait Executor {
    fn execute(&self, sql: &str, params: &[&dyn ToSql]) -> Result<usize, rusqlite::Error>;
    fn query_map<T, F>(&self, sql: &str, params: &[&dyn ToSql], f: F) -> Result<Vec<T>, rusqlite::Error>
    where
        F: FnMut(&rusqlite::Row) -> Result<T, rusqlite::Error>;
}

#[cfg(not(target_arch = "wasm32"))]
impl Executor for Connection {
    fn execute(&self, sql: &str, params: &[&dyn ToSql]) -> Result<usize, rusqlite::Error> {
        self.prepare(sql)?.execute(params_from_iter(params.iter().copied()))
    }

    fn query_map<T, F>(&self, sql: &str, params: &[&dyn ToSql], mut f: F) -> Result<Vec<T>, rusqlite::Error>
    where
        F: FnMut(&rusqlite::Row) -> Result<T, rusqlite::Error>,
    {
        let mut stmt = self.prepare(sql)?;
        let rows = stmt.query_map(params_from_iter(params.iter().copied()), |row| f(row))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl<'a> Executor for Transaction<'a> {
    fn execute(&self, sql: &str, params: &[&dyn ToSql]) -> Result<usize, rusqlite::Error> {
        self.prepare(sql)?.execute(params_from_iter(params.iter().copied()))
    }

    fn query_map<T, F>(&self, sql: &str, params: &[&dyn ToSql], mut f: F) -> Result<Vec<T>, rusqlite::Error>
    where
        F: FnMut(&rusqlite::Row) -> Result<T, rusqlite::Error>,
    {
        let mut stmt = self.prepare(sql)?;
        let rows = stmt.query_map(params_from_iter(params.iter().copied()), |row| f(row))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
