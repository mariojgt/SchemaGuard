//! Live database client backend — connect to Postgres/MySQL, list tables,
//! browse rows, and run arbitrary SQL. Values are stringified generically so
//! the frontend can render any result set (phpMyAdmin / TablePlus style).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sqlx::{Column, Executor, Row, TypeInfo};

#[derive(Clone)]
enum Db {
    Pg(sqlx::PgPool),
    My(sqlx::MySqlPool),
}

#[derive(Default)]
pub struct DbState(Mutex<HashMap<String, Db>>);

/// A connection checked out of the pool for the lifetime of a streamed import,
/// so every chunk of a file runs on the same session (statement order and
/// `SET` directives hold).
enum ImportConn {
    Pg(sqlx::pool::PoolConnection<sqlx::Postgres>),
    My(sqlx::pool::PoolConnection<sqlx::MySql>),
}

#[derive(Default)]
pub struct ImportState(Mutex<HashMap<String, ImportConn>>);

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
    column_types: Vec<String>,
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
        // The database workspace represents one deliberate live session. Keep
        // the pool at one physical connection so opening the table list, row
        // count and data grid together does not fan out into several server
        // sessions behind the user's back.
        "mysql" => Db::My(
            sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(1)
                .connect(&url)
                .await
                .map_err(err)?,
        ),
        _ => Db::Pg(
            sqlx::postgres::PgPoolOptions::new()
                .max_connections(1)
                .connect(&url)
                .await
                .map_err(err)?,
        ),
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
pub async fn db_disconnect(state: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    let db = state
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .remove(&id);
    // `Pool::close` waits for the server session to be released. Dropping the
    // map entry alone leaves shutdown to the pool's background cleanup and can
    // make a disconnected workspace briefly look connected on the DB server.
    if let Some(db) = db {
        match db {
            Db::Pg(pool) => pool.close().await,
            Db::My(pool) => pool.close().await,
        }
    }
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

/// List the databases (schemas) available on the connected server, so the UI
/// can offer a phpMyAdmin-style database switcher. System catalogs are hidden.
#[tauri::command]
pub async fn db_databases(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<Vec<String>, String> {
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let rows = sqlx::query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false AND datallowconn = true \
                 ORDER BY datname",
            )
            .fetch_all(&pool)
            .await
            .map_err(err)?;
            Ok(rows.iter().filter_map(|r| r.try_get::<String, _>(0).ok()).collect())
        }
        Db::My(pool) => {
            let rows = sqlx::query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name NOT IN \
                 ('information_schema', 'performance_schema', 'mysql', 'sys') \
                 ORDER BY schema_name",
            )
            .fetch_all(&pool)
            .await
            .map_err(err)?;
            Ok(rows.iter().filter_map(|r| my_string(r, 0)).collect())
        }
    }
}

/// Drop one or more tables in a single operation. When `disable_fk` is set the
/// drop ignores foreign-key constraints — on MySQL by toggling
/// `FOREIGN_KEY_CHECKS` on one dedicated pooled connection (so the setting and
/// the DROP share a session), on Postgres via `DROP TABLE … CASCADE`. Returns
/// the number of tables requested.
#[tauri::command]
pub async fn db_drop_tables(
    state: tauri::State<'_, DbState>,
    id: String,
    tables: Vec<String>,
    disable_fk: bool,
) -> Result<u64, String> {
    if tables.is_empty() {
        return Ok(0);
    }
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let list = tables
                .iter()
                .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = if disable_fk {
                format!("DROP TABLE IF EXISTS {} CASCADE", list)
            } else {
                format!("DROP TABLE IF EXISTS {}", list)
            };
            sqlx::query(&sql).execute(&pool).await.map_err(err)?;
            Ok(tables.len() as u64)
        }
        Db::My(pool) => {
            let list = tables
                .iter()
                .map(|t| format!("`{}`", t.replace('`', "``")))
                .collect::<Vec<_>>()
                .join(", ");
            // Acquire a single connection so the FK-check toggle and the DROP
            // run in the same session (the pool would otherwise route them to
            // different connections).
            let mut conn = pool.acquire().await.map_err(err)?;
            if disable_fk {
                sqlx::query("SET FOREIGN_KEY_CHECKS = 0")
                    .execute(&mut *conn)
                    .await
                    .map_err(err)?;
            }
            let dropped = sqlx::query(&format!("DROP TABLE IF EXISTS {}", list))
                .execute(&mut *conn)
                .await;
            if disable_fk {
                // Best-effort restore on the same connection before it returns.
                let _ = sqlx::query("SET FOREIGN_KEY_CHECKS = 1").execute(&mut *conn).await;
            }
            dropped.map_err(err)?;
            Ok(tables.len() as u64)
        }
    }
}

/// Run a full multi-statement SQL script (schema + data, e.g. a dump) against
/// the database, like piping a file to `mysql`/`psql`. The script is split into
/// individual statements and executed one at a time on a single pooled
/// connection, so memory stays bounded (no giant single packet → no server
/// `Out of memory`) while statement order and session `SET` directives still
/// hold. Returns total rows affected; stops at the first failing statement and
/// reports its position + a snippet.
#[tauri::command]
pub async fn db_run_script(
    state: tauri::State<'_, DbState>,
    id: String,
    sql: String,
) -> Result<u64, String> {
    let statements = split_sql(&sql);
    drop(sql); // free the (potentially large) source before executing

    // Each statement runs on the simple-query protocol (so DDL, `SET`,
    // `LOCK TABLES`, etc. all work); empty/comment-only fragments are skipped.
    match get(&state, &id)? {
        Db::Pg(pool) => {
            let mut conn = pool.acquire().await.map_err(err)?;
            let mut total: u64 = 0;
            for (idx, stmt) in statements.iter().enumerate() {
                let s = stmt.trim();
                if s.is_empty() {
                    continue;
                }
                let r = conn.execute(s).await.map_err(|e| {
                    format!("statement {} failed ({}): {}", idx + 1, snippet(s), e)
                })?;
                total += r.rows_affected();
            }
            Ok(total)
        }
        Db::My(pool) => {
            let mut conn = pool.acquire().await.map_err(err)?;
            let mut total: u64 = 0;
            for (idx, stmt) in statements.iter().enumerate() {
                let s = stmt.trim();
                if s.is_empty() {
                    continue;
                }
                let r = conn.execute(s).await.map_err(|e| {
                    format!("statement {} failed ({}): {}", idx + 1, snippet(s), e)
                })?;
                total += r.rows_affected();
            }
            Ok(total)
        }
    }
}

/// Begin a streamed import: check a connection out of the pool and key it by a
/// fresh import id. The frontend then feeds statement batches to
/// `db_import_exec` and calls `db_import_finish` at the end. This lets huge
/// files import without ever loading the whole script into memory.
#[tauri::command]
pub async fn db_import_begin(
    db: tauri::State<'_, DbState>,
    imports: tauri::State<'_, ImportState>,
    id: String,
) -> Result<String, String> {
    let conn = match get(&db, &id)? {
        Db::Pg(pool) => ImportConn::Pg(pool.acquire().await.map_err(err)?),
        Db::My(pool) => ImportConn::My(pool.acquire().await.map_err(err)?),
    };
    let import_id = format!("import-{}", COUNTER.fetch_add(1, Ordering::Relaxed));
    imports
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .insert(import_id.clone(), conn);
    Ok(import_id)
}

/// Execute one batch of already-split statements on the import's connection.
#[tauri::command]
pub async fn db_import_exec(
    imports: tauri::State<'_, ImportState>,
    import_id: String,
    statements: Vec<String>,
) -> Result<u64, String> {
    // Take the connection out of the map so the lock isn't held across awaits,
    // then put it back when the batch is done (success or failure).
    let mut conn = imports
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .remove(&import_id)
        .ok_or_else(|| "import session not found".to_string())?;

    let mut total: u64 = 0;
    let mut failure: Option<String> = None;
    for stmt in &statements {
        let s = stmt.trim();
        if s.is_empty() {
            continue;
        }
        let res: Result<u64, sqlx::Error> = match &mut conn {
            ImportConn::Pg(c) => c.execute(s).await.map(|r| r.rows_affected()),
            ImportConn::My(c) => c.execute(s).await.map(|r| r.rows_affected()),
        };
        match res {
            Ok(n) => total += n,
            Err(e) => {
                failure = Some(format!("statement failed ({}): {}", snippet(s), e));
                break;
            }
        }
    }

    imports
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .insert(import_id, conn);

    match failure {
        Some(m) => Err(m),
        None => Ok(total),
    }
}

/// End a streamed import, returning the connection to the pool.
///
/// Must be `async`: dropping a sqlx `PoolConnection` spawns a task to hand the
/// connection back to the pool, which panics ("no runtime") if it happens on a
/// thread without a Tokio context. Running as an async command guarantees that
/// context, so the drop here is safe.
#[tauri::command]
pub async fn db_import_finish(
    imports: tauri::State<'_, ImportState>,
    import_id: String,
) -> Result<(), String> {
    let conn = imports
        .0
        .lock()
        .map_err(|_| "lock poisoned".to_string())?
        .remove(&import_id);
    drop(conn); // dropped within the async runtime — safe to return to the pool
    Ok(())
}

fn snippet(s: &str) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 60 {
        format!("{}…", one_line.chars().take(60).collect::<String>())
    } else {
        one_line
    }
}

/// Split a SQL script into individual statements, stripping `--`/`#` line and
/// `/* */` block comments and respecting quoted literals (with `\` escapes and
/// backtick identifiers). Mirrors the TypeScript core parser's splitter so the
/// behaviour is consistent across the app.
fn split_sql(src: &str) -> Vec<String> {
    let b = src.as_bytes();
    let n = b.len();
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut quote: u8 = 0; // active quote byte, 0 = none
    let mut depth: i32 = 0;
    let mut i = 0usize;

    while i < n {
        let c = b[i];

        if quote != 0 {
            if c == b'\\' && quote != b'`' && i + 1 < n {
                let ch = src[i + 1..].chars().next().unwrap();
                cur.push('\\');
                cur.push(ch);
                i += 1 + ch.len_utf8();
                continue;
            }
            if c == quote {
                quote = 0;
                cur.push(c as char);
                i += 1;
                continue;
            }
            let ch = src[i..].chars().next().unwrap();
            cur.push(ch);
            i += ch.len_utf8();
            continue;
        }

        if c == b'\'' || c == b'"' || c == b'`' {
            quote = c;
            cur.push(c as char);
            i += 1;
            continue;
        }
        if (c == b'-' && i + 1 < n && b[i + 1] == b'-') || c == b'#' {
            while i < n && b[i] != b'\n' {
                i += 1;
            }
            cur.push('\n');
            continue;
        }
        if c == b'/' && i + 1 < n && b[i + 1] == b'*' {
            // `/*! ... */` is a MySQL conditional comment — executable SQL, not a
            // comment — so keep it verbatim (e.g. FOREIGN_KEY_CHECKS toggles).
            let conditional = i + 2 < n && b[i + 2] == b'!';
            let start = i;
            i += 2;
            while i + 1 < n && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n);
            if conditional {
                cur.push_str(&src[start..i]);
            } else {
                cur.push(' ');
            }
            continue;
        }
        if c == b'(' {
            depth += 1;
        } else if c == b')' {
            depth -= 1;
        }
        if c == b';' && depth == 0 {
            let s = cur.trim();
            if !s.is_empty() {
                out.push(s.to_string());
            }
            cur.clear();
            i += 1;
            continue;
        }

        if c < 0x80 {
            cur.push(c as char);
            i += 1;
        } else {
            let ch = src[i..].chars().next().unwrap();
            cur.push(ch);
            i += ch.len_utf8();
        }
    }
    let s = cur.trim();
    if !s.is_empty() {
        out.push(s.to_string());
    }
    out
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
    let column_types: Vec<String> = rows
        .first()
        .map(|r| {
            r.columns()
                .iter()
                .map(|c| c.type_info().name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let out = rows
        .iter()
        .map(|row| (0..columns.len()).map(|i| pg_cell(row, i)).collect())
        .collect::<Vec<Vec<Option<String>>>>();
    let n = out.len() as u64;
    Ok(QueryResult {
        columns,
        column_types,
        rows: out,
        rows_affected: n,
    })
}

async fn run_my(pool: &sqlx::MySqlPool, sql: &str) -> Result<QueryResult, String> {
    let rows = sqlx::query(sql).fetch_all(pool).await.map_err(err)?;
    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let column_types: Vec<String> = rows
        .first()
        .map(|r| {
            r.columns()
                .iter()
                .map(|c| c.type_info().name().to_string())
                .collect()
        })
        .unwrap_or_default();
    let out = rows
        .iter()
        .map(|row| (0..columns.len()).map(|i| my_cell(row, i)).collect())
        .collect::<Vec<Vec<Option<String>>>>();
    let n = out.len() as u64;
    Ok(QueryResult {
        columns,
        column_types,
        rows: out,
        rows_affected: n,
    })
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

#[cfg(test)]
mod tests {
    use super::split_sql;

    #[test]
    fn splits_statements_and_strips_comments() {
        let sql = "-- a dump\n\
                   CREATE TABLE t (id int); /* block */\n\
                   INSERT INTO t VALUES (1); # trailing\n\
                   INSERT INTO t (s) VALUES ('a;b -- not a comment');";
        let stmts = split_sql(sql);
        assert_eq!(stmts.len(), 3);
        assert!(stmts[0].contains("CREATE TABLE t"));
        // The `;` and `--` inside the string literal must not split or be stripped.
        assert!(stmts[2].contains("'a;b -- not a comment'"));
    }

    #[test]
    fn ignores_semicolons_inside_quotes_and_parens() {
        let sql = "INSERT INTO t VALUES (1, 'x;y'), (2, 'z');\nSELECT 1;";
        let stmts = split_sql(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("'x;y'"));
    }

    #[test]
    fn preserves_mysql_conditional_comments() {
        let sql = "/* plain */\n\
                   /*!40014 SET FOREIGN_KEY_CHECKS=0 */;\n\
                   CREATE TABLE t (id int);";
        let stmts = split_sql(sql);
        assert_eq!(stmts.len(), 2);
        assert_eq!(stmts[0], "/*!40014 SET FOREIGN_KEY_CHECKS=0 */");
        assert!(stmts[1].contains("CREATE TABLE t"));
    }

    #[test]
    fn handles_backtick_identifiers_and_escapes() {
        let sql = "INSERT INTO `tbl` VALUES ('it\\'s; ok');\nSELECT 2;";
        let stmts = split_sql(sql);
        assert_eq!(stmts.len(), 2);
        assert!(stmts[0].contains("`tbl`"));
        assert!(stmts[0].contains("it\\'s; ok"));
    }
}
