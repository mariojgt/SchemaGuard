//! MCP server control — start/stop the SchemaGuard MCP server (HTTP transport)
//! from inside the desktop app. Spawns the same `pnpm mcp http` command the CLI
//! uses, tracks the child process, and reports its status to the frontend so the
//! user can flip the server on, copy the URL into their agent, and flip it off.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

const DEFAULT_PORT: u16 = 7331;
/// Repo root, resolved from this crate's location at build time. The desktop app
/// is a local-first dev tool launched from the project (`pnpm tauri:dev`), so the
/// MCP server is run from the same checkout.
const REPO_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/..");

struct Running {
    child: Child,
    port: u16,
}

#[derive(Default)]
pub struct McpState(Mutex<Option<Running>>);

#[derive(Serialize)]
pub struct McpStatus {
    running: bool,
    port: Option<u16>,
    url: Option<String>,
}

fn url_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}/mcp")
}

fn status_of(slot: &mut Option<Running>) -> McpStatus {
    // Reap the child if it has exited so a crashed server reads as stopped.
    if let Some(r) = slot {
        if matches!(r.child.try_wait(), Ok(Some(_)) | Err(_)) {
            *slot = None;
        }
    }
    match slot {
        Some(r) => McpStatus { running: true, port: Some(r.port), url: Some(url_for(r.port)) },
        None => McpStatus { running: false, port: None, url: None },
    }
}

#[tauri::command]
pub fn mcp_start(port: Option<u16>, state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let McpStatus { running: true, .. } = status_of(&mut slot) {
        return Ok(status_of(&mut slot));
    }
    let port = port.unwrap_or(DEFAULT_PORT);
    let child = Command::new("pnpm")
        .args(["-s", "mcp", "http", "--port", &port.to_string()])
        .current_dir(REPO_ROOT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start the MCP server (is pnpm on your PATH?): {e}"))?;
    *slot = Some(Running { child, port });
    Ok(status_of(&mut slot))
}

#[tauri::command]
pub fn mcp_stop(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut r) = slot.take() {
        let _ = r.child.kill();
        let _ = r.child.wait();
    }
    Ok(status_of(&mut slot))
}

#[tauri::command]
pub fn mcp_status(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    Ok(status_of(&mut slot))
}
