/**
 * Migration Safety / Risk engine.
 *
 * The schema importer only keeps the *final* state. This module instead reads
 * the actual operations a migration performs — including the destructive ones
 * the importer ignores (dropColumn, dropTable, change(), renames) — and the
 * presence of a `down()` method, then scores how risky the migration is to run
 * against a populated production database.
 *
 * It is regex-based and deliberately conservative: it flags the well-known
 * dangerous shapes and stays quiet otherwise.
 */
export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export type MigrationOpKind =
  | "createTable"
  | "dropTable"
  | "renameTable"
  | "addColumn"
  | "dropColumn"
  | "renameColumn"
  | "changeColumn"
  | "addForeignKey"
  | "dropForeignKey"
  | "addIndex"
  | "dropIndex";

export interface MigrationOp {
  kind: MigrationOpKind;
  table: string;
  column?: string;
  detail?: string;
}

export interface RiskFinding {
  level: RiskLevel;
  text: string;
}

export interface MigrationRisk {
  level: RiskLevel;
  ops: MigrationOp[];
  findings: RiskFinding[];
  /** A non-empty down() method is present. */
  hasDown: boolean;
}

const ORDER: RiskLevel[] = ["none", "low", "medium", "high", "critical"];
function maxLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

/** Extract a named method body (`up`/`down`) via balanced braces. */
function methodBody(source: string, name: string): string | null {
  const m = new RegExp(`function\\s+${name}\\s*\\(\\s*\\)\\s*(?::\\s*void\\s*)?\\{`).exec(source);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

function balancedFrom(src: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return src.slice(openIndex + 1, i);
  }
  return null;
}

function mkOp(kind: MigrationOpKind, table: string, column?: string, detail?: string): MigrationOp {
  return { kind, table, ...(column ? { column } : {}), ...(detail ? { detail } : {}) };
}

/** Names inside a `dropColumn('a')` / `dropColumn(['a','b'])` argument. */
function namesIn(stmt: string): string[] {
  const arg = /\(([^)]*)\)/.exec(stmt)?.[1] ?? "";
  return [...arg.matchAll(/'([^']+)'|"([^"]+)"/g)].map((m) => m[1] ?? m[2] ?? "").filter(Boolean);
}

const TYPE_METHOD =
  /->\s*(id|uuid|ulid|string|char|text|mediumText|longText|tinyText|integer|unsignedInteger|bigInteger|unsignedBigInteger|foreignId|foreignIdFor|smallInteger|tinyInteger|boolean|decimal|unsignedDecimal|float|double|json|jsonb|date|time|dateTime|dateTimeTz|timestamp|timestampTz|year|binary|enum|set|morphs|timestamps|softDeletes|rememberToken)\s*\(/;

function firstColumnName(stmt: string): string | undefined {
  const m = /->\s*\w+\s*\(\s*(['"])([^'"]+)\1/.exec(stmt);
  return m ? m[2] : undefined;
}

/** Parse the statements inside an alter (`Schema::table`) block into ops. */
function alterOps(table: string, body: string): MigrationOp[] {
  const ops: MigrationOp[] = [];
  for (const raw of body.split(";")) {
    const stmt = raw.trim();
    if (!stmt.startsWith("$table->")) continue;

    if (/->\s*dropColumn\s*\(/.test(stmt)) {
      for (const c of namesIn(stmt)) ops.push(mkOp("dropColumn", table, c));
    } else if (/->\s*dropMorphs\s*\(/.test(stmt)) {
      ops.push(mkOp("dropColumn", table, `${namesIn(stmt)[0] ?? ""}_*`));
    } else if (/->\s*(dropForeign|dropConstrainedForeignId)\s*\(/.test(stmt)) {
      ops.push(mkOp("dropForeignKey", table, namesIn(stmt)[0]));
    } else if (/->\s*(dropIndex|dropUnique|dropPrimary|dropSpatialIndex|dropFullText)\s*\(/.test(stmt)) {
      ops.push(mkOp("dropIndex", table, namesIn(stmt)[0]));
    } else if (/->\s*renameColumn\s*\(/.test(stmt)) {
      const n = namesIn(stmt);
      ops.push(mkOp("renameColumn", table, n[0], `${n[0] ?? ""} → ${n[1] ?? ""}`));
    } else if (/->\s*change\s*\(\s*\)/.test(stmt)) {
      ops.push(mkOp("changeColumn", table, firstColumnName(stmt)));
    } else if (/->\s*(foreign|constrained)\s*\(/.test(stmt)) {
      ops.push(mkOp("addForeignKey", table, firstColumnName(stmt)));
    } else if (TYPE_METHOD.test(stmt)) {
      // A column being added to an existing table. Risky only when it's NOT
      // NULL with no default — that fails on a table that already has rows.
      const nullable =
        /->\s*nullable\s*\(/.test(stmt) ||
        /->\s*(timestamps|nullableTimestamps|softDeletes|rememberToken|morphs)\s*\(/.test(stmt);
      const hasDefault = /->\s*(default|useCurrent)\s*\(/.test(stmt);
      const isAutoKey = /->\s*(id|increments|bigIncrements)\s*\(/.test(stmt);
      const danger = !nullable && !hasDefault && !isAutoKey;
      ops.push(mkOp("addColumn", table, firstColumnName(stmt), danger ? "not-null-no-default" : undefined));
    }
  }
  return ops;
}

/** Extract every notable operation from a migration body (up or down). */
export function extractOps(body: string): MigrationOp[] {
  const ops: MigrationOp[] = [];
  const re =
    /Schema::(create|table|drop|dropIfExists|rename)\s*\(\s*(['"])([^'"]+)\2(?:\s*,\s*(['"])([^'"]+)\4)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const op = m[1] ?? "";
    const table = m[3] ?? "";
    if (op === "drop" || op === "dropIfExists") {
      ops.push({ kind: "dropTable", table });
      continue;
    }
    if (op === "rename") {
      ops.push({ kind: "renameTable", table, detail: `${table} → ${m[5] ?? ""}` });
      continue;
    }
    const braceStart = body.indexOf("{", re.lastIndex);
    const inner = braceStart === -1 ? null : balancedFrom(body, braceStart);
    if (op === "create") {
      ops.push({ kind: "createTable", table });
      continue; // adding columns to a brand-new table is safe
    }
    if (inner !== null) ops.push(...alterOps(table, inner));
  }
  return ops;
}

function opFinding(op: MigrationOp): RiskFinding | null {
  const where = op.column ? `${op.table}.${op.column}` : op.table;
  switch (op.kind) {
    case "dropTable":
      return { level: "critical", text: `Drops table "${op.table}" — all of its data is lost.` };
    case "dropColumn":
      return { level: "high", text: `Drops column ${where} — data in that column is lost.` };
    case "changeColumn":
      return {
        level: "high",
        text: `Changes column ${where} — can lock the table and lose data on type narrowing.`,
      };
    case "renameColumn":
      return {
        level: "high",
        text: `Renames ${op.detail ?? where} — breaks any code or query using the old name.`,
      };
    case "renameTable":
      return {
        level: "high",
        text: `Renames table ${op.detail ?? op.table} — breaks code referencing the old name.`,
      };
    case "addColumn":
      return op.detail === "not-null-no-default"
        ? {
            level: "high",
            text: `Adds NOT NULL column ${where} with no default — fails if the table already has rows.`,
          }
        : null;
    case "dropForeignKey":
      return { level: "medium", text: `Drops a foreign key on ${where} — referential integrity is removed.` };
    case "dropIndex":
      return { level: "medium", text: `Drops an index on ${where} — queries relying on it may slow down.` };
    default:
      return null;
  }
}

/** Analyze one migration file's source into a risk assessment. */
export function analyzeMigrationSource(source: string): MigrationRisk {
  const up = methodBody(source, "up") ?? source;
  const down = methodBody(source, "down");
  const hasDown = down !== null && down.replace(/\/\/[^\n]*/g, "").trim().length > 0;

  const ops = extractOps(up);
  const findings: RiskFinding[] = [];
  let level: RiskLevel = "none";

  for (const op of ops) {
    const f = opFinding(op);
    if (f) {
      findings.push(f);
      level = maxLevel(level, f.level);
    }
  }

  // A destructive migration with no way back is worse.
  const destructive = ops.some((o) =>
    ["dropTable", "dropColumn", "changeColumn", "renameColumn", "renameTable"].includes(o.kind),
  );
  if (destructive && !hasDown) {
    findings.push({
      level: "high",
      text: "No down() method — this destructive migration can't be rolled back.",
    });
    level = maxLevel(level, "high");
  }

  return { level, ops, findings, hasDown };
}
