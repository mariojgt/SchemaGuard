# SchemaGuard — MVP Technical Spec (Visual Schema Builder + Multi-DB SQL)

> **MVP mission:** be a better, design-led alternative to Datascale's SQL diagram tool. Import SQL/DDL → see it as a story-telling diagram → edit it visually → **generate `.sql` files for SQLite, MySQL, and PostgreSQL**. Fully **deterministic and offline** — no AI, no backend, no billing in the MVP. Local-first Tauri + React desktop app.
>
> AI agent, migration _review_, Laravel migration import/export, schema-evolution timeline, and the cloud companion all come **after** this MVP.

---

## 1. Goals & non-goals

### MVP must do

- Open a Tauri desktop app (macOS/Windows/Linux).
- **Import**: paste or open a `.sql` DDL file → parse → **Schema IR** (reverse-engineer, like Datascale).
- **Visualize**: render the schema on a React Flow canvas with the storytelling features (domains, reading altitudes, design-smell overlay).
- **Edit**: add/rename/delete tables and columns, set types/nullability/defaults, draw foreign keys — all on the canvas.
- **Generate**: emit correct, idiomatic DDL for **SQLite, MySQL, PostgreSQL**, written to `.sql` file(s), with feature-gap warnings.
- **Round-trip**: `parse(sql) → edit → emit(sql)` works; re-importing emitted SQL yields an equivalent schema.

### MVP must NOT do

- No AI / agent / natural-language design (next phase).
- No hosted backend, auth, or billing.
- No migration _review_ / risk scoring of changes (that's the other pillar, later).
- No Laravel migration parsing/generation yet (first fast-follow adapter).
- No real-time collaboration (Datascale's strength; cloud-companion phase).
- No live DB connection.

### Definition of done

A user pastes a Postgres `CREATE TABLE` dump, sees a clean domain-grouped diagram with design smells flagged, edits a column, switches the target to MySQL, clicks **Export**, and gets a valid `.sql` file that MySQL accepts — all offline.

---

## 2. The central idea: one Schema IR, three flows

Everything orbits a single in-memory **Schema IR** (intermediate representation). The IR is **dialect-neutral** — it stores _canonical_ types, not `VARCHAR(255)`/`TINYINT(1)`. Dialects only matter at the edges (parse in, emit out).

```text
            ┌──────────── SQL parser (dialect-aware) ────────────┐
  .sql DDL ─┤  node-sql-parser AST  →  map to IR                 ├─► Schema IR
            └─────────────────────────────────────────────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
     Diagram (React Flow)   Domain clustering      Design-smell engine
     edit on canvas         (FK graph)             (deterministic rules)
            │
            ▼
            ┌──────────── DDL emitter (per dialect) ─────────────┐
  Schema IR ┤  canonical types → SQLite | MySQL | PostgreSQL     ├─► .sql file(s)
            └──────────────── + feature-gap warnings ─────────────┘
```

Why an IR (and not just translate SQL→SQL): a neutral model is the only way "design once, emit to any database" stays correct. It also makes the canvas, smells, and domains dialect-independent.

---

## 3. Architecture & project structure

Same shell decision as before — **pure-TS `core/` package** (no DOM/Tauri/Node), React webview, thin Rust I/O.

```text
schemaguard/
├─ src-tauri/                       # Rust shell (file I/O + dialogs only)
│  └─ src/main.rs                   # pick_files, read_file, save_file
├─ src/                             # React + TS frontend
│  ├─ main.tsx · App.tsx
│  ├─ components/
│  │  ├─ Canvas.tsx                 # React Flow wrapper + custom nodes
│  │  ├─ TableNode.tsx · DomainRegion.tsx · GhostFixNode.tsx
│  │  ├─ Inspector.tsx              # edit selected table/column
│  │  ├─ ImportPanel.tsx            # paste / open .sql, pick source dialect
│  │  ├─ ExportDialog.tsx           # pick target dialect(s), preview, save
│  │  └─ SmellPanel.tsx
│  └─ stores/schema.ts              # Zustand: IR + selection + view state
├─ packages/core/                   # pure TS — the engine
│  ├─ src/
│  │  ├─ ir/
│  │  │  ├─ types.ts                # Schema, Table, Column, Index, ForeignKey, Enum
│  │  │  ├─ canonical-types.ts      # canonical type set + params
│  │  │  └─ validate.ts             # PK/FK/type integrity checks
│  │  ├─ dialects/
│  │  │  ├─ dialect.ts              # Dialect interface (the contract)
│  │  │  ├─ postgres.ts             # reference dialect
│  │  │  ├─ mysql.ts
│  │  │  ├─ sqlite.ts
│  │  │  └─ typemap.ts              # canonical ↔ dialect type table
│  │  ├─ parse/
│  │  │  └─ sql.ts                  # node-sql-parser AST → Schema IR
│  │  ├─ emit/
│  │  │  └─ ddl.ts                  # Schema IR → DDL via a Dialect
│  │  ├─ domains/cluster.ts         # FK graph → semantic domains
│  │  ├─ smells/{rules.ts,detect.ts}# design-quality findings
│  │  ├─ graph/build.ts             # Schema IR → React Flow {nodes,edges}
│  │  └─ index.ts                   # public API (below)
│  └─ test/fixtures/                # vitest golden files
└─ package.json                     # pnpm workspace
```

**Stack:** Tauri 2 · React 18 · TypeScript (strict) · Zustand · `@xyflow/react` (React Flow) · `node-sql-parser` (import) · Tailwind · Monaco (SQL preview/paste) · Vitest.

### Public core API

```ts
parseSql(sql: string, source: Dialect): { schema: Schema; warnings: Warning[] };
emitDdl(schema: Schema, target: Dialect, opts?: EmitOptions): { sql: string; warnings: Warning[] };
detectDomains(schema: Schema): Domain[];
detectSmells(schema: Schema): Smell[];
buildGraph(schema: Schema, opts: GraphOptions): { nodes: FlowNode[]; edges: FlowEdge[] };
validate(schema: Schema): ValidationIssue[];
```

All pure and synchronous; the Rust layer only moves strings/files.

---

## 4. Schema IR (`ir/types.ts`)

```ts
type DialectId = "postgres" | "mysql" | "sqlite";

interface Schema {
  name?: string;
  tables: Table[];
  enums: EnumType[]; // named enums (PG native; emulated elsewhere)
  sourceDialect?: DialectId; // where it was imported from, if any
}

interface Table {
  name: string;
  columns: Column[];
  primaryKey?: string[]; // column names
  indexes: Index[];
  foreignKeys: ForeignKey[];
  comment?: string; // surfaced as the node's "purpose" note
  domainId?: string; // assigned by domain clustering
}

interface Column {
  name: string;
  type: CanonicalType; // see §5 — NOT a dialect string
  nullable: boolean;
  default?: DefaultValue; // literal | expr (NOW(), etc.) | autoincrement
  unique?: boolean;
  comment?: string;
}

interface ForeignKey {
  columns: string[];
  refTable: string;
  refColumns: string[];
  onDelete?: "cascade" | "restrict" | "set null" | "no action";
  onUpdate?: "cascade" | "restrict" | "set null" | "no action";
  name?: string;
}

interface Index {
  name?: string;
  columns: string[];
  unique: boolean;
}
interface EnumType {
  name: string;
  values: string[];
}
```

---

## 5. Canonical types & dialect mapping (the heart of the MVP)

The IR uses a **canonical type set**. Each dialect maps canonical → SQL on emit, and SQL → canonical on parse. This table is the product's core IP; get it right and "any database" follows.

### Canonical types

`int(size: tiny|small|regular|big)` · `serial(size)` (auto-increment PK) · `boolean` · `decimal(p,s)` · `float` · `double` · `string(n)` · `text` · `uuid` · `json` · `date` · `time` · `datetime` · `timestamptz` · `binary` · `enum(ref)`

### Mapping matrix (emit direction)

| Canonical          | PostgreSQL                           | MySQL                   | SQLite                              | Notes                               |
| ------------------ | ------------------------------------ | ----------------------- | ----------------------------------- | ----------------------------------- |
| `serial(big)` (PK) | `BIGSERIAL` / `GENERATED … IDENTITY` | `BIGINT AUTO_INCREMENT` | `INTEGER PRIMARY KEY AUTOINCREMENT` | SQLite forces `INTEGER` rowid alias |
| `int(regular)`     | `INTEGER`                            | `INT`                   | `INTEGER`                           |                                     |
| `boolean`          | `BOOLEAN`                            | `TINYINT(1)`            | `INTEGER` (0/1)                     | ⚠ degraded outside PG               |
| `decimal(p,s)`     | `NUMERIC(p,s)`                       | `DECIMAL(p,s)`          | `NUMERIC`                           | SQLite ignores precision            |
| `string(n)`        | `VARCHAR(n)`                         | `VARCHAR(n)`            | `TEXT`                              | SQLite has no length cap            |
| `text`             | `TEXT`                               | `TEXT`                  | `TEXT`                              |                                     |
| `uuid`             | `UUID`                               | `CHAR(36)`              | `TEXT`                              | ⚠ no native UUID outside PG         |
| `json`             | `JSONB`                              | `JSON`                  | `TEXT`                              | ⚠ SQLite stores as text             |
| `timestamptz`      | `TIMESTAMPTZ`                        | `TIMESTAMP`             | `TEXT`                              | tz semantics vary; warn             |
| `datetime`         | `TIMESTAMP`                          | `DATETIME`              | `TEXT`                              |                                     |
| `enum(x)`          | `CREATE TYPE x AS ENUM(...)`         | `ENUM(...)` inline      | `TEXT` + `CHECK(col IN (...))`      | ⚠ emulated in MySQL-inline/SQLite   |
| `binary`           | `BYTEA`                              | `BLOB`                  | `BLOB`                              |                                     |

### Feature gaps must be loud, not silent

When emitting degrades a concept, attach a `Warning` to the output (and badge it in the export preview), e.g.:

> ⚠ `users.status` is an enum. SQLite has no native enum — emitted as `TEXT` with a `CHECK (status IN ('active','past_due','canceled'))` constraint.

This honesty (vs. silently producing wrong SQL) is part of the product's value.

### The Dialect contract (`dialects/dialect.ts`)

Each dialect implements one interface so the emitter is generic:

```ts
interface Dialect {
  id: DialectId;
  quoteIdent(name: string): string; // "x" | `x`
  columnType(c: Column): string; // canonical → SQL type
  autoIncrement(c: Column): string; // dialect-specific PK clause
  supportsInlineFk: boolean; // else ALTER TABLE ADD CONSTRAINT
  emitEnum(e: EnumType): string | null; // null ⇒ caller emulates
  ifNotExists: boolean; // CREATE TABLE IF NOT EXISTS support
  warnings(schema: Schema): Warning[]; // upfront feature-gap notices
}
```

---

## 6. SQL import / parser (`parse/sql.ts`)

- Use **`node-sql-parser`** (supports MySQL, PostgreSQL, SQLite, etc.) to lex/parse DDL into its AST. We **do not** write a SQL grammar from scratch.
- Map its AST → our Schema IR: `CREATE TABLE` → `Table`; column defs → `Column` (reverse the type map §5); `PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `INDEX`, `CHECK`-as-enum → IR.
- **Source dialect is user-selected** in the Import panel (parser behaves differently per dialect).
- **Graceful degradation:** statements we can't map (procedures, triggers, vendor-specific DDL) → collected as `warnings` ("N statements not imported"), never silently dropped. Reverse type-mapping that can't resolve falls back to `text` + a warning.
- Implicit relationships: a column named `*_id` with no FK is **not** invented as an FK — it's left as-is and flagged by the smell engine (§8) as "possible missing FK," which the user can accept.

---

## 7. DDL emitter (`emit/ddl.ts`)

- Generic walker over the Schema IR, delegating dialect specifics to the `Dialect`.
- **Ordering-safe output:** emit all `CREATE TABLE`s first (columns, PK, unique, inline FKs only if `supportsInlineFk` and the ref table precedes), then `ALTER TABLE … ADD CONSTRAINT` for remaining FKs, then `CREATE INDEX`. Avoids forward-reference failures.
- Options: `ifNotExists`, `oneFilePerTable` vs single file, `includeDropStatements` (guarded `DROP TABLE IF EXISTS` header), identifier quoting on/off.
- Deterministic formatting (stable column order, consistent indentation) so diffs are clean and golden-file tests are stable.
- Returns SQL string + warnings; UI shows a Monaco preview before saving via the Rust `save_file` command.

---

## 8. Design-smell engine (`smells/`) — our edge over a plain diagram

Deterministic rules over the IR, surfaced as canvas overlays + a side panel + one-click fixes:

| Smell               | Rule                                                   | One-click fix          |
| ------------------- | ------------------------------------------------------ | ---------------------- |
| Unindexed FK        | FK column not covered by any index                     | add `INDEX(col)`       |
| Possible missing FK | `*_id` column, name matches a table PK, no FK declared | add FK                 |
| No primary key      | table has no PK                                        | suggest `id serial` PK |
| Over-wide table     | column count > threshold (e.g. 30)                     | informational          |
| Nullable everything | most columns nullable                                  | informational          |
| Inconsistent naming | mixes `snake_case`/`camelCase`, or `id` vs `userId`    | informational          |
| Orphan table        | no FK in or out                                        | informational          |

Each `Smell` carries `severity` (low/medium), `table`, `column?`, `message`, and an optional `fix` (a structured IR edit). Datascale shows what _is_; this shows what's _wrong and how to fix it_.

---

## 9. Domains & storytelling diagram (deterministic for MVP)

The narrative features from the product doc, all achievable without AI:

- **Domain clustering** (`domains/cluster.ts`): treat tables as nodes and FKs as edges; run connected-components + lightweight community detection (e.g. label-propagation) to group tables. Auto-name domains from the dominant table (`users` → "Auth"), editable by the user. Rendered as colored regions.
- **Reading altitudes:** `domain` (clusters only), `table` (tables + relationships, columns collapsed), `detail` (full columns/types/indexes). Pure render state in Zustand.
- **Relationships in plain English:** edge labels from FK metadata — cardinality + delete behavior ("owns 1:N · cascade").
- **Focus mode:** select a table → dim non-neighbors.
- **"Explain this schema" tour:** MVP version is **templated narration** generated from the IR (hub detection = highest FK in-degree, then walk outward). AI-authored prose is a later upgrade behind the same interface.

> Note: "schema-evolution timeline" and AI narration are explicitly **post-MVP**.

---

## 10. Datascale parity scorecard (MVP)

| Datascale capability               | MVP status                             | Our angle                                                              |
| ---------------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| Reverse-engineer DDL/SQL → diagram | ✅                                     | Same, via node-sql-parser → IR                                         |
| ER diagram                         | ✅                                     | + domains, altitudes, focus mode                                       |
| Implicit relationship detection    | ✅ (flagged, not invented)             | Surfaced as an accept-able smell                                       |
| Export                             | ✅ **multi-dialect `.sql` generation** | They reverse-engineer; we also **forward-engineer to SQLite/MySQL/PG** |
| AI copilot on canvas               | ❌ post-MVP                            | Deterministic builder first                                            |
| Data-pipeline lineage              | ❌ post-MVP                            | Reframed later as schema-evolution timeline                            |
| Real-time collaboration            | ❌ post-MVP                            | Cloud-companion phase                                                  |

The MVP wins on **forward-engineering to many databases** + **design-quality overlay** + **narrative diagram**; it concedes AI, lineage, and multiplayer for now.

---

## 11. State (Zustand) & Rust commands

```ts
interface SchemaState {
  schema: Schema;
  target: DialectId; // export target
  altitude: "domain" | "table" | "detail";
  designOverlay: boolean;
  selected: { table?: string; column?: string };
  // mutations operate on the IR, then recompute smells/domains/graph
  applyEdit(edit: SchemaEdit): void;
  setTarget(d: DialectId): void;
}
```

Rust (`src-tauri`): `pick_files()`, `read_file(path)`, `save_file(name, contents)`. Allowlist: `dialog` + scoped `fs` only. No `http`, no `shell`.

---

## 12. Validation (`ir/validate.ts`)

Before export: every FK references an existing table/column; FK column types match referenced PK types; no duplicate table/column names; PK columns exist; warn on reserved words per target dialect. Validation issues block export with a clear message (not a crash).

---

## 13. Testing

- **Golden files:** `IR → SQL` per dialect (one fixture schema → three expected `.sql` files).
- **Round-trip:** `parseSql(emitDdl(schema, d), d)` ≈ `schema` for each dialect (structural equality, ignoring formatting).
- **Type-map matrix:** every canonical type → expected SQL per dialect, both directions.
- **Smell fixtures:** schemas with/without each smell → expected findings.
- **Parser degradation:** vendor-specific dumps → expected warning counts, no crash.

---

## 14. Build order

1. pnpm workspace + Tauri + React + React Flow boot ("hello canvas").
2. Schema IR types + a hand-built sample schema → render on canvas.
3. **Postgres** dialect + emitter → export `.sql` (reference dialect first).
4. Add **MySQL** + **SQLite** dialects + the type-map + feature-gap warnings.
5. SQL import via node-sql-parser → IR → canvas (prove round-trip).
6. Inspector editing (tables, columns, types, FK drawing) → live re-emit.
7. Domains clustering + altitudes + design-smell overlay + one-click fixes.
8. Export dialog (target picker, Monaco preview, save) + templated "explain" + UI polish.

---

## 15. Code style & conventions

### 15.1 State — Zustand

Thin store holding the IR + view state (§11); all schema logic stays in pure `core/`. The store holds **results and edits**, never parsing/emitting behavior.

### 15.2 Formatting — Prettier (owns formatting)

```jsonc
// .prettierrc.json
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "arrowParens": "always",
}
```

### 15.3 Linting — ESLint flat config (owns correctness)

`typescript-eslint` strict-type-checked + `eslint-plugin-react` + `react-hooks` + `jsx-a11y` + `simple-import-sort`, with `eslint-config-prettier` last. `no-explicit-any` error, `no-floating-promises` error, and a `no-restricted-imports` overlay banning DOM/Node/Tauri inside `packages/core`.

### 15.4 TypeScript

`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `verbatimModuleSyntax`. `packages/core` compiles with `"lib": ["ES2022"]` (no `dom`) — the engine can never reach the browser.

### 15.5 Naming

Components `PascalCase.tsx`, **named exports only**. Hooks `useThing`. Core modules `camelCase.ts`, pure functions. Types `PascalCase` (`interface` for object shapes, `type` for unions). No abbreviations except `id`, `ir`, `sql`, `fk`, `pk`.

### 15.6 Rust

`rustfmt` + `clippy -D warnings`; commands stay trivial.

### 15.7 Enforcement

husky + lint-staged on commit (`prettier --write`, `eslint --fix`, `cargo fmt`/`clippy`); CI runs lint + format:check + typecheck + test + `cargo fmt --check` + `clippy -D warnings`. Conventional Commits.

---

## 16. Open questions

1. **node-sql-parser coverage** — validate its SQLite + Postgres DDL support against real dumps early; if gaps are large, we may need targeted post-processing. Decide before step 5.
2. **Enum strategy** — PG native type vs inline; for MySQL inline `ENUM` vs lookup table; expose as an emit option?
3. **ALTER/migration generation** — emitting a diff between two schema states (not just full CREATE) is the natural next feature; keep the IR diff-friendly now even though it's post-MVP.
4. **Identifier case-folding** — Postgres lowercases unquoted idents, MySQL is case-sensitive by OS; decide a normalization policy to keep round-trips stable.
