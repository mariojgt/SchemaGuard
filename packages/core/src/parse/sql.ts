import type {
  CanonicalType,
  Column,
  DefaultValue,
  Index,
  ReferentialAction,
  Schema,
  Table,
} from "../ir/types";

export interface SqlParseResult {
  schema: Schema;
  warnings: string[];
}

/**
 * Parse raw SQL DDL into the Schema IR. Handles hand-written DDL as well as
 * real database dumps (`mysqldump`, `pg_dump`): line/block comments are
 * stripped, foreign keys and indexes declared in standalone `ALTER TABLE` /
 * `CREATE INDEX` statements are merged back onto their table, and non-DDL noise
 * (INSERT data, SET, GRANT, COMMENT, sequences…) is ignored.
 */
export function parseSql(source: string): SqlParseResult {
  const warnings: string[] = [];
  const tables: Table[] = [];
  const byName = new Map<string, Table>();

  for (const raw of splitStatements(stripComments(source))) {
    const stmt = raw.trim();
    if (stmt.length === 0) continue;

    if (/^create\s+(?:temporary\s+|temp\s+|unlogged\s+)?table\b/i.test(stmt)) {
      const table = parseCreateTable(stmt, warnings);
      if (table) {
        tables.push(table);
        byName.set(table.name, table);
      }
    } else if (/^alter\s+table\b/i.test(stmt)) {
      applyAlterTable(stmt, byName, warnings);
    } else if (/^create\s+(?:unique\s+)?index\b/i.test(stmt)) {
      applyCreateIndex(stmt, byName, warnings);
    }
    // Anything else (INSERT, SET, CREATE SEQUENCE, COMMENT, GRANT…) is ignored.
  }

  return { schema: { name: "Imported", tables }, warnings };
}

/** A single backslash, built without a literal to avoid escaping pitfalls. */
const BACKSLASH = String.fromCharCode(92);

/** Remove SQL line comments (-- … and # …) and block comments, quote-aware. */
function stripComments(src: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === BACKSLASH && quote !== "`" && next !== undefined) {
        out += next;
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if ((ch === "-" && next === "-") || ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++; // skip the closing "*", loop's i++ skips "/"
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Split into statements on top-level `;` (outside quotes and parentheses). */
function splitStatements(src: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === BACKSLASH && quote !== "`" && i + 1 < src.length) {
        cur += src[i + 1];
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      if (cur.trim().length > 0) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

/** Parse a single `CREATE TABLE name (…)` statement into a table. */
function parseCreateTable(stmt: string, warnings: string[]): Table | null {
  const m = /create\s+(?:temporary\s+|temp\s+|unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([^\s(]+)\s*\(/i.exec(
    stmt,
  );
  if (!m) return null;
  const name = cleanIdent(m[1] ?? "");
  const openIndex = m.index + m[0].length - 1; // m[0] ends with "("
  const body = balancedParens(stmt, openIndex);
  if (body === null) return null;
  const table: Table = { name, columns: [], indexes: [], foreignKeys: [] };
  for (const item of splitTopLevel(body)) {
    parseItem(item.trim(), table, warnings);
  }
  return table;
}

/** Merge a standalone `ALTER TABLE … ADD …` statement onto its table. */
function applyAlterTable(stmt: string, byName: Map<string, Table>, warnings: string[]): void {
  const m =
    /^alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?("[^"]+"|`[^`]+`|[^\s(]+)([\s\S]*)$/i.exec(
      stmt,
    );
  if (!m) return;
  const name = cleanIdent(m[1] ?? "");
  const table = byName.get(name);
  if (!table) {
    warnings.push(`ALTER TABLE on unknown table "${name}" — skipped.`);
    return;
  }
  for (const clause of splitTopLevel(m[2] ?? "")) {
    const add = /^\s*add\s+(?:column\s+)?([\s\S]+)$/i.exec(clause);
    if (!add) continue; // DROP / MODIFY / ALTER COLUMN / OWNER TO / … — not modelled
    parseItem((add[1] ?? "").trim(), table, warnings);
  }
}

/** Merge a standalone `CREATE [UNIQUE] INDEX … ON table (…)` onto its table. */
function applyCreateIndex(stmt: string, byName: Map<string, Table>, warnings: string[]): void {
  const head =
    /^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:("[^"]+"|`[^`]+`|[\w.]+)\s+)?on\s+(?:only\s+)?("[^"]+"|`[^`]+`|[\w.]+)/i.exec(
      stmt,
    );
  if (!head) return;
  const tableName = cleanIdent(head[3] ?? "");
  const table = byName.get(tableName);
  if (!table) {
    warnings.push(`CREATE INDEX on unknown table "${tableName}" — skipped.`);
    return;
  }
  const open = stmt.indexOf("(", head.index + head[0].length);
  if (open < 0) return;
  const inner = balancedParens(stmt, open);
  if (inner === null) return;
  const cols = inner
    .split(",")
    .map((p) => cleanIdent(p.trim().split(/\s+/)[0] ?? ""))
    .filter((c) => c.length > 0 && !c.includes("(")); // skip expression indexes
  if (cols.length === 0) return;
  const index: Index = { columns: cols, unique: Boolean(head[1]) };
  if (head[2]) index.name = cleanIdent(head[2]);
  table.indexes.push(index);
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

/** Record a (possibly named) table-level index. */
function pushIndex(item: string, table: Table, unique: boolean): void {
  const cols = colsInParens(item);
  if (cols.length === 0) return;
  const index: Index = { columns: cols, unique };
  const named = /\b(?:key|index)\s+("[^"]+"|`[^`]+`|\w+)\s*\(/i.exec(item);
  if (named?.[1]) index.name = cleanIdent(named[1]);
  table.indexes.push(index);
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
    pushIndex(item, table, true);
    return;
  }
  if (
    upper.startsWith("KEY ") ||
    upper.startsWith("INDEX ") ||
    upper.startsWith("FULLTEXT") ||
    upper.startsWith("SPATIAL")
  ) {
    pushIndex(item, table, false);
    return;
  }
  if (upper.startsWith("CHECK")) {
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
