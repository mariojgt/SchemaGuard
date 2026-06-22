// Tauri 2 entry point. Hosts the live-database client commands (Postgres/MySQL)
// and MCP server control (start/stop the SchemaGuard MCP server).
mod db;
mod mcp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(db::DbState::default())
        .manage(mcp::McpState::default())
        .invoke_handler(tauri::generate_handler![
            db::db_connect,
            db::db_disconnect,
            db::db_tables,
            db::db_query,
            db::db_execute,
            db::db_table_data,
            db::db_list_databases,
            db::db_create_database,
            db::db_drop_database,
            mcp::mcp_start,
            mcp::mcp_stop,
            mcp::mcp_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SchemaGuard");
}
