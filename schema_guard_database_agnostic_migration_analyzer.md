# SchemaGuard — AI Schema Designer & Migration Safety Tool

## Working Name

**SchemaGuard**

Alternative names:

- **Migration Lens**
- **Schema Studio**
- **MigraLens**
- **Schema Architect**
- **DB Copilot**

---

## One-Line Product Description

**SchemaGuard is a desktop app that helps developers, leads, and architects design the perfect database schema and review migrations safely — combining a deterministic analysis engine with an AI agent and a visual schema-flow canvas.**

Laravel-first experience, database-agnostic internally.

---

## Product Shape (read this first)

This is a **local-first desktop application**, not a web SaaS.

- **Shell:** Tauri (Rust core + web frontend).
- **Frontend / logic:** TypeScript. Deterministic parsing, diffing, and risk rules run **locally** inside the app.
- **AI:** Handled through a thin **hosted backend** that proxies LLM calls via the **Vercel AI SDK** (`ai-sdk.dev`). This gives a managed, billable AI experience and a clean path to AI-agent features later.
- **Cloud companion (future):** A GitHub PR review bot lives on that same backend in a later phase. The desktop app does not handle webhooks itself.

Why this split:

- Local-first keeps schema/source code on the user's machine for the parsing/diff/risk work (privacy + speed for a dev tool).
- A small hosted backend is still required because AI is **managed** (we proxy the model, meter usage, and bill). That backend is reused for the future GitHub bot, so it is not throwaway infrastructure.

---

## Main Idea

SchemaGuard does two related jobs:

1. **Design** — help a developer or architect build a clean, correct schema with an AI agent and a visual canvas, before any migration is written.
2. **Review** — read existing migration files or schema changes, explain them in plain English, and flag risky operations before they reach production.

It works across database engines, but starts with a strong **Laravel-first** experience.

The real value is helping teams answer:

- What is the cleanest way to model this part of the schema?
- What does this migration do?
- Which tables and columns are affected?
- Is this migration safe to deploy? Could it cause data loss or lock a large table?
- Are indexes or foreign keys missing or inconsistent?
- Is this migration safely reversible (`down()`)?
- What should a reviewer check before approving this change?
- How can this change be documented automatically?

---

## Target Users

### Primary Audience

Laravel developers, tech leads, and software architects designing and reviewing database schemas — solo devs, SaaS teams, and agencies.

### Secondary Audience

Teams using other frameworks or databases that still want AI-assisted schema design, migration safety checks, and documentation.

Examples:

- Laravel teams (first-class)
- Symfony / Rails / Django teams
- Node.js teams using Prisma, Knex, Drizzle, or TypeORM
- SaaS agencies maintaining many client projects
- CTOs, tech leads, and architects reviewing database changes

---

## Core Positioning

Bad positioning:

> A database diagram tool.

Better positioning:

> A database migration safety reviewer.

Best positioning:

> A desktop AI copilot for database schemas: design clean schemas with an AI agent on a visual canvas, then catch risky migrations before they reach production.

---

## Why This Is Useful

**On the design side**, schemas are often built ad-hoc, leading to missing indexes, inconsistent naming, weak relationships, and decisions nobody documented.

**On the review side**, migrations are risky because they can:

- Drop important data
- Break existing application code
- Fail in production because of duplicate or invalid data
- Lock large tables during deployment
- Add slow queries because indexes are missing
- Create inconsistent relationships
- Rename columns without a safe transition plan
- Add non-null columns or foreign keys that fail against existing rows
- Ship a `down()` that loses data or can't actually roll back

Most teams do all of this manually. SchemaGuard makes both design and review faster, clearer, and safer.

---

## Product Goals

### Main Goals

- **Design:** AI-assisted schema design on a visual flow canvas.
- **Review:** Explain migrations in plain English and detect risky operations deterministically.
- Support **Laravel migrations and Eloquent models first**.
- Build a **database-agnostic internal engine** (adapters in, common AST through the middle).
- Generate automatic schema/migration documentation.
- Provide a clean foundation for **AI-agent workflows** via the Vercel AI SDK.

### Non-Goals for v1

- Not a full enterprise database-design platform.
- Not competing head-on with dbdiagram, Azimutt, Eraser, or Miro on diagramming alone.
- Not supporting every framework on day one.
- **No** connection to a live production database in v1 (static analysis only — see "Static vs. Live Analysis").
- No complex workflow automation in the first version.
- No GitHub PR bot in v1 (deferred to the cloud-companion phase).

---

## Static vs. Live Analysis (important honesty note)

Many high-value warnings depend on **existing data**, e.g.:

- "Add unique index" → only fails if duplicates already exist.
- "Add non-null column" → only fails if rows already exist.
- "Add foreign key" → only fails if orphan rows exist.

v1 does **static analysis only** and therefore reports _conditional_ risk:

> ⚠️ This **could** fail if duplicate values already exist in `users.email`. SchemaGuard cannot confirm this without database access.

A later phase may add **optional, read-only local DB introspection** (user-initiated, connecting to their dev/staging DB) to upgrade conditional warnings into confirmed ones. We never require or auto-connect to production.

This distinction must be honest in the UI and the marketing copy — a false "looks safe" is worse than no answer for a safety tool.

---

## v1 Scope

The first version should be focused and demoable.

> **MVP re-scope (current build target).** The shipping MVP is a **deterministic Visual Schema Builder + Multi-DB SQL generator** — import SQL/DDL, edit a story-telling diagram, and export `.sql` for **SQLite, MySQL, and PostgreSQL**. **No AI and no backend in the MVP.** This is the direct, design-led Datascale alternative and the foundation everything else plugs into. See `phase_1_technical_spec.md` for the build spec.
>
> The features below (AI Designer, migration review, Laravel) describe the **full product vision** and are sequenced **after** the MVP: AI agent next, then Laravel migration import/export, then review/safety, then the cloud companion. Treat Feature 1's "AI" framing as the post-MVP target, not the first release.

### Feature 1: AI Schema Designer (the hero feature — post-MVP)

The user describes what they want to model in natural language ("I need users, subscriptions, and invoices for a SaaS"). The AI agent, grounded by the deterministic core, proposes:

- Tables, columns, types, and nullability
- Relationships and foreign keys
- Indexes (including the ones people forget)
- A generated **Laravel migration** + optional Eloquent models

Everything appears on the visual canvas and is editable. The agent explains its choices and the user can iterate conversationally.

### Feature 2: Paste / Open Migration (review)

The user pastes a Laravel migration or opens migration files from disk. The app returns:

- Summary (plain English)
- Affected tables
- Added / removed / modified columns
- Added indexes and foreign keys
- Risk level (+ reasons)
- `down()` / reversibility assessment
- Suggested reviewer checklist
- Safer migration recommendation

### Feature 3: Project Folder Analysis

Open a Laravel project (or its `database/migrations` folder). The app analyzes all migrations together, replays them into a derived schema, and groups changes by table.

Example output:

```text
Tables affected:
- users
- subscriptions
- payments

High-risk changes:
- users.phone is dropped
- subscriptions.status is changed from string to enum-like values
- payments.transaction_id is added without a unique index
```

### Feature 4: Visual Schema-Flow Canvas

Use **React Flow** (`@xyflow/react`) for an interactive canvas. Two modes:

- **Schema view** — tables, columns, relationships (the design surface).
- **Change-flow view** — migration → table → operation → risk → suggestion.

Change-flow example:

```text
Migration File
    ↓
Table: users
    ↓
Drop Column: phone
    ↓
Risk: High
    ↓
Suggestion: phased migration + backup
```

### Feature 5: Risk Checker

Risk levels:

- **Low** — safe additive changes
- **Medium** — may affect performance or existing data
- **High** — destructive or production-sensitive
- **Critical** — likely to fail or cause data loss without preparation

| Operation                           |        Risk | Reason                                |
| ----------------------------------- | ----------: | ------------------------------------- |
| Add nullable column                 |         Low | Usually safe                          |
| Add non-null column without default |        High | Can fail on existing rows             |
| Drop column                         |        High | Causes data loss                      |
| Rename column                       | Medium/High | Can break deployed code               |
| Change column type                  |        High | Can fail or corrupt assumptions       |
| Add unique index                    |        High | Fails if duplicate data exists        |
| Add foreign key                     | Medium/High | Fails if existing records are invalid |
| Drop table                          |    Critical | Deletes all table data                |
| Add index to large table            |      Medium | Can lock or slow production database  |
| Make column nullable                |      Medium | Can break validation assumptions      |
| Make column not nullable            |        High | Fails if null values already exist    |
| Irreversible / data-losing `down()` | Medium/High | Rollback would not restore state      |

### Feature 6: Documentation & Export

- Markdown report of the analysis.
- Auto-generated table/column purpose docs (AI-assisted).
- Export the designed schema as a Laravel migration.

---

## Laravel-First Features

### Laravel Inputs

```text
database/migrations/*.php
app/Models/*.php
database/factories/*.php
database/seeders/*.php
```

### Laravel Migration Operations to Detect

Detect common Schema Builder calls:

```php
Schema::create()   Schema::table()   Schema::drop()   Schema::dropIfExists()
$table->id()  $table->uuid()  $table->string()  $table->text()  $table->integer()
$table->boolean()  $table->timestamp()  $table->foreignId()  $table->foreign()
$table->references()  $table->constrained()  $table->cascadeOnDelete()
$table->nullable()  $table->unique()  $table->index()
$table->dropColumn()  $table->renameColumn()  $table->dropIndex()
```

### Parse Confidence (don't pretend the parser is perfect)

Real migrations contain loops, conditionals, variables, traits, closures, and `DB::statement()` / raw SQL. A static parser handles the common 80% cleanly; the rest must degrade gracefully:

- Every operation carries a **parse confidence** (`high` / `partial` / `unknown`).
- Anything the parser can't fully resolve becomes an `unknown_operation` and is surfaced explicitly ("⚠️ SchemaGuard couldn't fully parse this block — review manually"), never silently dropped.
- Risk is never reported as "Low/safe" for code that wasn't fully understood.

### Laravel Model Relationship Detection

Later versions parse Eloquent models to detect:

```php
hasOne()  hasMany()  belongsTo()  belongsToMany()
morphOne()  morphMany()  morphTo()  morphToMany()
```

This lets the tool cross-check what the migration declares against what the models expect:

```text
The orders table has user_id, but no foreign key constraint was found.
The Order model has a belongsTo(User::class) relationship, so you may want to add a
foreign key or document why it is intentionally missing.
```

---

## Database-Agnostic Core

SchemaGuard is not Laravel-only internally. Laravel is one **adapter**. Every source is converted into a common internal format.

### Internal Migration AST

```json
{
  "source": "laravel",
  "database": "mysql",
  "operations": [
    {
      "type": "add_column",
      "table": "users",
      "column": "billing_email",
      "data_type": "string",
      "nullable": true,
      "default": null,
      "parse_confidence": "high"
    },
    {
      "type": "add_index",
      "table": "users",
      "columns": ["billing_email"],
      "index_type": "normal",
      "parse_confidence": "high"
    }
  ]
}
```

### Supported Operation Types

```text
create_table   drop_table   rename_table
add_column   drop_column   rename_column   change_column
add_index   drop_index   add_unique_index
add_foreign_key   drop_foreign_key
add_primary_key   drop_primary_key
raw_sql   unknown_operation
```

### Adapter Architecture

```text
Source Adapter (Laravel / SQL / Prisma / ...)
        ↓
Internal Migration AST  ──►  Derived Schema Model
        ↓
Risk Engine (deterministic rules)
        ↓
Explainer + AI Agent (Vercel AI SDK, via hosted backend)
        ↓
Visual Schema-Flow Engine (React Flow)
        ↓
Report / Markdown Export / (future) GitHub Comment
```

### Future Adapters

Raw SQL · Prisma · Rails · Django · Knex · TypeORM · Drizzle · Liquibase · Flyway

---

## Database Engine Support

**MVP targets: SQLite, MySQL, and PostgreSQL** — all three for the SQL builder (import + generation). Later: MariaDB, SQL Server, Oracle.

These are not just "supported" — the MVP **generates correct, idiomatic DDL for each**, via a canonical-type → dialect mapping layer with loud feature-gap warnings when a concept degrades (e.g. enum → `CHECK` on SQLite). See `phase_1_technical_spec.md` §5.

Different engines also carry different _risks_ (e.g. index-locking behavior). That risk-awareness belongs to the later review pillar; the MVP focuses on correct cross-dialect generation, not migration risk.

---

## AI Architecture

### Principle

AI is an **assistant grounded by deterministic code**, never the source of truth for structure.

| Deterministic core (local)              | AI layer (hosted, Vercel AI SDK) |
| --------------------------------------- | -------------------------------- |
| Parse migrations into the AST           | Plain-English explanations       |
| Detect tables / columns / indexes / FKs | Reviewer checklist generation    |
| Build the derived schema & diff         | Documentation generation         |
| Apply base risk rules                   | Suggested safer migration plan   |
| Build the visual graph                  | Conversational schema design     |
| Compute parse confidence                | "Why is this risky" narration    |

The AI proposes; the deterministic engine validates structure and risk. This keeps the product reliable.

### Why Vercel AI SDK

- **Model-agnostic** via provider packages — Anthropic, OpenAI, local models — so you can swap or A/B models without rewriting app logic.
- First-class **streaming**, **tool calling**, and a built-in **agent loop** — the right foundation for the "AI agent integration later" goal (the agent can call deterministic tools like `proposeColumn`, `checkRisk`, `generateMigration`).
- TypeScript-native, fits the Tauri webview stack.

**Default to the latest Claude models** through the SDK's Anthropic provider (e.g. Opus 4.8 for deep reasoning / agentic design, Sonnet 4.6 for fast everyday explanations), with the provider abstraction making other models drop-in.

### AI as Tools (the agent foundation)

Expose the deterministic engine to the model as tools the agent can call:

```text
listSchema()            → current derived schema
proposeTable(spec)      → validated table proposal
proposeColumn(spec)     → validated column proposal (type, nullable, default)
checkRisk(operation)    → deterministic risk verdict
suggestIndexes(table)   → index recommendations
generateMigration(ast)  → Laravel migration code
```

This means the AI can _design conversationally_ but every structural change is validated by code before it lands on the canvas.

---

## Risk Engine Rules

Deterministic, data-driven rules (extensible):

```json
[
  {
    "operation": "drop_column",
    "risk": "high",
    "reason": "Dropping a column can permanently delete data and break application code."
  },
  {
    "operation": "add_nullable_column",
    "risk": "low",
    "reason": "Adding a nullable column is usually safe."
  },
  {
    "operation": "add_not_null_column_without_default",
    "risk": "high",
    "reason": "Existing rows may violate the new constraint."
  },
  {
    "operation": "add_unique_index",
    "risk": "high",
    "reason": "The migration can fail if duplicate values already exist."
  },
  { "operation": "drop_table", "risk": "critical", "reason": "Deletes all data in the table." },
  {
    "operation": "irreversible_down",
    "risk": "high",
    "reason": "The down() method cannot restore dropped data, so rollback is unsafe."
  },
  {
    "operation": "raw_sql",
    "risk": "medium",
    "reason": "Raw SQL requires manual review because it may contain database-specific behavior."
  },
  {
    "operation": "unknown_operation",
    "risk": "medium",
    "reason": "SchemaGuard could not fully parse this operation; review manually."
  }
]
```

---

## Visual UI Concept

### Main Screens

1. **Dashboard / Recent Projects**
2. **AI Schema Designer** (chat + canvas)
3. **Open / Paste Migration** (review)
4. **Visual Schema-Flow Canvas**
5. **Risk Report**
6. **Documentation Export**
7. **Settings** (AI model, account/billing, project paths)

### Designer Layout (the "badass UI" — chat-driven canvas)

```text
┌───────────────────────────────────────────────────────────────────┐
│ SchemaGuard — Acme SaaS                          [model: Opus 4.8] │
├──────────────────────┬────────────────────────────────────────────┤
│  AI Agent            │  Visual Canvas (React Flow)                 │
│                      │                                             │
│  > add billing to    │   ┌────────┐        ┌──────────────┐        │
│    the users flow    │   │ users  │───1:N──│ subscriptions│        │
│                      │   └────────┘        └──────────────┘        │
│  ✓ proposed table    │        │                                    │
│    `invoices`        │   ┌──────────┐                              │
│  ✓ added FK + index  │   │ invoices │ (new)                        │
│  ⚠ unique on email   │   └──────────┘                              │
│    could fail        │                                             │
├──────────────────────┴────────────────────────────────────────────┤
│ Risk Report:  Low: add nullable billing_email · Medium: uniqueness │
│ decision pending · Suggestion: confirm if billing_email is unique  │
└───────────────────────────────────────────────────────────────────┘
```

---

## Design System & Style

SchemaGuard is a **dark-first developer tool**. The aesthetic: calm dark surfaces, one blue→purple accent gradient for primary/AI actions, and a strict semantic color scale for risk so severity is never ambiguous. These tokens are the single source of truth for the React UI and the React Flow canvas — implement them as CSS custom properties (and mirror into the Tailwind theme).

### Color Tokens

| Token        | Hex       | Use                                             |
| ------------ | --------- | ----------------------------------------------- |
| `--bg`       | `#0b0e14` | App background (deepest layer)                  |
| `--panel`    | `#11151f` | Side panels, toolbars                           |
| `--panel-2`  | `#161b27` | Cards, nodes, raised surfaces                   |
| `--line`     | `#222a3a` | Borders, dividers, grid lines                   |
| `--ink`      | `#e6ebf5` | Primary text                                    |
| `--dim`      | `#8b97ad` | Secondary text                                  |
| `--faint`    | `#5b6679` | Tertiary text, captions                         |
| `--accent`   | `#6ea8fe` | Primary accent (blue) — links, selection, focus |
| `--accent-2` | `#7c5cff` | Secondary accent (purple) — AI/agent, gradients |

### Semantic Risk Scale (do not reuse these for anything else)

| Token         | Hex       | Meaning                             |
| ------------- | --------- | ----------------------------------- |
| `--risk-low`  | `#3ecf8e` | Low / safe / additive               |
| `--risk-med`  | `#f6c453` | Medium / design smell / conditional |
| `--risk-high` | `#ff8a5b` | High / destructive                  |
| `--risk-crit` | `#ff5c7a` | Critical / data loss                |

> The risk scale is reserved. Domains, decoration, and charts must not borrow these four hues, or severity loses meaning. Domain clusters use the accent family (blue/purple/green) at low opacity instead.

### Gradients & Effects

- **Primary / AI gradient:** `linear-gradient(135deg, #6ea8fe, #7c5cff)` — buttons, the agent send button, the logo, "Explain this schema".
- **Glow** (AI/active only): `box-shadow: 0 6px 18px rgba(124,92,255,.35)`.
- **Canvas grid:** 26px dot/line grid in `--line` over `--bg`, with a soft radial accent wash at low opacity.
- **Node elevation:** `box-shadow: 0 10px 30px rgba(0,0,0,.45)`; selected node gets a 1px `--accent` ring; ghost/suggested nodes use a dashed `--risk-low` border at ~92% opacity.

### Typography

- **UI font:** system stack — `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` (no web-font dependency; fast, native feel).
- **Mono font** (types, code, identifiers): `ui-monospace, SFMono-Regular, Menlo, monospace`.
- Body 14px / line-height 1.5. Section eyebrows: 12px, uppercase, `letter-spacing: .12em`, color `--faint`.

### Shape & Spacing

- **Radius:** 12px cards/nodes, 8–10px buttons/inputs, 20px pills/badges.
- **Borders:** 1px `--line` everywhere; 1.5px dashed for domains and ghost suggestions.
- **Spacing scale:** 6 / 8 / 10 / 12 / 16 px. Panels pad 12–16px.

### Component Conventions

- **Buttons:** secondary = `--panel-2` + `--line` border; primary/AI = the gradient with glow.
- **Badges/pills:** tinted background at ~12% opacity + matching 1px border at ~50% (e.g. a Low badge = `--risk-low` text on `rgba(62,207,142,.12)`).
- **Domain regions:** dashed rounded rectangle in the domain's accent at ~45% border opacity, label chip top-left.
- **Risk overlay:** a column with a smell gets a `--risk-med` tinted row + inline flag; the node carries a floating pill.

### Reference Implementation

The published UI mockup is the canonical visual reference for these tokens — it implements the full palette, the storytelling canvas, domains, the design-smell overlay, and the guided-tour callout. Treat it as the style spec the React components should match.

---

## Node Types (canvas)

- **Table Node** — table name, operation type, changed-column count, risk level.
- **Column Node** — name, type, nullable, default, index status.
- **Relationship Node** — source table, target table, delete behavior, constraint name.
- **Risk Node** — severity, reason, suggested action.
- **AI Explanation Node** — summary, reviewer checklist, safer plan.
- **Source Node** (review mode) — file name, framework, migration class name.

---

## Competitive Benchmark: Datascale → and how SchemaGuard tells a clearer story

Datascale (`getdatascale.com`) is the closest reference point: an AI-native, web-based, **collaborative** tool that reverse-engineers DDL / Views / SQL / CTEs into **ER diagrams** and **data-pipeline lineage**, with a chat-on-canvas AI copilot. It targets **data engineers** (dbt, CTAS, warehouse lineage).

We match its categories, but we serve a different user (app developers, leads, architects on Laravel) and we win on the thing the user actually wants: **the diagram should tell a story and make people design better schemas** — not just render an accurate map.

### Parity + Improvement Matrix

| Datascale category            | What it does                    | SchemaGuard parity                             | How we go further                                                                     |
| ----------------------------- | ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reverse-engineer from SQL/DDL | DDL, views, queries → model     | ✅ Laravel migrations + SQL/DDL → Internal AST | We also parse **migrations & Eloquent models**, not just static DDL                   |
| ER diagram                    | Boxes + FK lines                | ✅ Schema view                                 | **Semantic domains, progressive zoom, narrated story** (below)                        |
| Implicit PK/FK detection      | Infers relationships from joins | ✅ Infer FKs from `*_id` + model relations     | We **flag the missing FK as a design smell**, not just draw it                        |
| Data lineage (DAG)            | Pipeline/CTAS lineage           | ↔ **Schema-evolution timeline** instead        | We show _how a table changed across migrations over time_ — more relevant to app devs |
| AI copilot on canvas          | Chat with selected nodes        | ✅ Agent grounded by deterministic tools       | Our AI **proposes validated changes**, not free-text guesses                          |
| Doc generation                | Design docs / PRDs              | ✅ Table/column purpose docs                   | Docs are **attached to nodes as their "why"**, shown in the story                     |
| Collaboration / multiplayer   | Real-time web canvas            | ⏳ Deferred (local-first desktop)              | Comes with the **cloud companion** phase; not a v1 priority                           |
| Export / embed                | Public boards                   | ✅ Markdown + image/migration export           | Plus **Laravel migration generation** from the canvas                                 |
| Pricing                       | $8–12/user/mo (web seat)        | —                                              | Desktop + managed-AI tiers (see Pricing)                                              |

> Honest gap: Datascale's **real-time multiplayer** is a genuine strength we don't match in v1 because we're local-first desktop. We treat collaboration as a cloud-companion feature, not a launch blocker.

### The Storytelling Diagram (our core differentiator)

A normal ER diagram is a _map_ — every table and line at once, equally weighted, no narrative. SchemaGuard's canvas is a _story_. Concretely:

1. **Semantic domains.** Auto-cluster tables into labeled, color-coded contexts (Billing, Auth, Catalog…) so the first thing a user sees is _what the system is about_, not a wall of tables.
2. **Three reading altitudes (progressive disclosure).** Zoom reveals the story in layers: **Domain map** → **Table map** (relationships, columns collapsed) → **Full detail** (columns, types, indexes). Datascale dumps everything at once; we let it unfold.
3. **Relationships in plain English.** Edges aren't just lines with crow's-feet — hover gives a sentence: _"A User owns many Invoices; deleting a User cascades to its Invoices."_ Cardinality **and** delete behavior shown visually.
4. **"Explain this schema" guided tour.** The AI narrates a step-through: starts at the hub table, walks the relationships in reading order, highlighting each node as it explains. This is the single biggest "tells a clearer story" feature — turn a diagram into a walkthrough.
5. **Design-quality overlay (the moat).** A toggle paints **design smells** onto the diagram: missing index on a FK, a `*_id` column with no FK, tables with no primary key, over-wide tables, nullable columns in critical paths, inconsistent naming. Datascale shows what _is_; we show what's _wrong and how to fix it_.
6. **Inline suggestions as ghost nodes.** Proposed fixes appear as dashed/ghost nodes and edges ("add index here", "add FK here") the user can accept with one click — design-forward, not just descriptive.
7. **Focus mode.** Click a table → the canvas dims everything except its neighborhood and tells that table's local story. Kills overwhelm on large schemas.
8. **Change-as-story (diff animation).** In review mode, the diagram animates **before → after** for a migration, highlighting exactly what changed and its risk. Datascale has no concept of this — it's where our review pillar and the canvas meet.
9. **Intent annotations.** Every table/column can carry an AI-drafted **purpose note** surfaced in the story ("`billing_email` is the invoice address, distinct from login email"), so the diagram explains _why_, not just _what_.

The throughline: **understand → design better.** Datascale helps you _see_ your schema. SchemaGuard helps you _understand_ it and _improve_ it — comprehension and design quality are the axes we compete on, and they're the same axes our safety engine already lives on.

Sources: [Datascale SQL Diagram](https://getdatascale.com/sqldiagram) · [Datascale home](https://getdatascale.com/) · [SQL→ERD docs](https://getdatascale.com/docs/sql-to-erd) · [Lineage](https://getdatascale.com/lineage)

---

## Example Review Output (High-Risk)

```markdown
## SchemaGuard Migration Review

### Summary

This change modifies the `users` table and removes the `phone` column.

### Changes Detected

- Drops `users.phone`
- Changes `users.email` to be unique

### Risk Level

**High**

### Why This Is Risky

- Dropping `phone` permanently removes existing data.
- Making `email` unique **can fail** if duplicate emails already exist (cannot confirm without DB access).
- Existing application code may still depend on `users.phone`.
- The `down()` method recreates `phone` but cannot restore its data → rollback is lossy.

### Recommended Checks

- Confirm no code still reads or writes `users.phone`
- Back up phone values before deployment
- Check for duplicate emails before adding the unique constraint
- Consider a phased migration:
  1. Stop writing to `phone`
  2. Back up the data
  3. Deploy app code without `phone`
  4. Drop the column in a later release
```

---

## Suggested Tech Stack

### Desktop App (local-first)

- **Tauri** (Rust core + web frontend)
- **TypeScript**
- **React 18** + **React Flow** (`@xyflow/react`) for the canvas
- **Tailwind CSS**
- **Monaco Editor** for migration/code preview
- **Vercel AI SDK** client (`ai`, `@ai-sdk/*`) for streaming chat + tool calls

### Parser / Core (local, deterministic)

- PHP tokenizer + AST parsing for Laravel migrations & models
- Custom Laravel Schema Builder interpreter → Internal AST
- Schema "replay" engine (apply operations → derived schema model)
- Dialect-aware SQL parsing (future, MySQL/PostgreSQL)

### Hosted Backend (thin, for managed AI)

- AI proxy using the **Vercel AI SDK** (server side) → Anthropic / others
- Usage metering + billing (Stripe)
- Auth / licensing for the desktop app
- **Reused later** for the GitHub PR-bot cloud companion

---

## Data Model

Local app data (SQLite in-app) + minimal server-side billing/usage records.

### Project (local)

`id · name · framework · database_engine · project_path · created_at · updated_at`

### Analysis (local)

`id · project_id · source_type · branch_name · commit_sha · status · risk_level · summary · created_at`

### MigrationFile (local)

`id · analysis_id · filename · content_hash · raw_content · parse_confidence · parsed_successfully · created_at`

### SchemaOperation (local)

`id · analysis_id · migration_file_id · operation_type · table_name · column_name · payload_json · parse_confidence · risk_level`

### RiskFinding (local)

`id · analysis_id · schema_operation_id · severity · title · description · recommendation`

### VisualNode (local)

`id · analysis_id · node_type · label · position_x · position_y · payload_json`

### Account / Usage (server)

`id · user_id · plan · ai_tokens_used · period_start · period_end`

> `content_hash` is used to cache AI results — identical migration content never pays for the same AI call twice.

---

## Build Roadmap

### Phase 1 — Visual Schema Builder + Multi-DB SQL (MVP, deterministic, offline)

- Tauri app shell + React Flow canvas + Zustand
- **Schema IR** + canonical-type → dialect mapping (SQLite, MySQL, PostgreSQL)
- SQL/DDL **import** (parse → IR) and **export** (IR → `.sql` per dialect) with feature-gap warnings
- Visual editing, domain clustering, reading altitudes, design-smell overlay + one-click fixes
- Templated "explain this schema" tour
- **Success:** import a Postgres dump, edit visually, export valid MySQL `.sql` — all offline. (Full spec: `phase_1_technical_spec.md`)

### Phase 2 — AI Schema Designer

- Hosted AI backend (Vercel AI SDK proxy) + auth + Stripe billing
- Conversational schema design with the agent calling deterministic tools (validated by the IR)
- AI-authored "explain" prose, doc generation, design suggestions on the canvas
- **Success:** a dev describes a feature and gets a clean, validated schema + SQL on the canvas.

### Phase 3 — Laravel Adapter

- Import Laravel migrations + Eloquent models → Schema IR (with parse confidence)
- Generate Laravel migrations from the canvas (IR → migration code)
- **Success:** the Laravel-first promise lands — round-trip between migrations and the builder.

### Phase 4 — Migration Review & Safety

- Diff two schema states → migration operations + risk engine (`down()` reversibility, destructive-change detection)
- Optional read-only local DB introspection to confirm conditional risks ("could fail" → "will fail")
- **Success:** the safety pillar — review a change and know if it's safe to ship.

### Phase 5 — Cloud Companion & Expansion

- GitHub PR bot on the backend (auto-analyze migration changes, comment with risk)
- Real-time collaboration; more adapters (Prisma, Rails, Django); MariaDB / SQL Server / Oracle dialects
- **Success:** team workflow + true framework/database breadth.

---

## Pricing

Billing is needed because AI is managed/hosted (we pay for inference).

### Free

- Paste / open migration, review & risk score (local)
- Limited AI explanations per month
- No saved cloud history

### Solo — £9/month

- Full local review + saved analyses
- Generous AI explanation quota
- AI Schema Designer (basic)
- Markdown export

### Team — £39/month

- Higher AI quota
- Full AI Schema Designer + migration generation
- Shared/exported reports
- Multiple projects

### Pro — £99/month

- Top AI quota + model selection (Opus/Sonnet)
- Advanced risk rules + optional DB introspection
- AI documentation generation
- GitHub PR bot (when shipped)
- Priority support

### Agency — £199/month

- Many client projects
- White-label / client-facing documentation exports
- Multi-repo dashboard (with cloud companion)

> Power users who bring their own API key can be offered a discounted "BYO-key" tier later if demand appears — but managed AI is the default.

---

## Landing Page Copy

### Hero

**Design the perfect schema. Catch dangerous migrations before they ship.**

SchemaGuard is a desktop AI copilot for database schemas — design clean schemas on a visual canvas, then review migrations for risk, in plain English. Laravel-first, database-friendly.

### Subheading

Describe what you want to model and let the AI agent draft tables, relationships, and indexes — validated by a deterministic engine, not guessed. Or open a migration and get an instant safety review.

### CTA

**Download SchemaGuard** · **Design your first schema**

---

## Main Differentiator

Most tools either _draw_ a diagram or _lint_ SQL.

SchemaGuard does both halves of the job a senior engineer does — **helps you design the schema right, and tells you whether a change is safe to ship** — with an AI agent grounded by a deterministic core, on the desktop.

---

## Best First Demo

1. Type "add a billing system to my SaaS" → agent proposes tables, FKs, indexes on the canvas
2. Generate the Laravel migration from the canvas
3. Open an existing risky migration → app marks a dropped column as High risk and explains why
4. Show the plain-English review + reviewer checklist
5. Export a Markdown report

Demo title:

**I built a desktop AI copilot that designs database schemas and catches dangerous Laravel migrations.**

---

## Final Recommendation

Build SchemaGuard as a **Tauri desktop app**, **design-led** (AI Schema Designer is the hero, migration review is the strong second pillar), with a **deterministic local core** and a **thin hosted backend** for managed AI via the **Vercel AI SDK**. Keep the engine **database-agnostic internally** but ship a **Laravel-first** experience. Defer the **GitHub PR bot** to the cloud-companion phase on that same backend.

Starting position:

> SchemaGuard is a Laravel-first desktop AI copilot that designs clean database schemas on a visual canvas and reviews migrations for risk — built on a deterministic engine, ready to grow into full AI-agent workflows.
