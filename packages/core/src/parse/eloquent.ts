/**
 * Best-effort parser for Eloquent model relationships.
 *
 * Migrations only describe relationships that are physically enforced in the DB
 * (`->foreign()` / `->constrained()`). A great deal of Laravel relationship
 * intent lives *only* in the model classes — and many projects never add DB
 * constraints at all. This parser reads the relationship methods and turns them
 * into a structured list we can both (a) overlay on the diagram and (b) browse
 * in the Models tab.
 *
 * It is intentionally regex-based and conservative: it captures the common
 * shapes (`return $this->hasMany(Comment::class)`) and ignores anything it
 * can't confidently map. It never guesses a target it didn't read.
 */
import type { ForeignKey, Schema, Table } from "../ir/types";

export type RelationKind =
  | "belongsTo"
  | "hasOne"
  | "hasMany"
  | "belongsToMany"
  | "hasOneThrough"
  | "hasManyThrough"
  | "morphTo"
  | "morphOne"
  | "morphMany"
  | "morphToMany"
  | "morphedByMany";

/** Coarse grouping used for diagram styling + grouping in the UI. */
export type RelationCategory = "one" | "many" | "manyToMany" | "polymorphic";

export interface ModelRelation {
  /** The declaring model class, e.g. "Post". */
  model: string;
  /** The declaring model's table, e.g. "posts". */
  table: string;
  /** The relation method name, e.g. "comments". */
  method: string;
  kind: RelationKind;
  category: RelationCategory;
  /** Related model class (absent for morphTo, which is open-ended). */
  relatedModel?: string;
  /** Related table, resolved by Eloquent naming (absent for morphTo). */
  relatedTable?: string;
  /** For belongsTo only: the FK column this model owns (used to merge a real FK). */
  fkColumn?: string;
}

/** Parsed metadata for a single Eloquent model class — its "table properties". */
export interface ModelInfo {
  model: string;
  table: string;
  /** Mass-assignable attributes (`protected $fillable`). */
  fillable: string[];
  /** Mass-assignment blocklist (`protected $guarded`). */
  guarded: string[];
  /** Attributes hidden from serialization (`protected $hidden`). */
  hidden: string[];
  /** Attribute casts (`protected $casts`): column -> cast type. */
  casts: Record<string, string>;
  /** Accessors appended to arrays (`protected $appends`). */
  appends: string[];
  /** Custom primary key, when declared (default "id"). */
  primaryKey?: string;
  /** created_at / updated_at maintained (default true). */
  timestamps: boolean;
  /** Uses the SoftDeletes trait (deleted_at). */
  softDeletes: boolean;
  /** Custom non-incrementing key (`public $incrementing = false`). */
  incrementing: boolean;
  /** Relations declared on this model. */
  relations: ModelRelation[];
}

export interface EloquentParseResult {
  relations: ModelRelation[];
  models: ModelInfo[];
  warnings: string[];
}

const CATEGORY: Record<RelationKind, RelationCategory> = {
  belongsTo: "one",
  hasOne: "one",
  hasOneThrough: "one",
  hasMany: "many",
  hasManyThrough: "many",
  belongsToMany: "manyToMany",
  morphTo: "polymorphic",
  morphOne: "polymorphic",
  morphMany: "polymorphic",
  morphToMany: "polymorphic",
  morphedByMany: "polymorphic",
};

function pluralize(word: string): string {
  if (word.endsWith("y")) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}s`;
  return `${word}s`;
}

/** "BlogPost" -> "blog_post", "User" -> "user". */
function toSnake(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

/** "App\\Models\\BlogPost" / "BlogPost::class" / "'App\\User'" -> "BlogPost". */
function classBaseName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/::class$/, "");
  s = s.replace(/^['"]|['"]$/g, "");
  const parts = s.split(/\\+/);
  return (parts[parts.length - 1] ?? "").trim();
}

/** Eloquent's default table name for a model class: snake_case + pluralized. */
function tableForClass(className: string): string {
  return pluralize(toSnake(className));
}

/** Split a call's argument list on top-level commas (args here are simple). */
function splitArgs(inner: string): string[] {
  return inner
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

function modelClassName(content: string): string | null {
  const m = /\bclass\s+([A-Za-z_]\w*)\b/.exec(content);
  return m ? (m[1] ?? null) : null;
}

/** The table this model maps to, honoring an explicit `protected $table`. */
function modelTable(content: string, className: string): string {
  const explicit = /\$table\s*=\s*['"]([^'"]+)['"]/.exec(content);
  if (explicit?.[1]) return explicit[1];
  return tableForClass(className);
}

// Match `function <name>() { ... ->relationKind( args ) ... }`, where the body
// is constrained to a single function (the negative lookahead stops it from
// spilling into the next `function`, which would mis-attribute a relation).
// Longer kind names come first so alternation prefers them.
const RELATION =
  /function\s+(\w+)\s*\([^)]*\)[^{]*\{(?:(?!\bfunction\b)[\s\S])*?->\s*(belongsToMany|belongsTo|hasOneThrough|hasManyThrough|hasMany|hasOne|morphToMany|morphedByMany|morphMany|morphOne|morphTo)\s*\(([^)]*)\)/g;

/** Extract a PHP string-array property (`$name = ['a', 'b']`). */
function stringArrayProp(content: string, name: string): string[] {
  const re = new RegExp(`\\$${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = re.exec(content);
  if (!m) return [];
  return [...(m[1] ?? "").matchAll(/'([^']*)'|"([^"]*)"/g)]
    .map((x) => x[1] ?? x[2] ?? "")
    .filter((s) => s.length > 0);
}

/** Extract a PHP assoc-array property of string pairs (`$casts = ['c' => 't']`). */
function assocProp(content: string, name: string): Record<string, string> {
  const re = new RegExp(`\\$${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m");
  const m = re.exec(content);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const p of (m[1] ?? "").matchAll(/'([^']+)'\s*=>\s*'?([\w\\:,]+)'?/g)) {
    if (p[1] && p[2]) out[p[1]] = p[2];
  }
  return out;
}

/** Relations declared in a single model's source. */
function relationsInFile(content: string, model: string, table: string): ModelRelation[] {
  const rels: ModelRelation[] = [];
  let m: RegExpExecArray | null;
  RELATION.lastIndex = 0;
  while ((m = RELATION.exec(content)) !== null) {
    const method = m[1] ?? "";
    const kind = m[2] as RelationKind;
    const args = splitArgs(m[3] ?? "");
    const rel: ModelRelation = { model, table, method, kind, category: CATEGORY[kind] };

    if (kind !== "morphTo") {
      const relatedModel = classBaseName(args[0] ?? "");
      if (relatedModel) {
        rel.relatedModel = relatedModel;
        rel.relatedTable = tableForClass(relatedModel);
      }
    }
    if (kind === "belongsTo" && rel.relatedModel) {
      const explicitCol = args[1] ? classBaseName(args[1]) : "";
      rel.fkColumn = explicitCol || `${toSnake(rel.relatedModel)}_id`;
    }
    rels.push(rel);
  }
  return rels;
}

/**
 * Parse a folder of Eloquent model files into per-model metadata + a flat
 * relation list. Files with no model class contribute nothing.
 */
export function parseModelFiles(files: { name: string; content: string }[]): EloquentParseResult {
  const models: ModelInfo[] = [];
  const relations: ModelRelation[] = [];

  for (const file of files) {
    const model = modelClassName(file.content);
    if (!model) continue;
    const c = file.content;
    const table = modelTable(c, model);
    const rels = relationsInFile(c, model, table);

    const pk = /\$primaryKey\s*=\s*['"]([^'"]+)['"]/.exec(c)?.[1];
    const info: ModelInfo = {
      model,
      table,
      fillable: stringArrayProp(c, "fillable"),
      guarded: stringArrayProp(c, "guarded"),
      hidden: stringArrayProp(c, "hidden"),
      casts: assocProp(c, "casts"),
      appends: stringArrayProp(c, "appends"),
      timestamps: !/\$timestamps\s*=\s*false/.test(c),
      softDeletes: /\bSoftDeletes\b/.test(c),
      incrementing: !/\$incrementing\s*=\s*false/.test(c),
      relations: rels,
      ...(pk ? { primaryKey: pk } : {}),
    };
    models.push(info);
    relations.push(...rels);
  }

  const warnings: string[] = [];
  if (relations.length === 0 && files.length > 0) {
    warnings.push("No Eloquent relationships were found in the selected models folder.");
  }
  return { relations, models, warnings };
}

/** @deprecated use {@link parseModelFiles}. Kept for the relation-only callers. */
export function parseModelRelations(
  files: { name: string; content: string }[],
): EloquentParseResult {
  return parseModelFiles(files);
}

function fkExists(table: Table, column: string): boolean {
  return table.foreignKeys.some((fk) => fk.columns.length === 1 && fk.columns[0] === column);
}

/**
 * Overlay `belongsTo` relations onto a schema as real foreign keys, in place.
 * Adds a `source: "model"` FK only when (a) the owning table exists, (b) it has
 * the FK column, and (c) no FK already covers it (migration FKs always win).
 * Returns the number of FKs actually added.
 */
export function mergeModelRelationships(schema: Schema, relations: ModelRelation[]): number {
  let added = 0;
  for (const rel of relations) {
    if (rel.kind !== "belongsTo" || !rel.relatedTable || !rel.fkColumn) continue;
    const table = schema.tables.find((t) => t.name === rel.table);
    if (!table) continue; // don't invent tables the migrations never created
    if (fkExists(table, rel.fkColumn)) continue; // a constraint already covers it
    if (!table.columns.some((c) => c.name === rel.fkColumn)) continue;
    const fk: ForeignKey = {
      columns: [rel.fkColumn],
      refTable: rel.relatedTable,
      refColumns: ["id"],
      source: "model",
    };
    table.foreignKeys.push(fk);
    added++;
  }
  return added;
}
