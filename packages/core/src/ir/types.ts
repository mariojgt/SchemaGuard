/**
 * SchemaGuard Internal Representation (IR) — the central, dialect-neutral contract.
 *
 * Everything orbits this model: parsers produce it, the canvas renders it, and
 * emitters turn it into DDL. Types are CANONICAL (e.g. `string(255)`), never
 * dialect strings like `VARCHAR(255)` — dialects only matter at the edges.
 *
 * This is the MVP "vertical slice" subset. It is intentionally small but frozen:
 * extend it additively (new fields optional) rather than reshaping it.
 */

export type DialectId = "postgres" | "mysql" | "sqlite";

export type IntSize = "tiny" | "small" | "regular" | "big";

/** Canonical, dialect-neutral column types. */
export type CanonicalType =
  | { kind: "serial"; size: IntSize } // auto-increment integer (PK-style)
  | { kind: "int"; size: IntSize }
  | { kind: "boolean" }
  | { kind: "decimal"; precision: number; scale: number }
  | { kind: "float" }
  | { kind: "double" }
  | { kind: "string"; length: number }
  | { kind: "text" }
  | { kind: "uuid" }
  | { kind: "json" }
  | { kind: "date" }
  | { kind: "time" }
  | { kind: "datetime" }
  | { kind: "timestamptz" }
  | { kind: "binary" };

export type DefaultValue =
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "expr"; expr: string } // raw SQL expression, e.g. now()
  | { kind: "autoincrement" }; // handled by the dialect's serial type

export type ReferentialAction = "cascade" | "restrict" | "set null" | "no action";

export interface Column {
  name: string;
  type: CanonicalType;
  nullable: boolean;
  unique?: boolean;
  default?: DefaultValue;
  comment?: string;
}

export interface Index {
  name?: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKey {
  name?: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /**
   * Where this relationship was discovered. "migration" = declared in the DB
   * schema (a real, enforced constraint). "model" = inferred from an Eloquent
   * relationship method (e.g. belongsTo) — logical only, may have no DB
   * constraint. Undefined is treated as "migration" for back-compat.
   */
  source?: "migration" | "model";
}

export interface Table {
  name: string;
  columns: Column[];
  primaryKey?: string[];
  indexes: Index[];
  foreignKeys: ForeignKey[];
  comment?: string;
}

export interface Schema {
  name?: string;
  tables: Table[];
  sourceDialect?: DialectId;
}
