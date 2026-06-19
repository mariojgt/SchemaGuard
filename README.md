# SchemaGuard

A local-first desktop **database schema designer + multi-database SQL tool** (Tauri + React). Design schemas on a visual canvas, reverse-engineer existing SQL or Laravel migrations, generate DDL for SQLite/MySQL/PostgreSQL, and design with an AI Copilot — all on your machine.

Spec docs in the repo root: `schema_guard_database_agnostic_migration_analyzer.md` (vision), `phase_1_technical_spec.md` (engineering), `mvp_ui_spec.md` (interface).

## Two modes

A top-bar switch toggles between:

- **Designer** — the visual schema builder + multi-DB SQL + Laravel import + AI Copilot (below).
- **Database** — a live DB client (phpMyAdmin / TablePlus style): connect to **PostgreSQL or MySQL**, browse tables, page through rows, and run arbitrary SQL. Connections run through the native Rust backend (`sqlx`), so this works in the **desktop app** (`pnpm tauri:dev`); the browser preview shows a notice since it can't open DB sockets. Saved connections are remembered locally (passwords never persisted).

## Features

- **Visual ER canvas** (React Flow) — polished table cards, key dots, orthogonal labeled relationships, drag-to-create foreign keys, persistent layout.
- **Multi-dialect SQL generation** — correct, idiomatic DDL for **SQLite, MySQL, PostgreSQL** with feature-gap warnings (e.g. enum→CHECK on SQLite, boolean→TINYINT(1) on MySQL).
- **Import / reverse-engineer**:
  - **SQL / DDL** — paste a `CREATE TABLE` dump → diagram.
  - **Laravel migrations** — paste, open files, or **open the whole `migrations/` folder** to build a dated **migration timeline** with per-step snapshots and "what changed" highlighting.
- **AI Copilot** — describe a change in plain English; Claude proposes SQL, which the engine parses and validates before applying. BYO Anthropic API key (Settings), stored locally.
- **Editing** — add/edit/delete tables and columns, types, nullability, PK/unique, foreign keys; **undo/redo**; **autosave**; Save/Open project files.
- **Catalog** — searchable browse of all tables/columns/relationships.
- **Command palette (⌘K)** + keyboard shortcuts (⌘S save, ⌘E export, ⌘Z/⌘⇧Z undo/redo).
- **Validation** — structural checks (missing FK targets, duplicate names, no primary key) surfaced as a top-bar badge + Catalog panel.
- Dark, enterprise-styled UI with resizable panels.

## Stack

Tauri 2 · React 18 · TypeScript (strict) · Zustand · React Flow (`@xyflow/react`) · Tailwind · `@anthropic-ai/sdk` · Vitest.
The analysis engine is a pure-TS workspace package, `packages/core` (no DOM/Tauri imports) — IR, dialects, parsers (SQL + Laravel), emitter, validation.

## Prerequisites

- **Node 18+** and **pnpm 9** (`corepack enable pnpm`)
- **Rust toolchain** for the desktop shell — https://rustup.rs (only for `pnpm tauri:dev`)
- Tauri system deps — https://tauri.app/start/prerequisites/

## Install & run

```bash
pnpm install

pnpm dev            # browser (fastest loop) → http://localhost:1420
pnpm tauri:dev      # full desktop app

pnpm test           # engine tests (vitest)
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

> **AI Copilot:** open Settings (⚙), paste an Anthropic API key, then use the Copilot tab. The key is stored in local storage only.
>
> **Icons:** before `pnpm tauri build`, generate them once: `pnpm tauri icon path/to/icon.png`.

## MCP server — use SchemaGuard from your AI tool

The engine is also exposed over the **Model Context Protocol**, so Claude Desktop, Claude Code, Cursor, or VS Code can call SchemaGuard's tools (`parse_schema`, `review_schema`, `analyze_migration`, `analyze_models`, `generate_sql`) directly.

**Run it from the command line:**

```bash
pnpm mcp           # stdio server (what clients spawn for themselves)
pnpm mcp:start     # start a background HTTP server  → http://127.0.0.1:7331/mcp
pnpm mcp:status    # is it running?
pnpm mcp:stop      # stop it
pnpm mcp:http      # run the HTTP server in the foreground (Ctrl-C to stop)
```

**Run it from the app:** open the desktop app, click the **🔌 plug icon** (top bar) or run `MCP server` from the command palette (⌘K) — flip the server on/off and copy a ready-made config for your tool.

**Connect a client.** Two ways:

- **Standalone (no app needed)** — the client launches the server on demand. Add to the client's MCP config (`.mcp.json` for Claude Code, `.cursor/mcp.json`, `.vscode/mcp.json`, or Claude Desktop → Settings → Developer → Edit Config):

  ```json
  { "mcpServers": { "schemaguard": { "command": "pnpm", "args": ["-s", "mcp"], "cwd": "/path/to/SchemaGuard" } } }
  ```

- **Via a running HTTP server** — `pnpm mcp:start` (or the app toggle), then point the client at the URL:

  ```json
  { "mcpServers": { "schemaguard": { "type": "http", "url": "http://127.0.0.1:7331/mcp" } } }
  ```

> VS Code uses `{ "servers": { … } }` instead of `mcpServers`. Set `SCHEMAGUARD_MCP_PORT` to change the port. If `pnpm` isn't on your client's PATH, use its absolute path. The repo already ships working `.mcp.json`, `.cursor/mcp.json`, and `.vscode/mcp.json`.

## Layout

```
.
├─ src/                    # React app
│  ├─ App.tsx              # workspace: top bar, panes, dialogs, shortcuts
│  ├─ components/          # Canvas, TableNode, LeftPane (SQL/Copilot/Migrations),
│  │                       # Inspector, Import/Catalog/Settings/CommandPalette
│  ├─ lib/                 # highlightSql, typePresets, projectFile, layout, ai
│  └─ stores/              # Zustand: schema (IR + history + undo), settings (API key)
├─ packages/core/          # pure engine
│  └─ src/{ir,dialects,emit,parse}/
└─ src-tauri/              # Rust desktop shell
```

## What's not here (yet)

Real-time collaboration and a hosted GitHub PR bot require a backend and are out of scope for the local-first desktop app — see the product doc's cloud-companion phase.
