/**
 * SchemaGuard MCP server definition.
 *
 * `buildServer()` returns a configured `McpServer` exposing the deterministic
 * SchemaGuard engine (the same `@schemaguard/core` the desktop app uses) as a
 * small set of tools over the Model Context Protocol. Pure functions, no app or
 * network required. The transport (stdio or HTTP) is chosen by the caller in
 * `index.ts`, so the same tool definitions serve every client.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  analyzeIndexing,
  analyzeMigrationSource,
  detectSmells,
  dialectFor,
  emitDdl,
  healthScore,
  parseLaravel,
  parseModelFiles,
  parseSql,
  type Schema,
} from "@schemaguard/core";
import { z } from "zod";

import { appBridge } from "./appBridge.js";

export const SERVER_NAME = "schemaguard";
export const SERVER_VERSION = "0.1.0";

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

const FORMAT = z
  .enum(["laravel", "sql"])
  .describe("Source kind: Laravel migration PHP, or SQL DDL");
const DIALECT = z.enum(["postgres", "mysql", "sqlite"]);

function parse(source: string, format: "laravel" | "sql") {
  return format === "sql" ? parseSql(source) : parseLaravel(source);
}

/**
 * Normalize whatever a client sends as `schema` into a real Schema object.
 * MCP transports often deliver object arguments as a JSON string, and callers
 * commonly pass the whole `parse_schema` result (`{ schema, warnings }`) rather
 * than the inner schema — accept both so `generate_sql` doesn't choke.
 */
function coerceSchema(input: unknown): Schema {
  let value: unknown = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error("`schema` is a string but not valid JSON. Pass the parse_schema output.");
    }
  }
  if (value && typeof value === "object" && "schema" in value && !("tables" in value)) {
    value = value.schema;
  }
  if (!value || typeof value !== "object" || !Array.isArray((value as { tables?: unknown }).tables)) {
    throw new Error("`schema` must be a SchemaGuard schema object with a `tables` array.");
  }
  return value as Schema;
}

/** Build a fresh, fully-configured SchemaGuard MCP server. */
export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "SchemaGuard analyzes database schemas for Laravel/SQL projects. Use parse_schema to turn " +
        "migration or SQL source into a normalized schema, review_schema to find design smells with a " +
        "health score, review_indexes for a plain-English indexing audit with SQL/Laravel fixes, " +
        "analyze_migration to assess how risky a migration is to run in production, " +
        "analyze_models to read Eloquent relationships, and generate_sql to emit DDL for any dialect.",
    },
  );

  server.registerTool(
    "parse_schema",
    {
      title: "Parse schema",
      description:
        "Parse Laravel migration PHP or SQL DDL into a normalized schema (tables, columns, keys, " +
        "foreign keys). Returns the schema object plus any parse warnings. Feed the schema into generate_sql.",
      inputSchema: { source: z.string(), format: FORMAT },
    },
    ({ source, format }) => json(parse(source, format)),
  );

  server.registerTool(
    "review_schema",
    {
      title: "Review schema for design smells",
      description:
        "Parse a schema and report design smells (unindexed foreign keys, missing primary keys, money " +
        "stored as float, nullable booleans, missing timestamps…) plus a 0–100 health score. Each smell " +
        "names the table/column and whether a fix exists.",
      inputSchema: { source: z.string(), format: FORMAT },
    },
    ({ source, format }) => {
      const { schema, warnings } = parse(source, format);
      const smells = detectSmells(schema);
      return json({ health: healthScore(smells), smells, warnings });
    },
  );

  server.registerTool(
    "review_indexes",
    {
      title: "Indexing advisor",
      description:
        "Review a schema's indexing in plain English: missing primary keys, unindexed foreign keys, " +
        "`*_id` columns that look like foreign keys but aren't indexed, and redundant indexes. Each " +
        "finding explains why it matters and includes a fix as both SQL and a Laravel migration line.",
      inputSchema: { source: z.string(), format: FORMAT },
    },
    ({ source, format }) => json(analyzeIndexing(parse(source, format).schema)),
  );

  server.registerTool(
    "analyze_migration",
    {
      title: "Assess migration safety",
      description:
        "Assess how risky a single Laravel migration is to run against a populated database. Flags " +
        "destructive operations (drop table/column, change, rename), NOT NULL adds with no default, and " +
        "whether a down() exists. Returns a risk level (none→critical) with plain-English findings.",
      inputSchema: { source: z.string().describe("Full PHP source of one migration file") },
    },
    ({ source }) => json(analyzeMigrationSource(source)),
  );

  server.registerTool(
    "analyze_models",
    {
      title: "Read Eloquent model relationships",
      description:
        "Parse Eloquent model classes and return their relationships (belongsTo, hasMany, belongsToMany, " +
        "morph*…) plus metadata (fillable, casts, timestamps, soft deletes). Pass the source of each model file.",
      inputSchema: { sources: z.array(z.string()).describe("PHP source of each model file") },
    },
    ({ sources }) =>
      json(
        parseModelFiles(sources.map((content, i) => ({ name: `model_${String(i)}.php`, content }))),
      ),
  );

  server.registerTool(
    "generate_sql",
    {
      title: "Generate SQL DDL",
      description:
        "Emit CREATE TABLE DDL for a target dialect from a schema object (the shape returned by " +
        "parse_schema). Use this to convert a schema between Postgres, MySQL, and SQLite.",
      inputSchema: {
        schema: z.any().describe("A SchemaGuard schema object (from parse_schema)"),
        dialect: DIALECT,
      },
    },
    ({ schema, dialect }) => ({
      content: [
        {
          type: "text" as const,
          text: emitDdl(coerceSchema(schema), dialectFor(dialect), { ifNotExists: false }),
        },
      ],
    }),
  );

  // ---- Live-app control tools ---------------------------------------------
  // These drive a *running* SchemaGuard app in real time by enqueuing commands
  // the open app polls and applies. They require the desktop/HTTP app to be
  // open with the MCP server running; otherwise they're harmless no-ops.

  server.registerTool(
    "apply_schema",
    {
      title: "Apply a schema to the live app",
      description:
        "Parse Laravel migration PHP or SQL DDL and replace the schema on the OPEN SchemaGuard " +
        "app's canvas, in real time. Use this to actually build or change what the user sees — " +
        "the diagram and SQL view update instantly. Requires the app to be open.",
      inputSchema: { source: z.string(), format: FORMAT },
    },
    ({ source, format }) => {
      const { schema, warnings } = parse(source, format);
      if (schema.tables.length === 0) {
        return json({ applied: false, error: "No tables were parsed from the source.", warnings });
      }
      appBridge.push({ type: "apply_schema", schema, warnings });
      return json({
        applied: true,
        tables: schema.tables.length,
        warnings,
        note: "Sent to the live app — the canvas updates on its next poll (within ~1s).",
      });
    },
  );

  server.registerTool(
    "write_query",
    {
      title: "Surface a SQL query in the live app",
      description:
        "Show a SQL query in the OPEN SchemaGuard app's floating query panel, in real time, so the " +
        "user can read and run it. Use this whenever the user asks to create, write, or run a query.",
      inputSchema: {
        sql: z.string().describe("The complete SQL query"),
        note: z.string().optional().describe("A one-line description of what the query does"),
      },
    },
    ({ sql, note }) => {
      appBridge.push({ type: "write_query", sql, note: note ?? "" });
      return json({ sent: true, note: "Surfaced in the live app's query panel." });
    },
  );

  server.registerTool(
    "switch_view",
    {
      title: "Switch the live app's workspace",
      description:
        "Open one of the OPEN app's workspaces in real time: 'designer' (schema canvas), 'dataflow' " +
        "(relationship graph), or 'database' (live SQL client).",
      inputSchema: { mode: z.enum(["designer", "dataflow", "database"]) },
    },
    ({ mode }) => {
      appBridge.push({ type: "switch_view", mode });
      return json({ sent: true, mode });
    },
  );

  server.registerTool(
    "set_dialect",
    {
      title: "Set the live app's target SQL dialect",
      description:
        "Set the target SQL dialect (postgres/mysql/sqlite) the OPEN app renders DDL in, in real time.",
      inputSchema: { dialect: DIALECT },
    },
    ({ dialect }) => {
      appBridge.push({ type: "set_dialect", dialect });
      return json({ sent: true, dialect });
    },
  );

  return server;
}
