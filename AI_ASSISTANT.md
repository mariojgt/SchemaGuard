# SchemaGuard for AI agents (MCP)

SchemaGuard's analysis engine is exposed over the **Model Context Protocol** so any agent —
**VS Code, Cursor, Claude Code**, or anything that speaks MCP — can parse, review, and generate
database schemas with the *same* deterministic engine the desktop app uses.

The server is **pure and offline**: it runs straight from this repo over stdio, needs no running
app, no database, and no network. Point your agent's command at `pnpm -s mcp` and you're done.

## Run it

```bash
pnpm mcp        # stdio MCP server (packages/mcp/src/index.ts, via tsx)
```

Agents normally spawn this for you via their config (below) — you rarely run it by hand.

## Tools (deliberately slim)

Every tool is a thin wrapper over [`@schemaguard/core`](packages/core/src/index.ts) and returns JSON.

| Tool | Input | Returns |
|------|-------|---------|
| `parse_schema` | `source`, `format` (`laravel`\|`sql`) | Normalized schema (tables, columns, keys, FKs) + warnings |
| `review_schema` | `source`, `format` | Design smells + a 0–100 **health score** |
| `analyze_migration` | `source` (one migration's PHP) | **Risk** level + plain-English findings + `hasDown` |
| `analyze_models` | `sources[]` (model file PHP) | Eloquent relationships + metadata (fillable, casts…) |
| `generate_sql` | `schema`, `dialect` (`postgres`\|`mysql`\|`sqlite`) | CREATE TABLE DDL |

They compose: `parse_schema` → `generate_sql` converts a schema between dialects; `parse_schema` →
`review_schema` finds problems. Agents read files themselves and pass the contents as `source`.

## Connect your agent

The server runs `pnpm -s mcp` in the project directory. Ready-made config files are checked in:

- **Claude Code** — [`.mcp.json`](.mcp.json) (project scope). Or: `claude mcp add schemaguard -- pnpm -s mcp`
- **VS Code** (Copilot agent mode) — [`.vscode/mcp.json`](.vscode/mcp.json)
- **Cursor** — [`.cursor/mcp.json`](.cursor/mcp.json)

All three use the same stdio launch:

```json
{ "command": "pnpm", "args": ["-s", "mcp"] }
```

Run from another directory? Add the project path, e.g. `"args": ["--dir", "/path/to/SchemaGuard", "-s", "mcp"]`.

## Architecture (mirror, don't fork)

```
VS Code / Cursor / Claude Code
   │  MCP (stdio, JSON-RPC)
   ▼
pnpm mcp  →  packages/mcp/src/index.ts
   │  imports
   ▼
@schemaguard/core  ←  the SAME engine the desktop app's designer, smell panel,
                       migration timeline, and SQL export all use
```

The MCP tools and the app call into one engine, so an agent and the UI can never disagree about a
schema's risk, smells, or generated SQL.

## Adding or changing a tool

1. Implement the capability as a **pure function in `@schemaguard/core`** and export it from
   [`packages/core/src/index.ts`](packages/core/src/index.ts). Keep it framework-free (no DOM, no app state).
2. Add a `server.registerTool(...)` entry in [`packages/mcp/src/index.ts`](packages/mcp/src/index.ts):
   a one-line description (say *when* to use it), a minimal `zod` `inputSchema`, and a handler that
   returns `json(result)`. **Keep inputs minimal** — prefer a `source` string over a pile of options.
3. If the desktop UI gains the same capability, wire it through the **same core function** so the two
   never drift.
4. Verify (below), then add a row to the tools table above.

## Verify

```bash
pnpm -C packages/core test     # engine unit tests
pnpm mcp                       # server boots and serves tools/list over stdio
```

A quick end-to-end check: an MCP `initialize` → `tools/list` should return the five tools, and
`tools/call analyze_migration` on a migration that drops a column should come back `level: "high"`.

## Notes & limits

- **stdio only, localhost process.** These tools read source you hand them; they don't touch a live
  database. **Live-DB introspection stays in the desktop app** (it needs the native Tauri backend) —
  exposing it over MCP would mean shipping a DB driver here; left out to keep the server slim.
- The Laravel parser follows the conventional `$table->…` closure variable, like the rest of the engine.
- Tools return raw JSON text; agents parse it. There's no hidden state between calls — each tool is a
  pure function of its input.
