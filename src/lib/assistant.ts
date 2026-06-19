/**
 * The floating assistant's brain.
 *
 * Wraps the selected model with the full SchemaGuard tool belt — the same tools
 * the MCP server exposes (parse_schema, review_schema, analyze_migration,
 * analyze_models, generate_sql), backed directly by `@schemaguard/core` — plus
 * two app-aware tools: `get_current_scene` (so it knows what's open) and
 * `apply_to_canvas` (so it can act on the open scene). It runs a multi-step
 * tool loop and returns the assistant's final reply.
 */
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
import { jsonSchema, stepCountIs, streamText, tool } from "ai";

import { type ModelOption, resolveModel } from "./ai";

export type AppMode = "designer" | "dataflow" | "database";

/** A snapshot of what the user currently has open, for scene awareness. */
export interface SceneContext {
  mode: AppMode;
  projectName: string;
  targetDialect: string;
  /** The current canvas schema rendered as PostgreSQL DDL (empty if no tables). */
  currentSql: string;
  tables: { name: string; columns: string[] }[];
  migrationsCount: number;
  modelsCount: number;
  recentProjects: { name: string; tableCount: number }[];
}

/** Side-effects the assistant can trigger on the live app, all reflected in real time. */
export interface AssistantActions {
  /** Replace the canvas schema with the given SQL DDL. */
  applySchema: (sql: string) => { tableCount: number; warnings: string[] } | { error: string };
  /** Switch the active workspace (designer / dataflow / database). */
  switchView: (mode: AppMode) => void;
  /** Change the target SQL dialect used across the app's SQL views. */
  setDialect: (dialect: "postgres" | "mysql" | "sqlite") => void;
  /** Surface a SQL query in the live query panel for the user to read or run. */
  writeQuery: (sql: string, note: string) => void;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantReply {
  text: string;
  /** True if the assistant changed the open schema this turn. */
  appliedToCanvas: boolean;
}

/** Called with the full reply text so far as it streams in, for live rendering. */
export type OnDelta = (textSoFar: string) => void;

const FORMAT = jsonSchema<{ source: string; format: "laravel" | "sql" }>({
  type: "object",
  properties: {
    source: { type: "string", description: "The schema source code" },
    format: {
      type: "string",
      enum: ["laravel", "sql"],
      description: "Laravel migration PHP, or SQL DDL",
    },
  },
  required: ["source", "format"],
});

function parse(source: string, format: "laravel" | "sql") {
  return format === "sql" ? parseSql(source) : parseLaravel(source);
}

function buildSystem(ctx: SceneContext): string {
  return [
    "You are SchemaGuard's assistant, embedded in a local-first database schema designer.",
    "You help the user understand and evolve the database they have open, and write SQL.",
    "",
    "You can call tools — the same engine SchemaGuard uses — to parse schemas, review them for",
    "design smells, audit indexing (with SQL/Laravel fixes), assess migration risk, read Eloquent",
    "models, and generate DDL for any dialect.",
    "Always prefer calling a tool over guessing. Call get_current_scene first when the user refers",
    "to 'this'/'the current'/'my' schema, table, or project so you act on what is actually open.",
    "",
    "You can DRIVE the app in real time — every action below reflects instantly in the UI:",
    "• apply_to_canvas: replace the schema on the canvas with complete PostgreSQL CREATE TABLE",
    "  statements (the engine parses and renders them). This is how you create or change a schema.",
    "• write_query: surface a runnable SQL query in the live query panel. Use this whenever the user",
    "  wants to 'create'/'write'/'run' a query — don't just paste it in chat, call write_query so it",
    "  appears live and the user can run it against their database.",
    "• switch_view: open the 'designer' (canvas), 'dataflow' (relationship graph), or 'database'",
    "  (live SQL client) workspace when it helps the user see the result of what they asked for.",
    "• set_dialect: set the target SQL dialect (postgres/mysql/sqlite) the app renders DDL in.",
    "Don't claim you changed something unless you actually called the matching tool.",
    "Still include a short ```sql block in your reply so the user can read what you produced.",
    "Keep replies concise and concrete.",
    "",
    `Current scene: mode=${ctx.mode}, project="${ctx.projectName}", default dialect=${ctx.targetDialect}, ` +
      `${String(ctx.tables.length)} table(s), ${String(ctx.migrationsCount)} migration(s), ${String(ctx.modelsCount)} model(s).`,
  ].join("\n");
}

function buildTools(ctx: SceneContext, actions: AssistantActions) {
  return {
    get_current_scene: tool({
      description:
        "Get what the user currently has open: the active mode, project name, target dialect, the " +
        "current schema as SQL DDL, its tables and columns, and recent projects. Call this to ground " +
        "yourself before acting on 'the current' schema.",
      inputSchema: jsonSchema<Record<string, never>>({ type: "object", properties: {} }),
      execute: () => ({
        mode: ctx.mode,
        projectName: ctx.projectName,
        targetDialect: ctx.targetDialect,
        tables: ctx.tables,
        currentSql: ctx.currentSql || "(no tables on the canvas yet)",
        migrationsCount: ctx.migrationsCount,
        modelsCount: ctx.modelsCount,
        recentProjects: ctx.recentProjects,
      }),
    }),
    parse_schema: tool({
      description:
        "Parse Laravel migration PHP or SQL DDL into a normalized schema (tables, columns, keys, " +
        "foreign keys). Returns the schema object plus parse warnings.",
      inputSchema: FORMAT,
      execute: ({ source, format }) => parse(source, format),
    }),
    review_schema: tool({
      description:
        "Parse a schema and report design smells (unindexed FKs, missing primary keys, money as float, " +
        "nullable booleans, missing timestamps…) plus a 0–100 health score.",
      inputSchema: FORMAT,
      execute: ({ source, format }) => {
        const { schema, warnings } = parse(source, format);
        return {
          health: healthScore(detectSmells(schema)),
          smells: detectSmells(schema),
          warnings,
        };
      },
    }),
    review_indexes: tool({
      description:
        "Audit a schema's indexing in plain English: missing primary keys, unindexed foreign keys, " +
        "`*_id` columns that look like foreign keys but aren't indexed, and redundant indexes. Each " +
        "finding explains why it matters and carries a fix as SQL and a Laravel migration line.",
      inputSchema: FORMAT,
      execute: ({ source, format }) => analyzeIndexing(parse(source, format).schema),
    }),
    analyze_migration: tool({
      description:
        "Assess how risky a single Laravel migration is to run against a populated database (destructive " +
        "ops, NOT NULL adds without a default, missing down()). Returns a risk level with findings.",
      inputSchema: jsonSchema<{ source: string }>({
        type: "object",
        properties: {
          source: { type: "string", description: "Full PHP source of one migration file" },
        },
        required: ["source"],
      }),
      execute: ({ source }) => analyzeMigrationSource(source),
    }),
    analyze_models: tool({
      description:
        "Parse Eloquent model classes and return their relationships and metadata (fillable, casts, " +
        "timestamps, soft deletes).",
      inputSchema: jsonSchema<{ sources: string[] }>({
        type: "object",
        properties: {
          sources: {
            type: "array",
            items: { type: "string" },
            description: "PHP source of each model file",
          },
        },
        required: ["sources"],
      }),
      execute: ({ sources }) =>
        parseModelFiles(sources.map((content, i) => ({ name: `model_${String(i)}.php`, content }))),
    }),
    generate_sql: tool({
      description:
        "Emit CREATE TABLE DDL for a target dialect from a schema object (the shape returned by " +
        "parse_schema). Use to convert a schema between Postgres, MySQL, and SQLite.",
      inputSchema: jsonSchema<{ schema: unknown; dialect: "postgres" | "mysql" | "sqlite" }>({
        type: "object",
        properties: {
          schema: {
            type: "object",
            description: "A SchemaGuard schema object (from parse_schema)",
          },
          dialect: { type: "string", enum: ["postgres", "mysql", "sqlite"] },
        },
        required: ["schema", "dialect"],
      }),
      execute: ({ schema, dialect }) =>
        emitDdl(schema as Schema, dialectFor(dialect), { ifNotExists: false }),
    }),
    apply_to_canvas: tool({
      description:
        "Replace the schema on the SchemaGuard canvas with these PostgreSQL CREATE TABLE statements. " +
        "This is how you actually modify what the user has open. Returns how many tables were applied.",
      inputSchema: jsonSchema<{ sql: string }>({
        type: "object",
        properties: {
          sql: { type: "string", description: "Complete PostgreSQL CREATE TABLE statements" },
        },
        required: ["sql"],
      }),
      execute: ({ sql }) => actions.applySchema(sql),
    }),
    write_query: tool({
      description:
        "Surface a SQL query in the app's live query panel so the user can read and run it. Use this " +
        "whenever the user asks to create, write, or run a query — it appears instantly in the UI.",
      inputSchema: jsonSchema<{ sql: string; note?: string }>({
        type: "object",
        properties: {
          sql: { type: "string", description: "The complete SQL query" },
          note: {
            type: "string",
            description: "A one-line plain-English description of what the query does",
          },
        },
        required: ["sql"],
      }),
      execute: ({ sql, note }) => {
        actions.writeQuery(sql, note ?? "");
        return { ok: true };
      },
    }),
    switch_view: tool({
      description:
        "Open one of the app's workspaces: 'designer' (schema canvas), 'dataflow' (relationship " +
        "graph), or 'database' (live SQL client). The view switches instantly.",
      inputSchema: jsonSchema<{ mode: AppMode }>({
        type: "object",
        properties: {
          mode: { type: "string", enum: ["designer", "dataflow", "database"] },
        },
        required: ["mode"],
      }),
      execute: ({ mode }) => {
        actions.switchView(mode);
        return { ok: true, mode };
      },
    }),
    set_dialect: tool({
      description:
        "Set the target SQL dialect the app renders DDL in. Reflected immediately in the SQL views.",
      inputSchema: jsonSchema<{ dialect: "postgres" | "mysql" | "sqlite" }>({
        type: "object",
        properties: {
          dialect: { type: "string", enum: ["postgres", "mysql", "sqlite"] },
        },
        required: ["dialect"],
      }),
      execute: ({ dialect }) => {
        actions.setDialect(dialect);
        return { ok: true, dialect };
      },
    }),
  };
}

/**
 * Run one assistant turn with the full tool belt and scene awareness. Streams
 * the reply text through `onDelta` as it arrives; tool calls (apply_to_canvas,
 * write_query, switch_view, set_dialect) fire mid-stream, so the app updates in
 * real time before the reply even finishes.
 */
export async function runAssistant(
  option: ModelOption,
  apiKey: string,
  ctx: SceneContext,
  history: ChatTurn[],
  prompt: string,
  actions: AssistantActions,
  onDelta?: OnDelta,
): Promise<AssistantReply> {
  const tools = buildTools(ctx, actions);

  // streamText surfaces stream errors through onError rather than throwing from
  // the iterator, so capture the message and rethrow for the caller's catch.
  let streamErrorMessage = "";
  const result = streamText({
    model: resolveModel(option, apiKey),
    system: buildSystem(ctx),
    messages: [
      ...history.map((t) => ({ role: t.role, content: t.text })),
      { role: "user" as const, content: prompt },
    ],
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 8000,
    onError: ({ error }) => {
      streamErrorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "The model stream failed.";
    },
  });

  let text = "";
  for await (const delta of result.textStream) {
    text += delta;
    onDelta?.(text);
  }

  if (streamErrorMessage) throw new Error(streamErrorMessage);

  const steps = await result.steps;
  const appliedToCanvas = steps.some((step) =>
    step.toolCalls.some((call) => call.toolName === "apply_to_canvas"),
  );

  return { text: text.trim(), appliedToCanvas };
}
