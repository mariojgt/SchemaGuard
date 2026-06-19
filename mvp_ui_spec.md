# SchemaGuard — MVP Interface Spec (Enterprise-Polished Schema Builder)

> Companion to `phase_1_technical_spec.md`. This document defines **what the main interface looks like**, **every panel, function, and button**, and **how to make it feel like a premium enterprise tool** (think Linear / TablePlus / DataGrip, not a hobby app). Visual tokens come from the **Design System & Style** section of the product doc; this spec applies them.

---

## 1. What "enterprise-polished" means here (principles)

Polish is not decoration — it's the absence of friction plus consistent craft. The MVP must hit all of these:

1. **Restraint.** Neutral dark surfaces, one blue→purple accent, semantic risk colors reserved for risk only. Color carries meaning, never mood.
2. **Density done right.** Information-rich but never cramped — a strict 4/8px spacing grid, generous line-height in data tables, tabular numerals for numeric columns.
3. **Keyboard-first.** A **Command Palette (⌘/Ctrl-K)** can reach every action. Every button has a shortcut shown in its tooltip. Power users never need the mouse.
4. **Predictable, persistent layout.** Resizable, collapsible panels; layout, zoom, and target dialect persist between sessions.
5. **Always-available feedback.** Autosave indicator, live validation badge, non-blocking toasts for success/errors, skeleton/loading states — the app always tells you its status.
6. **Purposeful motion.** 120–180ms ease transitions for panels, selection, and node focus. No bouncing, no gratuitous animation. Motion confirms an action; it never entertains.
7. **Considered empty states.** First-run and empty panels guide the user ("Import SQL or add your first table") instead of showing a void.
8. **One icon system.** Lucide-style 1.5px stroke icons, consistent sizing (16/18px). No emoji in the chrome.
9. **Native respect.** Tauri window chrome, OS traffic lights on macOS, native file dialogs, correct ⌘ vs Ctrl per platform.
10. **Accessibility as polish.** Visible focus rings, AA contrast, full keyboard navigation, ARIA roles on the canvas and tables.

---

## 2. Window anatomy

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ◐ ◑ ◒   🛡 SchemaGuard   ·  Acme SaaS ▾        ⌘K Search…    [Import] [Export ▾] │  ← Top bar
├──────────────┬──────────────────────────────────────────────┬─────────────────┤
│              │  ⌖ Domains  Tables  Detail   ⊕ ⊖ ⤢   🔍 Design │                 │
│  EXPLORER    │  ───────────── canvas toolbar ──────────────── │   INSPECTOR     │
│              │                                                │                 │
│ ⌕ search     │            ┌────────┐      ┌──────────────┐    │  Table: users   │
│ ▾ Auth       │            │ users  │──1:N─│ subscriptions│    │  ───────────    │
│   • users    │            └────────┘      └──────────────┘    │  Columns  [+]   │
│ ▾ Billing    │                 │                              │  id   bigint PK │
│   • subs     │            ┌──────────┐                        │  name varchar   │
│   • invoices │            │ invoices │  ⚠                     │  email varchar  │
│ ▾ Enums      │            └──────────┘                        │  ...            │
│   • status   │                                       ◳ minimap│  Indexes  [+]   │
│ [+ Table]    │                                                │  Foreign keys   │
├──────────────┴──────────────────────────────────────────────┴─────────────────┤
│ ⚠ 3 issues   │  Design & Issues  │  SQL Preview (PostgreSQL ▾)   │  ✓ Saved      │  ← Bottom dock
│  • invoices.user_id has no index  …                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

Five regions: **Top bar · Explorer (left) · Canvas (center) · Inspector (right) · Bottom dock**. Left, right, and bottom are collapsible (⌘1 / ⌘2 / ⌘3).

---

## 3. Top bar

Left → right:

| Element                          | Function                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Window controls                  | OS-native (traffic lights on macOS)                                              |
| Logo + **SchemaGuard**           | Brand; click = home/recent                                                       |
| **Schema name ▾** (`Acme SaaS`)  | Inline-rename; dropdown: New, Open `.sql`, Open recent, Save, Save As, Duplicate |
| **⌘K Search**                    | Command palette + global search (tables, columns, actions)                       |
| **Import** button                | Opens Import dialog (§7)                                                         |
| **Export ▾** (primary, gradient) | Opens Export SQL dialog (§8); dropdown quick-exports to last target              |
| **Undo / Redo**                  | ⌘Z / ⌘⇧Z; disabled when unavailable                                              |
| Overflow **⋯**                   | Settings, keyboard shortcuts, about                                              |

The Export button is the only gradient/primary control in the chrome — it's the money action.

---

## 4. Explorer (left sidebar)

The structural index of the schema. Width resizable, collapsible (⌘1).

- **Search field** (`⌕`) — fuzzy-filter tables, columns, enums.
- **Grouped tree**, collapsible sections:
  - **Domains** — auto-detected clusters (Auth, Billing…), each expandable to its tables. Domains are renamable inline.
  - **Tables** (flat list toggle for users who don't want domains).
  - **Enums** — named enum types and their values.
- **Row affordances:** click = select + center on canvas; double-click = focus mode; right-click = context menu (Rename, Duplicate, Delete, Add column, Copy as SQL).
- **Inline status dots:** a small amber dot on a table that has a design smell.
- **Footer buttons:** `+ Table`, `+ Enum`. Bottom-left shows the **validation badge** (`⚠ 3 issues` / `✓ Valid`) — clicking jumps to the Issues tab.

Empty state: "No tables yet — **Import SQL** or **Add a table** to start."

---

## 5. Canvas (center) — the schema diagram

React Flow surface. **Canvas toolbar** floats top-left:

| Control                                        | Function                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| **Altitude switch:** Domains / Tables / Detail | Progressive disclosure (collapse to clusters → tables → full columns) |
| **Zoom ⊕ / ⊖ / ⤢ Fit**                         | Zoom out/in, fit-to-screen                                            |
| **⤢ Auto-layout**                              | Re-run dagre layout (tidy arrangement)                                |
| **🔍 Design check** (toggle, shows count)      | Paint design-smell overlays on/off                                    |
| **▶ Explain**                                  | Start the templated guided tour (step through tables)                 |

Canvas behaviors (polish details):

- **Table nodes** show header (icon + name + domain tag) and column rows (name, key badge PK/FK, type in mono). Selected node gets the accent ring.
- **Drag to create FK:** drag from a column's handle to another table's column → FK created, edge labeled with cardinality + delete behavior.
- **Alignment guides + snapping** when dragging nodes; nodes never overlap-lock.
- **Domain regions** rendered as dashed, low-opacity colored rectangles behind their tables, label chip top-left.
- **Design-smell overlays:** flagged column row tinted amber + inline flag; floating pill on the node; a dashed **ghost "suggested fix"** node the user can accept.
- **Minimap** bottom-right; **grid background**; right-click canvas = context menu (Add table, Fit, Auto-layout, Export view as PNG).
- **Multi-select** (shift/marquee) → move/delete/group into a domain.

Empty state: a centered card — "Drop a `.sql` file, paste DDL, or add your first table."

---

## 6. Inspector (right panel) — context-sensitive editor

The editing surface. Content depends on selection. Collapsible (⌘2).

### When a TABLE is selected

- **Table name** (inline edit) + domain assignment dropdown.
- **Columns** section — an editable data grid, one row per column:
  - `name` (text) · `type` (dropdown of canonical types + params, e.g. `varchar(n)`) · `nullable` (checkbox) · `default` (input) · badges/toggles for **PK**, **unique**, **index** · FK indicator.
  - Row actions: drag-handle to reorder, `⋯` (duplicate, delete), `+ Add column` at the bottom.
- **Indexes** section — list + `+ Add index` (pick columns, unique toggle).
- **Foreign keys** section — list (cols → ref table.cols, on delete/update) + `+ Add FK`.
- **Purpose / comment** field — free text, surfaced on the node and in docs later.

### When a COLUMN is selected

Focused single-column editor with the same fields plus validation hints ("type must match referenced PK").

### When NOTHING is selected (schema level)

- Schema name, **default target dialect**, table/column counts, validation summary, and quick actions (Import, Export, Auto-layout).

Every edit mutates the Schema IR → instantly recomputes smells, domains, and the SQL preview. No "apply" button — it's live, with undo.

---

## 7. Import dialog

Triggered by **Import**. A focused modal:

- **Source picker:** paste into a Monaco SQL editor **or** "Open `.sql` file…".
- **Source dialect** selector (SQLite / MySQL / PostgreSQL) — parsing is dialect-aware.
- **Parse** button → preview of detected tables/columns + a **warnings list** ("3 statements not imported: triggers, procedures").
- **Import** (confirm) merges into the current schema or replaces it (choice).
- Clear empty/error states; never silently drops unparsed SQL.

---

## 8. Export SQL dialog — the headline MVP feature

Triggered by **Export ▾**. The thing that proves "SQL for any database."

```text
┌──────────────────────── Export SQL ────────────────────────────┐
│  Target:  [ SQLite ] [ MySQL ] [● PostgreSQL ]                  │  ← dialect tabs
│  Options: ☑ IF NOT EXISTS  ☐ DROP statements  ☑ Quote idents    │
│           ◉ Single file   ○ One file per table                  │
├─────────────────────────────────────────────────────────────────┤
│  -- generated by SchemaGuard                                    │
│  CREATE TABLE "users" ( ... );                  [Monaco preview] │
│  CREATE TABLE "subscriptions" ( ... );                          │
│  ALTER TABLE "subscriptions" ADD CONSTRAINT ...                 │
├─────────────────────────────────────────────────────────────────┤
│  ⚠ 1 feature note: enum 'status' → CHECK constraint (SQLite)    │  ← warnings
│                                   [ Copy ]   [ Save .sql ]      │
└─────────────────────────────────────────────────────────────────┘
```

- **Dialect tabs** — switching instantly re-renders the preview for that database.
- **Options:** `IF NOT EXISTS`, `DROP TABLE` header, identifier quoting, single-file vs per-table.
- **Live Monaco preview** with SQL syntax highlighting, read-only.
- **Feature-gap warnings** panel — every degraded concept is named (enum→CHECK, uuid→TEXT, etc.). This honesty is the differentiator.
- **Copy** (to clipboard) and **Save .sql** (native save dialog via Rust).

---

## 9. Bottom dock

Collapsible (⌘3), tabbed:

- **Design & Issues** — list of design smells + validation errors. Each row: severity dot, message, location, and a **Fix** button where a one-click fix exists ("add index('user_id')"). Clicking a row selects it on the canvas.
- **SQL Preview** — live DDL for the current target dialect (mirrors Export, read-only) with a dialect dropdown. Lets users see generated SQL without opening the modal.

Left edge shows the **issues count**; right edge shows the **save status** (`✓ Saved` / `Saving…`).

---

## 10. Command palette (⌘K) & shortcuts

The enterprise hallmark. ⌘K opens a fuzzy launcher over everything:

- **Navigate:** jump to any table/column/enum.
- **Act:** New table, Import, Export to {dialect}, Auto-layout, Toggle design check, Switch altitude, Start tour.

Core shortcuts (shown in tooltips, documented in a Shortcuts modal):

| Action                             | Shortcut     |
| ---------------------------------- | ------------ |
| Command palette                    | ⌘K           |
| New table                          | ⌘N           |
| Import SQL                         | ⌘O           |
| Export SQL                         | ⌘E           |
| Save                               | ⌘S           |
| Undo / Redo                        | ⌘Z / ⌘⇧Z     |
| Toggle Explorer / Inspector / Dock | ⌘1 / ⌘2 / ⌘3 |
| Fit to screen                      | ⇧1           |
| Design check toggle                | ⇧D           |
| Delete selection                   | ⌫            |

---

## 11. States & feedback (don't skip these — they are the polish)

- **First run / empty:** guided empty states in Explorer, Canvas, Inspector.
- **Loading:** skeleton rows while parsing a large dump; progress for big files.
- **Validation:** live badge; export is blocked with a clear modal if the schema is invalid (FK to missing table, type mismatch).
- **Errors:** parse failures show a non-blocking toast + the warnings list — never a crash, never a silent drop.
- **Autosave:** local autosave with a visible status; ⌘S forces a named save.
- **Undo/redo:** every IR mutation is undoable (canvas edits, inspector edits, imports).
- **Destructive actions:** delete table/column asks for confirm if it has dependents (FKs pointing at it).

---

## 12. Visual & component checklist (build acceptance)

- [ ] Spacing on a 4/8px grid; panel padding 12–16px.
- [ ] Radius: 12px cards/nodes, 8–10px controls, 20px pills.
- [ ] One icon set (Lucide), 1.5px stroke, 16/18px.
- [ ] System font UI; mono for all types/identifiers/SQL; tabular numerals in grids.
- [ ] Single accent gradient used only for the primary/Export action.
- [ ] Risk/semantic colors used only for smells & severity.
- [ ] Visible focus rings; full keyboard nav; AA contrast.
- [ ] 120–180ms transitions on panels, selection, focus; respect `prefers-reduced-motion`.
- [ ] Resizable/collapsible panels with persisted sizes.
- [ ] Every primary action reachable via ⌘K and a shortcut.
- [ ] Empty, loading, and error states designed for every panel.

---

## 13. MVP screens checklist

1. **Main workspace** (this spec) — Explorer · Canvas · Inspector · Dock.
2. **Import dialog** (§7).
3. **Export SQL dialog** (§8).
4. **Command palette** (§10).
5. **Shortcuts modal** + **Settings** (default dialect, theme, autosave) + **Recent/empty home**.

These five cover the entire deterministic MVP. AI panels, review/risk screens, and collaboration are explicitly later phases.
