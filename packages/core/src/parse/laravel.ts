import type {
  CanonicalType,
  Column,
  DefaultValue,
  ReferentialAction,
  Schema,
  Table,
} from "../ir/types";

export interface LaravelParseResult {
  schema: Schema;
  warnings: string[];
}

interface Call {
  method: string;
  args: string[];
}

/**
 * Parse Laravel migration source (one or more files concatenated) into the
 * Schema IR. Handles the common Schema Builder DSL; anything unrecognized is
 * collected as a warning rather than silently dropped.
 */
export function parseLaravel(source: string): LaravelParseResult {
  const warnings: string[] = [];
  const byName = new Map<string, Table>();
  const result: Table[] = [];
  applySource(extractUpBody(source), byName, result, warnings);
  return { schema: { name: "Imported", tables: result }, warnings };
}

export interface AppliedChange {
  table: string;
  kind: "create" | "alter";
  addedColumns: number;
  totalColumns: number;
}

/** Extract the body of the up() method, or the whole source if there's no up(). */
export function extractUpBody(source: string): string {
  const m = /function\s+up\s*\(\s*\)\s*(?::\s*void\s*)?\{/.exec(source);
  if (!m) return source;
  const braceIndex = m.index + m[0].length - 1;
  return extractBalanced(source, braceIndex) ?? source;
}

/** Apply every Schema::create/table block in `body` to the running table map. */
export function applySource(
  body: string,
  byName: Map<string, Table>,
  result: Table[],
  warnings: string[],
): AppliedChange[] {
  const changes: AppliedChange[] = [];
  for (const block of extractSchemaBlocks(body)) {
    const existing = byName.get(block.table);
    const isCreate = existing === undefined;
    let table = existing;
    if (!table) {
      table = { name: block.table, columns: [], indexes: [], foreignKeys: [] };
      byName.set(block.table, table);
      result.push(table);
    }
    const before = table.columns.length;
    for (const stmt of splitStatements(block.body)) {
      parseStatement(stmt, table, warnings);
    }
    changes.push({
      table: block.table,
      kind: isCreate ? "create" : "alter",
      addedColumns: table.columns.length - before,
      totalColumns: table.columns.length,
    });
  }
  return changes;
}

interface Block {
  table: string;
  body: string;
}

function extractSchemaBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const re = /Schema::(create|table|drop|dropIfExists)\s*\(\s*(['"])([^'"]+)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const op = m[1] ?? "";
    const table = m[3] ?? "";
    if (op === "drop" || op === "dropIfExists") continue;
    const braceStart = src.indexOf("{", re.lastIndex);
    if (braceStart === -1) continue;
    const body = extractBalanced(src, braceStart);
    if (body !== null) blocks.push({ table, body });
  }
  return blocks;
}

function extractBalanced(src: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  return null;
}

function splitStatements(body: string): string[] {
  return body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("$table->"));
}

function extractCalls(stmt: string): Call[] {
  const calls: Call[] = [];
  const re = /->(\w+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stmt)) !== null) {
    calls.push({ method: m[1] ?? "", args: splitArgs(m[2] ?? "") });
  }
  return calls;
}

function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of s) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "(") depth++;
    if (ch === "]" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}

function unquote(s: string | undefined): string {
  const t = (s ?? "").trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

function stringArray(s: string | undefined): string[] {
  const t = (s ?? "").trim();
  if (t.startsWith("[") && t.endsWith("]")) {
    return splitArgs(t.slice(1, -1)).map((x) => unquote(x));
  }
  return [unquote(t)];
}

function numArg(args: string[], i: number): number | undefined {
  const v = args[i];
  if (v === undefined) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

function pluralize(word: string): string {
  if (word.endsWith("y")) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function inferRefTable(column: string): string {
  const base = column.endsWith("_id") ? column.slice(0, -3) : column;
  return pluralize(base);
}

function deleteAction(mods: Call[]): { onDelete?: ReferentialAction } {
  if (mods.some((c) => c.method === "cascadeOnDelete")) return { onDelete: "cascade" };
  if (mods.some((c) => c.method === "restrictOnDelete")) return { onDelete: "restrict" };
  if (mods.some((c) => c.method === "nullOnDelete")) return { onDelete: "set null" };
  const od = mods.find((c) => c.method === "onDelete");
  const v = unquote(od?.args[0]).toLowerCase();
  if (v === "cascade" || v === "restrict" || v === "set null" || v === "no action") {
    return { onDelete: v };
  }
  return {};
}

function parseDefault(arg: string | undefined): DefaultValue {
  const t = (arg ?? "").trim();
  if (t.length === 0) return { kind: "expr", expr: "NULL" };
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return { kind: "literal", value: t.slice(1, -1) };
  }
  if (t === "true" || t === "false") return { kind: "literal", value: t === "true" };
  const n = Number(t);
  if (Number.isFinite(n)) return { kind: "literal", value: n };
  return { kind: "expr", expr: t };
}

function upsertColumn(table: Table, col: Column): void {
  const i = table.columns.findIndex((c) => c.name === col.name);
  if (i >= 0) table.columns[i] = col;
  else table.columns.push(col);
}

function mapType(
  method: string,
  args: string[],
): { name: string; type: CanonicalType; isPk?: boolean } | null {
  const name = unquote(args[0]);
  switch (method) {
    case "id":
    case "bigIncrements":
      return { name: name || "id", type: { kind: "serial", size: "big" }, isPk: true };
    case "increments":
      return { name: name || "id", type: { kind: "serial", size: "regular" }, isPk: true };
    case "uuid":
      return { name: name || "uuid", type: { kind: "uuid" } };
    case "ulid":
      return { name: name || "ulid", type: { kind: "string", length: 26 } };
    case "string":
    case "char":
      return { name, type: { kind: "string", length: numArg(args, 1) ?? 255 } };
    case "text":
    case "mediumText":
    case "longText":
    case "tinyText":
      return { name, type: { kind: "text" } };
    case "integer":
    case "unsignedInteger":
      return { name, type: { kind: "int", size: "regular" } };
    case "bigInteger":
    case "unsignedBigInteger":
    case "foreignId":
      return { name, type: { kind: "int", size: "big" } };
    case "smallInteger":
    case "unsignedSmallInteger":
    case "year":
      return { name, type: { kind: "int", size: "small" } };
    case "tinyInteger":
    case "unsignedTinyInteger":
      return { name, type: { kind: "int", size: "tiny" } };
    case "boolean":
      return { name, type: { kind: "boolean" } };
    case "decimal":
    case "unsignedDecimal":
      return {
        name,
        type: { kind: "decimal", precision: numArg(args, 1) ?? 8, scale: numArg(args, 2) ?? 2 },
      };
    case "float":
      return { name, type: { kind: "float" } };
    case "double":
      return { name, type: { kind: "double" } };
    case "json":
    case "jsonb":
      return { name, type: { kind: "json" } };
    case "date":
      return { name, type: { kind: "date" } };
    case "time":
    case "timeTz":
      return { name, type: { kind: "time" } };
    case "dateTime":
    case "dateTimeTz":
    case "timestamp":
      return { name, type: { kind: "datetime" } };
    case "timestampTz":
      return { name, type: { kind: "timestamptz" } };
    case "binary":
      return { name, type: { kind: "binary" } };
    case "enum":
    case "set":
      return { name, type: { kind: "string", length: 255 } };
    default:
      return null;
  }
}

function parseStatement(stmt: string, table: Table, warnings: string[]): void {
  const calls = extractCalls(stmt);
  const head = calls[0];
  if (!head) return;
  const mods = calls.slice(1);
  const m = head.method;

  // Multi-column / structural helpers
  if (m === "timestamps" || m === "timestampsTz" || m === "nullableTimestamps") {
    upsertColumn(table, { name: "created_at", type: { kind: "datetime" }, nullable: true });
    upsertColumn(table, { name: "updated_at", type: { kind: "datetime" }, nullable: true });
    return;
  }
  if (m === "softDeletes") {
    upsertColumn(table, {
      name: unquote(head.args[0]) || "deleted_at",
      type: { kind: "datetime" },
      nullable: true,
    });
    return;
  }
  if (m === "rememberToken") {
    upsertColumn(table, {
      name: "remember_token",
      type: { kind: "string", length: 100 },
      nullable: true,
    });
    return;
  }
  if (m === "morphs" || m === "nullableMorphs") {
    const base = unquote(head.args[0]);
    const nullable = m === "nullableMorphs";
    upsertColumn(table, { name: `${base}_id`, type: { kind: "int", size: "big" }, nullable });
    upsertColumn(table, { name: `${base}_type`, type: { kind: "string", length: 255 }, nullable });
    return;
  }
  if (m === "primary") {
    table.primaryKey = stringArray(head.args[0]);
    return;
  }
  if (m === "unique" && calls.length === 1) {
    table.indexes.push({ columns: stringArray(head.args[0]), unique: true });
    return;
  }
  if (m === "index") {
    table.indexes.push({ columns: stringArray(head.args[0]), unique: false });
    return;
  }
  if (m === "foreign") {
    const refColumn = mods.find((c) => c.method === "references")?.args[0];
    const onTable = mods.find((c) => c.method === "on")?.args[0];
    if (onTable && refColumn) {
      table.foreignKeys.push({
        columns: stringArray(head.args[0]),
        refTable: unquote(onTable),
        refColumns: stringArray(refColumn),
        ...deleteAction(mods),
      });
    }
    return;
  }
  if (m.startsWith("drop")) {
    warnings.push(`Ignored ${m}(...) — import builds the resulting schema, not change steps.`);
    return;
  }

  // Column-defining call
  const info = mapType(m, head.args);
  if (!info) {
    warnings.push(`Unrecognized: $table->${m}(...)`);
    return;
  }
  const col: Column = { name: info.name, type: info.type, nullable: false };
  if (info.isPk) table.primaryKey = [info.name];

  for (const mod of mods) {
    switch (mod.method) {
      case "nullable":
        col.nullable = unquote(mod.args[0]) !== "false";
        break;
      case "default":
        col.default = parseDefault(mod.args[0]);
        break;
      case "unique":
        col.unique = true;
        break;
      case "index":
        table.indexes.push({ columns: [info.name], unique: false });
        break;
      case "primary":
        table.primaryKey = [info.name];
        break;
      case "constrained": {
        const refTable = mod.args[0] ? unquote(mod.args[0]) : inferRefTable(info.name);
        table.foreignKeys.push({
          columns: [info.name],
          refTable,
          refColumns: ["id"],
          ...deleteAction(mods),
        });
        break;
      }
      default:
        break;
    }
  }

  upsertColumn(table, col);
}
