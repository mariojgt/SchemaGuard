//! Live database client backend — connect to Postgres/MySQL, list tables,
//! browse rows, and run arbitrary SQL. Values are stringified generically so
//! the frontend can render any result set (phpMyAdmin / TablePlus style).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sqlx::{Column, Row, TypeInfo};

#[derive(Clone)]
enum Db {
    Pg(sqlx::PgPool),
    My(sqlx::MySqlPool),
}

#[derive(Default)]
pub struct DbState(Mutex<HashMap<String, Db>>);

#[derive(Deserialize)]
pub struct ConnInfo {
    dialect: String,
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

impl ConnInfo {
    fn url(&self) -> String {
        let scheme = if self.dialect == "mysql" { "mysql" } else { "postgres" };
        format!(
            "{}://{}:{}@{}:{}/{}",
            scheme,
            urlencoding::encode(&self.user),
            urlencoding::encode(&self.password),
            self.host,
            self.port,
            urlencoding::encode(&self.database),
        )
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Option<String>>>,
    rows_affected: u64,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

static COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_id() -> String {
    format!("conn-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

fn get(state: &DbState, id: &str) -> Result<Db, String> {
    state
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "no such connection".to_string())
}

#[tauri::command]
pub async fn db_connect(state: tauri::State<'_, DbState>, info: ConnInfo) -> Result<String, String> {
    let url = info.url();
    let db = match info.dialect.as_str() {
        "mysql" => Db::My(sqlx::MySqlPool::connect(&url).await.map_err(err)?),
        _ => Db::Pg(sqlx::PgPool::connect(&url).await.map_err(err)?),
    };
    let id = next_id();
    state
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .insert(id.clone(), db);
    Ok(id)
}

#[tauri::command]
pub fn db_disconnect(state: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn db_tables(state: tauri::State<'_, DbState>, id: String) -> Result<Vec<String>, String> {
    let db = get(&state, &id)?;
    match db {
        Db::Pg(pool) => {
            let rows = sqlx::query(
                "SELECT table_name FROM information_schema.tables \
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
                 ORDER BY table_name",
            )
            .fetch_all(&pool)
            .await
            .map_err(err)?;
            Ok(rows.iter().filter_map(|r| r.try_get::<String, _>(0).ok()).collect())
        }
        Db::My(pool) => {
            let rows = sqlx::query(
                "SELECT table_name FROM information_schema.tables \
                 WHERE table_schema = DATABASE() ORDER BY table_name",
            )
            .fetch_all(&pool)
            .await
            .map_err(err)?;
            // information_schema columns use a binary charset in MySQL, so a
            // plain String decode fails — read as bytes and recover the text.
            Ok(rows.iter().filter_map(|r| my_string(r, 0)).collect())
        }
    }
}

#[tauri::command]
pub async fn db_query(
    state: tauri::State<'_, DbState>,
    id: String,
    sql: String,
) -> Result<QueryResult, String> {
    match get(&state, &id)? {
        Db::Pg(pool) => run_pg(&pool, &sql).await,
        Db::My(pool) => run_my(&pool, &sql).await,
    }
}

#[tauri::command]
pub async fn db_execute(
    state: tauri::State<'_, DbState>,
    id: String,
    sql: String,
) -> Result<u64, String> {
    match get(&state, &id)? {
        Db::Pg(pool) => sqlx::query(&sql)
            .execute(&pool)
            .await
            .map(|r| r.rows_affected())
            .map_err(err),
        Db::My(pool) => sqlx::query(&sql)
            .execute(&pool)
            .await
            .map(|r| r.rows_affected())
            .map_err(err),
    }
}

#[tauri::command]
pub async fn db_table_data(
    state: tauri::State<'_, DbState>,
    id: String,
    table: String,
    limit: i64,
    offset: i64,
) -> Result<QueryResult, String> {
    let lim = limit.clamp(1, 1000);
    let off = offset.max(0);
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let q = format!(
                "SELECT * FROM \"{}\" LIMIT {} OFFSET {}",
                table.replace('"', "\"\""),
                lim,
                off
            );
            run_pg(&pool, &q).await
        }
        Db::My(pool) => {
            let q = format!(
                "SELECT * FROM `{}` LIMIT {} OFFSET {}",
                table.replace('`', "``"),
                lim,
                off
            );
            run_my(&pool, &q).await
        }
    }
}

/// List every database on the connected server (template DBs excluded for
/// Postgres). Lets the user browse and switch databases without re-entering
/// connection details.
#[tauri::command]
pub async fn db_list_databases(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, String> {
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let rows = sqlx::query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false ORDER BY datname",
            )
            .fetch_all(&pool)
            .await
            .map_err(err)?;
            Ok(rows.iter().filter_map(|r| r.try_get::<String, _>(0).ok()).collect())
        }
        Db::My(pool) => {
            let rows = sqlx::query("SHOW DATABASES").fetch_all(&pool).await.map_err(err)?;
            // SHOW DATABASES yields the binary-charset string column seen across
            // the MySQL catalog, so decode it the same forgiving way.
            Ok(rows.iter().filter_map(|r| my_string(r, 0)).collect())
        }
    }
}

/// `CREATE DATABASE <name>`. The name can't be bound as a parameter in DDL, so
/// it's escaped per-dialect (double quotes for Postgres, backticks for MySQL).
#[tauri::command]
pub async fn db_create_database(
    state: tauri::State<'_, DbState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Database name is required".to_string());
    }
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let q = format!("CREATE DATABASE \"{}\"", name.replace('"', "\"\""));
            sqlx::query(&q).execute(&pool).await.map_err(err)?;
        }
        Db::My(pool) => {
            let q = format!("CREATE DATABASE `{}`", name.replace('`', "``"));
            sqlx::query(&q).execute(&pool).await.map_err(err)?;
        }
    }
    Ok(())
}

/// `DROP DATABASE <name>`. The engine rejects dropping a database that has open
/// connections (including the active one), and that error surfaces to the UI.
#[tauri::command]
pub async fn db_drop_database(
    state: tauri::State<'_, DbState>,
    id: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Database name is required".to_string());
    }
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let q = format!("DROP DATABASE \"{}\"", name.replace('"', "\"\""));
            sqlx::query(&q).execute(&pool).await.map_err(err)?;
        }
        Db::My(pool) => {
            let q = format!("DROP DATABASE `{}`", name.replace('`', "``"));
            sqlx::query(&q).execute(&pool).await.map_err(err)?;
        }
    }
    Ok(())
}

async fn run_pg(pool: &sqlx::PgPool, sql: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(sql).fetch_all(pool).await.map_err(err)?;
    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let out = rows
        .iter()
        .map(|row| (0..columns.len()).map(|i| pg_cell(row, i)).collect())
        .collect::<Vec<Vec<Option<String>>>>();
    let n = out.len() as u64;
    Ok(QueryResult { columns, rows: out, rows_affected: n })
}

async fn run_my(pool: &sqlx::MySqlPool, sql: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(sql).fetch_all(pool).await.map_err(err)?;
    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let out = rows
        .iter()
        .map(|row| (0..columns.len()).map(|i| my_cell(row, i)).collect())
        .collect::<Vec<Vec<Option<String>>>>();
    let n = out.len() as u64;
    Ok(QueryResult { columns, rows: out, rows_affected: n })
}

fn pg_cell(row: &sqlx::postgres::PgRow, i: usize) -> Option<String> {
    let name = row.columns()[i].type_info().name().to_uppercase();
    match name.as_str() {
        "BOOL" => row.try_get::<Option<bool>, _>(i).ok().flatten().map(|v| v.to_string()),
        "INT2" => row.try_get::<Option<i16>, _>(i).ok().flatten().map(|v| v.to_string()),
        "INT4" => row.try_get::<Option<i32>, _>(i).ok().flatten().map(|v| v.to_string()),
        "INT8" => row.try_get::<Option<i64>, _>(i).ok().flatten().map(|v| v.to_string()),
        "FLOAT4" => row.try_get::<Option<f32>, _>(i).ok().flatten().map(|v| v.to_string()),
        "FLOAT8" => row.try_get::<Option<f64>, _>(i).ok().flatten().map(|v| v.to_string()),
        "NUMERIC" => row
            .try_get::<Option<sqlx::types::BigDecimal>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "UUID" => row
            .try_get::<Option<sqlx::types::Uuid>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "JSON" | "JSONB" => row
            .try_get::<Option<serde_json::Value>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "DATE" => row
            .try_get::<Option<sqlx::types::chrono::NaiveDate>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "TIME" => row
            .try_get::<Option<sqlx::types::chrono::NaiveTime>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "TIMESTAMP" => row
            .try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "TIMESTAMPTZ" => row
            .try_get::<Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_rfc3339()),
        _ => row.try_get::<Option<String>, _>(i).ok().flatten(),
    }
}

/// Read a MySQL column as text, falling back to a raw-bytes UTF-8 decode.
/// `information_schema` returns its string columns with a binary charset, which
/// a direct `String` decode rejects — without this, catalog queries (table
/// lists, schema introspection) silently come back empty.
fn my_string(row: &sqlx::mysql::MySqlRow, i: usize) -> Option<String> {
    if let Ok(Some(s)) = row.try_get::<Option<String>, _>(i) {
        return Some(s);
    }
    if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return Some(String::from_utf8_lossy(&bytes).into_owned());
    }
    None
}

fn my_cell(row: &sqlx::mysql::MySqlRow, i: usize) -> Option<String> {
    let name = row.columns()[i].type_info().name().to_uppercase();
    if name.contains("INT") {
        if let Some(v) = row.try_get::<Option<i64>, _>(i).ok().flatten() {
            return Some(v.to_string());
        }
        return row.try_get::<Option<u64>, _>(i).ok().flatten().map(|v| v.to_string());
    }
    match name.as_str() {
        "FLOAT" => row.try_get::<Option<f32>, _>(i).ok().flatten().map(|v| v.to_string()),
        "DOUBLE" => row.try_get::<Option<f64>, _>(i).ok().flatten().map(|v| v.to_string()),
        "DECIMAL" | "NEWDECIMAL" => row
            .try_get::<Option<sqlx::types::BigDecimal>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "JSON" => row
            .try_get::<Option<serde_json::Value>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "DATE" => row
            .try_get::<Option<sqlx::types::chrono::NaiveDate>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>(i)
            .ok()
            .flatten()
            .map(|v| v.to_string()),
        _ => my_string(row, i),
    }
}
