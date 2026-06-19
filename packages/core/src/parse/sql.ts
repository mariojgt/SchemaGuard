import type {
  CanonicalType,
  Column,
  DefaultValue,
  ReferentialAction,
  Schema,
  Table,
} from "../ir/types";

export interface SqlParseResult {
  schema: Schema;
  warnings: string[];
}

/** Parse raw SQL DDL (CREATE TABLE statements) into the Schema IR. */
export function parseSql(source: string): SqlParseResult {
  const warnings: string[] = [];
  const tables: Table[] = [];

  for (const { name, body } of createTableBlocks(source)) {
    const table: Table = { name, columns: [], indexes: [], foreignKeys: [] };
    for (const item of splitTopLevel(body)) {
      parseItem(item.trim(), table, warnings);
    }
    tables.push(table);
  }

  return { schema: { name: "Imported", tables }, warnings };
}

interface Block {
  name: string;
  body: string;
}

function createTableBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = cleanIdent(m[1] ?? "");
    const openIndex = m.index + m[0].length - 1; // m[0] ends with "("
    const body = balancedParens(src, openIndex);
    if (body !== null) blocks.push({ name, body });
  }
  return blocks;
}

function balancedParens(src: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  let quote: string | null = null;
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      if (cur.trim().length > 0) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

function cleanIdent(s: string): string {
  const t = s.trim().replace(/[`"[\]]/g, "");
  const dot = t.lastIndexOf(".");
  return dot >= 0 ? t.slice(dot + 1) : t;
}

function colsInParens(item: string): string[] {
  const m = /\(([^)]*)\)/.exec(item);
  if (!m?.[1]) return [];
  return m[1].split(",").map((c) => cleanIdent(c));
}

function refAction(item: string): { onDelete?: ReferentialAction; onUpdate?: ReferentialAction } {
  const out: { onDelete?: ReferentialAction; onUpdate?: ReferentialAction } = {};
  const del = /on\s+delete\s+(cascade|restrict|set null|no action)/i.exec(item);
  if (del?.[1]) out.onDelete = del[1].toLowerCase() as ReferentialAction;
  const upd = /on\s+update\s+(cascade|restrict|set null|no action)/i.exec(item);
  if (upd?.[1]) out.onUpdate = upd[1].toLowerCase() as ReferentialAction;
  return out;
}

function parseForeignKey(item: string, table: Table): void {
  const cols = colsInParens(item.replace(/references[\s\S]*$/i, ""));
  const ref = /references\s+([^\s(]+)\s*\(([^)]*)\)/i.exec(item);
  if (!ref) return;
  table.foreignKeys.push({
    columns: cols,
    refTable: cleanIdent(ref[1] ?? ""),
    refColumns: (ref[2] ?? "").split(",").map((c) => cleanIdent(c)),
    ...refAction(item),
  });
}

function parseItem(item: string, table: Table, warnings: string[]): void {
  const upper = item.toUpperCase();

  if (upper.startsWith("CONSTRAINT")) {
    // CONSTRAINT <name> <PRIMARY KEY | FOREIGN KEY | UNIQUE> ...
    const rest = item.replace(/^constraint\s+("[^"]+"|`[^`]+`|\w+)\s+/i, "");
    parseItem(rest, table, warnings);
    return;
  }
  if (upper.startsWith("PRIMARY KEY")) {
    table.primaryKey = colsInParens(item);
    return;
  }
  if (upper.startsWith("FOREIGN KEY")) {
    parseForeignKey(item, table);
    return;
  }
  if (upper.startsWith("UNIQUE")) {
    table.indexes.push({ columns: colsInParens(item), unique: true });
    return;
  }
  if (
    upper.startsWith("KEY ") ||
    upper.startsWith("INDEX ") ||
    upper.startsWith("CHECK") ||
    upper.startsWith("PRIMARY KEY(")
  ) {
    return; // not modelled in the IR yet
  }

  parseColumn(item, table, warnings);
}

function parseColumn(item: string, table: Table, warnings: string[]): void {
  const nameMatch = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)\s+([\s\S]+)$/.exec(item);
  if (!nameMatch) {
    warnings.push(`Could not parse: ${item.slice(0, 40)}`);
    return;
  }
  const name = cleanIdent(nameMatch[1] ?? "");
  const rest = nameMatch[2] ?? "";

  const typeMatch =
    /^([a-zA-Z]+(?:\s+(?:precision|varying|with\s+time\s+zone|without\s+time\s+zone))?)\s*(\([^)]*\))?/.exec(
      rest,
    );
  if (!typeMatch) {
    warnings.push(`Could not parse type for column "${name}"`);
    return;
  }
  const typeStr = (typeMatch[1] ?? "") + (typeMatch[2] ?? "");
  const mods = rest.slice(typeMatch[0].length);
  const modsUpper = mods.toUpperCase();

  let type = mapSqlType(typeStr);
  const column: Column = { name, type, nullable: !/NOT\s+NULL/.test(modsUpper) };

  // AUTO_INCREMENT / serial → treat as serial with an autoincrement default.
  if (/AUTO_INCREMENT/.test(modsUpper) && type.kind === "int") {
    type = { kind: "serial", size: type.size };
    column.type = type;
  }
  if (type.kind === "serial") column.default = { kind: "autoincrement" };

  if (/PRIMARY\s+KEY/.test(modsUpper)) table.primaryKey = [name];
  if (/\bUNIQUE\b/.test(modsUpper)) column.unique = true;

  const def = /default\s+('(?:[^']|'')*'|[^\s,]+)/i.exec(mods);
  if (def?.[1] && column.default === undefined) column.default = parseDefault(def[1]);

  const ref = /references\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i.exec(mods);
  if (ref) {
    table.foreignKeys.push({
      columns: [name],
      refTable: cleanIdent(ref[1] ?? ""),
      refColumns: ref[2] ? ref[2].split(",").map((c) => cleanIdent(c)) : ["id"],
      ...refAction(mods),
    });
  }

  table.columns.push(column);
}

function parseDefault(raw: string): DefaultValue {
  const t = raw.trim();
  if (t.startsWith("'") && t.endsWith("'")) return { kind: "literal", value: t.slice(1, -1) };
  if (/^true$/i.test(t)) return { kind: "literal", value: true };
  if (/^false$/i.test(t)) return { kind: "literal", value: false };
  const n = Number(t);
  if (Number.isFinite(n)) return { kind: "literal", value: n };
  return { kind: "expr", expr: t };
}

function mapSqlType(raw: string): CanonicalType {
  const s = raw.trim().toLowerCase();
  const m = /^([a-z ]+?)\s*(?:\(([^)]*)\))?$/.exec(s);
  const base = (m?.[1] ?? s).trim();
  const params = (m?.[2] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  const n = (i: number): number | undefined => {
    const v = params[i];
    if (v === undefined) return undefined;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  switch (base) {
    case "bigserial":
      return { kind: "serial", size: "big" };
    case "serial":
      return { kind: "serial", size: "regular" };
    case "smallserial":
      return { kind: "serial", size: "small" };
    case "bigint":
    case "int8":
      return { kind: "int", size: "big" };
    case "integer":
    case "int":
    case "int4":
    case "mediumint":
      return { kind: "int", size: "regular" };
    case "smallint":
    case "int2":
      return { kind: "int", size: "small" };
    case "tinyint":
      return n(0) === 1 ? { kind: "boolean" } : { kind: "int", size: "tiny" };
    case "boolean":
    case "bool":
      return { kind: "boolean" };
    case "numeric":
    case "decimal":
      return { kind: "decimal", precision: n(0) ?? 10, scale: n(1) ?? 0 };
    case "real":
    case "float4":
      return { kind: "float" };
    case "double":
    case "double precision":
    case "float8":
    case "float":
      return { kind: "double" };
    case "varchar":
    case "character varying":
    case "char":
    case "character":
    case "nvarchar":
    case "nchar":
      return { kind: "string", length: n(0) ?? 255 };
    case "text":
    case "mediumtext":
    case "longtext":
    case "tinytext":
    case "clob":
      return { kind: "text" };
    case "uuid":
      return { kind: "uuid" };
    case "json":
    case "jsonb":
      return { kind: "json" };
    case "date":
      return { kind: "date" };
    case "time":
      return { kind: "time" };
    case "timestamp":
    case "datetime":
    case "timestamp without time zone":
      return { kind: "datetime" };
    case "timestamptz":
    case "timestamp with time zone":
      return { kind: "timestamptz" };
    case "bytea":
    case "blob":
    case "binary":
    case "varbinary":
      return { kind: "binary" };
    default:
      return { kind: "text" };
  }
}
