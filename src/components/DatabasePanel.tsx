import type { Schema } from "@schemaguard/core";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  Equal,
  Filter,
  GitBranch,
  GitCompare,
  Hash,
  Play,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { autoLayout } from "../lib/autoLayout";
import type { ColumnValue } from "../lib/browseQuery";
import {
  buildBrowseQuery,
  buildDeleteQuery,
  buildFilterQuery,
  buildInsertQuery,
  buildUpdateQuery,
  quoteIdent,
  whereSnippet,
} from "../lib/browseQuery";
import type { ConnInfo, DbDialect, QueryResult } from "../lib/db";
import {
  dbConnect,
  dbCreateDatabase,
  dbDatabases,
  dbDisconnect,
  dbDropTables,
  dbExecute,
  dbQuery,
  dbTableData,
  dbTables,
  isDesktop,
} from "../lib/db";
import { rowToJson, toCsv, toJson, toSqlInserts } from "../lib/exportData";
import { fetchPrimaryKey, introspectSchema } from "../lib/introspect";
import { downloadText } from "../lib/projectFile";
import type { DestructiveFinding } from "../lib/sqlGuard";
import { scanDestructive } from "../lib/sqlGuard";
import { useConnections } from "../stores/connections";
import { useSchemaStore } from "../stores/schema";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import { ConfirmDialog } from "./ConfirmDialog";
import type { MenuItem } from "./ContextMenu";
import { ContextMenu } from "./ContextMenu";
import { CellDetail } from "./database/CellDetail";
import { GRADIENT } from "./database/constants";
import { CreateDatabaseDialog } from "./database/CreateDatabaseDialog";
import { DropTablesDialog } from "./database/DropTablesDialog";
import { ImportSqlDialog } from "./database/ImportSqlDialog";
import { InsertRow } from "./database/InsertRow";
import { Field, Tab } from "./database/parts";
import { ResultGrid } from "./database/ResultGrid";
import { StructureView } from "./database/StructureView";
import { DiffDialog } from "./DiffDialog";
import { SchemaDiagram } from "./SchemaDiagram";

const PAGE = 100;

// DDL that changes the set/shape of tables — used to auto-refresh the sidebar
// after such a statement runs in the Query tab (e.g. importing a dump).
const DDL_RE = /\b(?:create|drop|alter|rename)\s+(?:temporary\s+|temp\s+)?(?:table|view)\b/i;

interface Form {
  name: string;
  dialect: DbDialect;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const EMPTY_FORM: Form = {
  name: "Local Postgres",
  dialect: "postgres",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
};

export function DatabasePanel({ onImported }: { onImported: () => void }) {
  const desktop = isDesktop();
  const saved = useConnections((s) => s.saved);
  const saveConn = useConnections((s) => s.save);
  const removeConn = useConnections((s) => s.remove);
  const loadProject = useSchemaStore((s) => s.loadProject);
  const pendingDbQuery = useUi((s) => s.pendingDbQuery);
  const consumeDbQuery = useUi((s) => s.consumeDbQuery);

  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [remember, setRemember] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);

  const [connId, setConnId] = useState<string | null>(null);
  const [connName, setConnName] = useState("");
  const [connDialect, setConnDialect] = useState<DbDialect>("postgres");
  // The coordinates of the live connection (incl. password) so we can reconnect
  // to a different database without re-prompting — powers the DB switcher.
  const [activeInfo, setActiveInfo] = useState<ConnInfo | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  // "New database" dialog + in-flight flag (create on the connected server).
  const [createDbOpen, setCreateDbOpen] = useState(false);
  const [creatingDb, setCreatingDb] = useState(false);
  const [importing, setImporting] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  // Tables checked for a bulk drop, plus the confirm-dialog + in-flight flags.
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [dropOpen, setDropOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [importSqlOpen, setImportSqlOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"data" | "structure" | "query" | "diagram">("data");
  const [offset, setOffset] = useState(0);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [inserting, setInserting] = useState(false);
  // Recent successfully-run queries from the Query tab (newest first).
  const [history, setHistory] = useState<string[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  // The cell whose full value is shown in the detail viewer (Beekeeper-style).
  const [detail, setDetail] = useState<{ column: string; value: string | null } | null>(null);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  // phpMyAdmin-style find/sort: filter the table list, and search + sort rows.
  const [tableFilter, setTableFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);
  const [pkColumns, setPkColumns] = useState<string[]>([]);
  // Right-click menu (build SQL searches from a table or a record).
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // Inline read-only ER diagram of the live database (lazily introspected).
  const [diagramSchema, setDiagramSchema] = useState<Schema | null>(null);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [diagramError, setDiagramError] = useState<string | null>(null);

  // "Guard" loop: diff the canvas design against the live database.
  const designSchema = useSchemaStore((s) => s.schema);
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparing, setComparing] = useState(false);
  // Pre-flight guard: destructive/locking SQL is intercepted before it runs.
  const [guard, setGuard] = useState<{ sql: string; findings: DestructiveFinding[] } | null>(null);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("SELECT 1;");

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  type SortState = { col: string; dir: "asc" | "desc" } | null;

  const loadData = (
    id: string,
    table: string,
    off: number,
    searchVal: string,
    sortVal: SortState,
  ) => {
    setLoading(true);
    setResultError(null);
    // Plain paging uses the safe native command; search/sort needs a built
    // query, which needs the table's columns (known from the current result).
    const cols = result?.columns ?? [];
    const filtered = searchVal.trim().length > 0 && cols.length > 0;
    const req =
      filtered || sortVal !== null
        ? dbQuery(
            id,
            buildBrowseQuery({
              dialect: connDialect,
              table,
              columns: cols,
              limit: PAGE,
              offset: off,
              ...(filtered ? { search: searchVal } : {}),
              ...(sortVal ? { sortColumn: sortVal.col, sortDir: sortVal.dir } : {}),
            }),
          )
        : dbTableData(id, table, PAGE, off);
    req
      .then((r) => {
        setResult(r);
      })
      .catch((e: unknown) => {
        setResultError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Open a connection and load its tables + database list. Shared by the
  // initial connect and the database switcher. Resolves with the new conn id.
  const openConnection = (info: ConnInfo, name: string, save: boolean): Promise<string> =>
    dbConnect(info).then((id) => {
      setConnId(id);
      setConnName(name);
      setConnDialect(info.dialect);
      setActiveInfo(info);
      if (save) {
        saveConn({
          name,
          dialect: info.dialect,
          host: info.host,
          port: info.port,
          user: info.user,
          database: info.database,
          // Persist the password only when the user opted in; otherwise omit it
          // so any previously remembered password for this name is dropped.
          ...(remember ? { password: info.password } : {}),
        });
      }
      // Best-effort: a failed list just hides the switcher, never blocks connect.
      void dbDatabases(id)
        .then(setDatabases)
        .catch(() => {
          setDatabases([]);
        });
      return dbTables(id).then((ts) => {
        setTables(ts);
        setSelectedTables(new Set());
        setView("data");
        setOffset(0);
        setSearch("");
        setSort(null);
        const first = ts[0];
        if (first) {
          setSelected(first);
          loadData(id, first, 0, "", null);
          loadPk(id, info.dialect, first);
          loadCount(id, first);
        } else {
          setSelected(null);
          setResult(null);
        }
        return id;
      });
    });

  const connect = (info: ConnInfo, name: string) => {
    setConnecting(true);
    setConnError(null);
    openConnection(info, name, true)
      .catch((e: unknown) => {
        setConnError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setConnecting(false);
      });
  };

  // phpMyAdmin-style database switch: reconnect to the same server on a
  // different database, then drop the previous connection on success.
  const switchDatabase = (database: string) => {
    if (!activeInfo || connecting || database === activeInfo.database) return;
    const previous = connId;
    setConnecting(true);
    setConnError(null);
    openConnection({ ...activeInfo, database }, connName, false)
      .then(() => {
        if (previous) void dbDisconnect(previous).catch(() => undefined);
        toast.success(`Switched to “${database}”.`);
      })
      .catch((e: unknown) => {
        toast.error(
          `Couldn't switch to “${database}”: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        setConnecting(false);
      });
  };

  // Create a new database on the connected server, then switch into it so it's
  // ready to use. switchDatabase reconnects and refreshes the database list.
  const createDatabase = (name: string) => {
    const trimmed = name.trim();
    if (!connId || !activeInfo || !trimmed || creatingDb) return;
    setCreatingDb(true);
    dbCreateDatabase(connId, trimmed)
      .then(() => {
        toast.success(`Created database “${trimmed}”.`);
        setCreateDbOpen(false);
        switchDatabase(trimmed);
      })
      .catch((e: unknown) => {
        toast.error(
          `Couldn't create “${trimmed}”: ${e instanceof Error ? e.message : String(e)}`,
        );
      })
      .finally(() => {
        setCreatingDb(false);
      });
  };

  const disconnect = () => {
    if (connId) void dbDisconnect(connId).catch(() => undefined);
    setConnId(null);
    setActiveInfo(null);
    setDatabases([]);
    setTables([]);
    setSelectedTables(new Set());
    setDropOpen(false);
    setSelected(null);
    setResult(null);
    setResultError(null);
    setDiagramSchema(null);
    setDiagramError(null);
    setPkColumns([]);
    setRowCount(null);
    setInserting(false);
  };

  const toggleTableSelect = (t: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // Drop every checked table in one operation, optionally ignoring FK checks,
  // then refresh the table list and reset anything that pointed at them.
  const dropSelected = (disableFk: boolean) => {
    if (!connId || selectedTables.size === 0) return;
    const targets = [...selectedTables];
    const id = connId;
    setDropping(true);
    dbDropTables(id, targets, disableFk)
      .then((n) => {
        toast.success(`Dropped ${String(n)} table${n === 1 ? "" : "s"}.`);
        setDropOpen(false);
        setSelectedTables(new Set());
        // The cached introspection is now stale (Structure / Diagram tabs).
        setDiagramSchema(null);
        return dbTables(id).then((ts) => {
          setTables(ts);
          if (selected && targets.includes(selected)) {
            const first = ts[0] ?? null;
            setSelected(first);
            if (first) {
              setOffset(0);
              setSearch("");
              setSort(null);
              loadData(id, first, 0, "", null);
              loadPk(id, connDialect, first);
              loadCount(id, first);
            } else {
              setResult(null);
            }
          }
        });
      })
      .catch((e: unknown) => {
        toast.error(`Drop failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setDropping(false);
      });
  };

  // Look up the table's primary key so rows can be edited safely (best-effort).
  const loadPk = (id: string, dialect: DbDialect, table: string) => {
    setPkColumns([]);
    void fetchPrimaryKey(id, dialect, table)
      .then(setPkColumns)
      .catch(() => {
        setPkColumns([]);
      });
  };

  // Best-effort total row count for the open table (phpMyAdmin shows this).
  const loadCount = (id: string, table: string) => {
    setRowCount(null);
    void dbQuery(id, `SELECT COUNT(*) AS n FROM ${quoteIdent(connDialect, table)}`)
      .then((r) => {
        const n = Number(r.rows[0]?.[0] ?? "");
        setRowCount(Number.isFinite(n) ? n : null);
      })
      .catch(() => {
        setRowCount(null);
      });
  };

  const openTable = (t: string) => {
    if (!connId) return;
    setSelected(t);
    setInserting(false);
    // Clicking a table while on the Structure tab keeps you there for that table.
    if (view === "structure") {
      ensureIntrospected();
      return;
    }
    setView("data");
    setOffset(0);
    setSearch("");
    setSort(null);
    loadData(connId, t, 0, "", null);
    loadPk(connId, connDialect, t);
    loadCount(connId, t);
  };

  // Save an edited row: UPDATE the changed cells, keyed by primary key.
  const saveRow = async (
    original: (string | null)[],
    next: (string | null)[],
  ): Promise<boolean> => {
    if (!connId || !selected || !result) return false;
    if (pkColumns.length === 0) {
      toast.error(`"${selected}" has no primary key — rows can't be edited safely.`);
      return false;
    }
    const cols = result.columns;
    const set: ColumnValue[] = [];
    cols.forEach((c, j) => {
      if (original[j] !== next[j]) set.push({ column: c, value: next[j] ?? null });
    });
    if (set.length === 0) {
      toast.info("No changes to save.");
      return true;
    }
    const where: ColumnValue[] = [];
    for (const pc of pkColumns) {
      const idx = cols.indexOf(pc);
      if (idx === -1) {
        toast.error(`Primary key column "${pc}" isn't in the result — can't target the row.`);
        return false;
      }
      where.push({ column: pc, value: original[idx] ?? null });
    }
    try {
      const sql = buildUpdateQuery({ dialect: connDialect, table: selected, set, where });
      const affected = await dbExecute(connId, sql);
      if (affected === 0) {
        toast.error(
          "No rows updated — the row may have changed or been removed. Refresh and retry.",
        );
        return false;
      }
      toast.success(`Saved · ${String(affected)} row${affected === 1 ? "" : "s"} updated.`);
      loadData(connId, selected, offset, search, sort);
      return true;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  // Insert a new row. Columns left blank are omitted so DB defaults / auto-
  // increment apply. Returns true on success so the form can close.
  const insertRow = async (draft: (string | null)[]): Promise<boolean> => {
    if (!connId || !selected || !result) return false;
    const values: ColumnValue[] = [];
    result.columns.forEach((c, j) => {
      const v = draft[j];
      // undefined/"" → omit (use default); explicit null → NULL.
      if (v !== undefined && v !== "") values.push({ column: c, value: v });
    });
    if (values.length === 0) {
      toast.error("Enter at least one value to insert.");
      return false;
    }
    try {
      const sql = buildInsertQuery({ dialect: connDialect, table: selected, values });
      await dbExecute(connId, sql);
      toast.success("Row inserted.");
      setInserting(false);
      loadData(connId, selected, offset, search, sort);
      loadCount(connId, selected);
      return true;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  // Delete one row, keyed by primary key.
  const deleteRow = async (row: (string | null)[]): Promise<boolean> => {
    if (!connId || !selected || !result) return false;
    if (pkColumns.length === 0) {
      toast.error(`"${selected}" has no primary key — rows can't be deleted safely.`);
      return false;
    }
    const cols = result.columns;
    const where: ColumnValue[] = [];
    for (const pc of pkColumns) {
      const idx = cols.indexOf(pc);
      if (idx === -1) {
        toast.error(`Primary key column "${pc}" isn't in the result — can't target the row.`);
        return false;
      }
      where.push({ column: pc, value: row[idx] ?? null });
    }
    try {
      const sql = buildDeleteQuery({ dialect: connDialect, table: selected, where });
      const affected = await dbExecute(connId, sql);
      if (affected === 0) {
        toast.error("No rows deleted — it may have already been removed.");
        return false;
      }
      toast.success("Row deleted.");
      loadData(connId, selected, offset, search, sort);
      loadCount(connId, selected);
      return true;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  // Export the current result grid to a downloaded CSV, JSON or SQL file.
  const exportResult = (format: "csv" | "json" | "sql") => {
    setExportOpen(false);
    if (!result || result.columns.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const base = selected ?? "query";
    if (format === "csv") {
      downloadText(`${base}.csv`, toCsv(result.columns, result.rows), "text/csv");
    } else if (format === "json") {
      downloadText(`${base}.json`, toJson(result.columns, result.rows), "application/json");
    } else {
      downloadText(
        `${base}.sql`,
        toSqlInserts(connDialect, base, result.columns, result.rows),
        "text/plain",
      );
    }
    toast.success(`Exported ${String(result.rows.length)} row(s) as ${format.toUpperCase()}.`);
  };

  const page = (delta: number) => {
    if (!connId || !selected) return;
    const next = Math.max(0, offset + delta * PAGE);
    setOffset(next);
    loadData(connId, selected, next, search, sort);
  };

  const applySearch = (term: string) => {
    if (!connId || !selected) return;
    setSearch(term);
    setOffset(0);
    loadData(connId, selected, 0, term, sort);
  };

  // Click a column header: asc → desc → unsorted.
  const toggleSort = (col: string) => {
    if (!connId || !selected) return;
    const next: SortState =
      sort?.col === col ? (sort.dir === "asc" ? { col, dir: "desc" } : null) : { col, dir: "asc" };
    setSort(next);
    setOffset(0);
    loadData(connId, selected, 0, search, next);
  };

  // Introspect the live database once and cache it; both the Structure and
  // Diagram tabs read from this. No-op if already loaded or loading.
  const ensureIntrospected = (force = false) => {
    if ((!force && diagramSchema) || diagramLoading || !connId) return;
    setDiagramLoading(true);
    setDiagramError(null);
    introspectSchema(connId, connDialect, connName)
      .then((s) => {
        setDiagramSchema(s);
      })
      .catch((e: unknown) => {
        setDiagramError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setDiagramLoading(false);
      });
  };

  const openDiagram = () => {
    setView("diagram");
    ensureIntrospected();
  };

  // Show the selected table's columns, keys, indexes and FKs (phpMyAdmin's
  // "Structure" tab) from the cached introspection.
  const openStructure = () => {
    setView("structure");
    ensureIntrospected();
  };

  const importToDiagram = () => {
    if (!connId) return;
    setImporting(true);
    introspectSchema(connId, connDialect, connName)
      .then((schema) => {
        if (schema.tables.length === 0) {
          toast.error("No tables found in this database to import.");
          return;
        }
        loadProject(schema, autoLayout(schema));
        toast.success(`Imported ${String(schema.tables.length)} tables into the designer.`);
        onImported();
      })
      .catch((e: unknown) => {
        toast.error(`Couldn't read the schema: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setImporting(false);
      });
  };

  // Introspect the live DB (reusing the cached schema if present) and open the
  // diff against the current canvas design.
  const compareWithDesign = () => {
    if (!connId || comparing) return;
    if (designSchema.tables.length === 0) {
      toast.info("Your design canvas is empty — build or import a schema in Designer first.");
      return;
    }
    if (diagramSchema) {
      setCompareOpen(true);
      return;
    }
    setComparing(true);
    introspectSchema(connId, connDialect, connName)
      .then((s) => {
        setDiagramSchema(s);
        setCompareOpen(true);
      })
      .catch((e: unknown) => {
        toast.error(`Couldn't read the schema: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setComparing(false);
      });
  };

  // Re-read the table list (and invalidate the cached Structure/Diagram schema)
  // so tables created/dropped after connecting show up. `silent` skips the toast
  // for the automatic refresh that follows DDL in the Query tab.
  const refreshTables = (silent = false) => {
    if (!connId) return;
    const id = connId;
    setRefreshing(true);
    dbTables(id)
      .then((ts) => {
        setTables(ts);
        // The cached introspection (Structure / Diagram) is now stale.
        if (view === "structure" || view === "diagram") ensureIntrospected(true);
        else setDiagramSchema(null);

        if (selected && !ts.includes(selected)) {
          // The open table is gone — fall back to the first remaining one.
          const first = ts[0] ?? null;
          setSelected(first);
          if (first) {
            setOffset(0);
            setSearch("");
            setSort(null);
            loadData(id, first, 0, "", null);
            loadPk(id, connDialect, first);
            loadCount(id, first);
          } else {
            setResult(null);
          }
        } else if (!silent && selected && view === "data") {
          // A manual refresh also re-pulls the current table's rows + count.
          loadData(id, selected, offset, search, sort);
          loadCount(id, selected);
        }

        if (!silent) {
          toast.success(`Refreshed · ${String(ts.length)} table${ts.length === 1 ? "" : "s"}.`);
        }
      })
      .catch((e: unknown) => {
        if (!silent) toast.error(`Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  const runQuery = (sql: string = query) => {
    if (!connId) return;
    setLoading(true);
    setResultError(null);
    const trimmed = sql.trim();
    if (trimmed.length > 0) {
      // Record in history (newest first, deduped, capped).
      setHistory((h) => [trimmed, ...h.filter((q) => q !== trimmed)].slice(0, 15));
    }
    dbQuery(connId, sql)
      .then((r) => {
        setResult(r);
        // If the statement created/dropped/altered tables, refresh the sidebar.
        if (DDL_RE.test(trimmed)) refreshTables(true);
      })
      .catch((e: unknown) => {
        setResultError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // The guard loop's pre-flight: scan the SQL before it touches the live
  // database. Destructive/locking statements open a confirm; everything else
  // (SELECTs, scoped writes, safe DDL) runs straight through with no friction.
  const requestRun = (sql: string) => {
    if (!connId) return;
    const findings = scanDestructive(sql);
    if (findings.length > 0) {
      setGuard({ sql, findings });
      return;
    }
    runQuery(sql);
  };

  // Run the highlighted text if the user has a selection, else the whole editor
  // (Beekeeper "Run selection"). Lets you keep several statements and run one.
  const runQueryOrSelection = () => {
    const el = queryRef.current;
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd).trim() : "";
    requestRun(sel.length > 0 ? sel : query);
  };

  // Drop a generated query into the Query tab and run it — the heart of the
  // right-click "search with SQL" flow.
  const openInQuery = (sql: string) => {
    setQuery(sql);
    setView("query");
    setSelected(null);
    requestRun(sql);
  };

  // A query the assistant handed off via "Run in Database". Once connected,
  // drop it into the Query tab and run it; otherwise prefill so it's ready the
  // moment the user connects. Consumed once so it doesn't re-run.
  useEffect(() => {
    if (!pendingDbQuery) return;
    if (connId) {
      openInQuery(pendingDbQuery);
    } else {
      setQuery(pendingDbQuery);
      setView("query");
    }
    consumeDbQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDbQuery, connId]);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      toast.success(`Copied ${label}.`);
    });
  };

  // Right-click a table in the sidebar → quick SQL scaffolds.
  const tableMenu = (t: string): MenuItem[] => {
    const id = quoteIdent(connDialect, t);
    return [
      { label: "Browse data", icon: <Table2 size={13} />, onClick: () => openTable(t) },
      {
        label: "SELECT * (LIMIT 100)",
        icon: <Play size={13} />,
        onClick: () => openInQuery(`SELECT * FROM ${id} LIMIT 100;`),
      },
      {
        label: "Count rows",
        icon: <Hash size={13} />,
        onClick: () => openInQuery(`SELECT COUNT(*) AS count FROM ${id};`),
      },
      "separator",
      {
        label: "Copy SELECT",
        icon: <Copy size={13} />,
        onClick: () => copy(`SELECT * FROM ${id};`, "query"),
      },
      { label: "Copy table name", icon: <Copy size={13} />, onClick: () => copy(t, "table name") },
    ];
  };

  // Right-click a record/cell → view it, build a WHERE filter, or copy.
  const cellMenu = (column: string, value: string | null, row: (string | null)[]): MenuItem[] => {
    if (!selected) return [];
    const display = value === null ? "NULL" : value.length > 24 ? `${value.slice(0, 24)}…` : value;
    return [
      {
        label: "View full value",
        icon: <Search size={13} />,
        onClick: () => {
          setDetail({ column, value });
        },
      },
      {
        label: `Find rows where ${column} = ${display}`,
        icon: <Filter size={13} />,
        onClick: () =>
          openInQuery(
            buildFilterQuery({
              dialect: connDialect,
              table: selected,
              column,
              op: "=",
              value,
              limit: 100,
            }),
          ),
      },
      {
        label: `Find rows where ${column} ≠ ${display}`,
        icon: <Equal size={13} />,
        onClick: () =>
          openInQuery(
            buildFilterQuery({
              dialect: connDialect,
              table: selected,
              column,
              op: "<>",
              value,
              limit: 100,
            }),
          ),
      },
      "separator",
      {
        label: "Copy value",
        icon: <Copy size={13} />,
        onClick: () => copy(value ?? "NULL", "value"),
      },
      {
        label: "Copy row as JSON",
        icon: <Copy size={13} />,
        onClick: () => copy(rowToJson(result?.columns ?? [], row), "row JSON"),
      },
      {
        label: "Copy WHERE clause",
        icon: <Copy size={13} />,
        onClick: () => copy(whereSnippet(connDialect, column, "=", value), "WHERE clause"),
      },
    ];
  };

  // Right-click a column in the Structure tab → quick scaffolds for that column.
  const columnMenu = (column: string): MenuItem[] => {
    if (!selected) return [];
    const tbl = quoteIdent(connDialect, selected);
    const col = quoteIdent(connDialect, column);
    return [
      { label: "Browse table", icon: <Table2 size={13} />, onClick: () => openTable(selected) },
      {
        label: `SELECT ${column} (LIMIT 100)`,
        icon: <Play size={13} />,
        onClick: () => openInQuery(`SELECT ${col} FROM ${tbl} LIMIT 100;`),
      },
      {
        label: `Sort by ${column}`,
        icon: <Filter size={13} />,
        onClick: () => openInQuery(`SELECT * FROM ${tbl} ORDER BY ${col} ASC LIMIT 100;`),
      },
      {
        label: "Count distinct values",
        icon: <Hash size={13} />,
        onClick: () =>
          openInQuery(
            `SELECT ${col}, COUNT(*) AS count FROM ${tbl} GROUP BY ${col} ORDER BY count DESC LIMIT 100;`,
          ),
      },
      "separator",
      {
        label: "Copy column name",
        icon: <Copy size={13} />,
        onClick: () => copy(column, "column name"),
      },
    ];
  };

  // ---- not connected: connection manager ----
  if (connId === null) {
    return (
      <div className="grid h-full place-items-center overflow-auto p-6">
        <div className="glass w-[460px] max-w-full animate-pop rounded-2xl border border-line/70 p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg text-white"
              style={{ background: GRADIENT }}
            >
              <Database size={15} />
            </span>
            <div className="text-balance text-[15px] font-bold">Connect to a database</div>
          </div>

          {!desktop && (
            <p className="mb-4 text-pretty rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
              Live connections run through the native backend. Launch the desktop app (
              <span className="font-mono">pnpm tauri:dev</span>) to connect — the browser preview
              can't open database sockets.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Name" full>
              <input
                className="inp"
                value={form.name}
                onChange={(e) => {
                  set("name", e.target.value);
                }}
              />
            </Field>
            <Field label="Engine">
              <select
                className="inp"
                value={form.dialect}
                onChange={(e) => {
                  const d = e.target.value as DbDialect;
                  set("dialect", d);
                  set("port", d === "mysql" ? 3306 : 5432);
                }}
              >
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </Field>
            <Field label="Port">
              <input
                type="number"
                className="inp"
                value={form.port}
                onChange={(e) => {
                  set("port", Number(e.target.value));
                }}
              />
            </Field>
            <Field label="Host" full>
              <input
                className="inp"
                value={form.host}
                onChange={(e) => {
                  set("host", e.target.value);
                }}
              />
            </Field>
            <Field label="User">
              <input
                className="inp"
                value={form.user}
                onChange={(e) => {
                  set("user", e.target.value);
                }}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                className="inp"
                value={form.password}
                onChange={(e) => {
                  set("password", e.target.value);
                }}
              />
            </Field>
            <Field label="Database" full>
              <input
                className="inp"
                value={form.database}
                onChange={(e) => {
                  set("database", e.target.value);
                }}
              />
            </Field>
          </div>

          <label className="mt-3 flex items-center gap-2 text-[12px] text-dim">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => {
                setRemember(e.target.checked);
              }}
            />
            Remember password
            <span className="text-faint">— stored locally in plain text</span>
          </label>

          {connError && (
            <p className="mt-3 rounded-lg border border-crit/40 bg-crit/10 px-3 py-2 text-[11.5px] text-crit">
              {connError}
            </p>
          )}

          <button
            type="button"
            disabled={!desktop || connecting || form.database.trim() === ""}
            onClick={() => {
              const { name, ...info } = form;
              connect({ ...info, database: info.database.trim(), host: info.host.trim() }, name);
            }}
            className="press mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[13px] font-semibold text-white shadow-glow disabled:opacity-40 disabled:shadow-none"
            style={{ background: GRADIENT }}
          >
            <Plug size={15} />
            {connecting ? "Connecting…" : "Connect"}
          </button>

          {saved.length > 0 && (
            <div className="mt-5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-faint">
                Saved connections
              </div>
              <div className="flex flex-col gap-1.5">
                {saved.map((c) => (
                  <div
                    key={c.id}
                    className="group flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 transition-colors hover:border-line2"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        setForm({ ...c, password: c.password ?? "" });
                        setRemember(Boolean(c.password));
                      }}
                    >
                      <div className="text-[12.5px] font-semibold">{c.name}</div>
                      <div className="font-mono text-[10.5px] text-faint">
                        {c.dialect}://{c.user}@{c.host}:{c.port}/{c.database}
                      </div>
                    </button>
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => {
                        removeConn(c.id);
                      }}
                      className="grid place-items-center text-faint opacity-0 hover:text-high group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <style>{`.inp{width:100%;border-radius:8px;border:1px solid rgb(var(--c-line));background:rgb(var(--c-panel2));padding:7px 9px;font-size:12.5px;outline:none}`}</style>
      </div>
    );
  }

  // ---- connected: client workspace ----
  const visibleTables = tables.filter((t) =>
    t.toLowerCase().includes(tableFilter.toLowerCase()),
  );
  const allVisibleSelected =
    visibleTables.length > 0 && visibleTables.every((t) => selectedTables.has(t));
  const toggleSelectAllVisible = () => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleTables.forEach((t) => next.delete(t));
      else visibleTables.forEach((t) => next.add(t));
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 flex-none items-center gap-2 border-b border-line bg-panel px-3">
        <PlugZap size={15} className="text-acc" />
        <span className="text-[12.5px] font-semibold">{connName}</span>
        {activeInfo && (
          <>
            <label
              className="ml-1 flex items-center gap-1 text-[11.5px] text-dim"
              title="Switch database"
            >
              <Database size={13} className="text-faint" />
              <select
                value={activeInfo.database}
                disabled={connecting}
                onChange={(e) => {
                  switchDatabase(e.target.value);
                }}
                className="max-w-[180px] rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] text-ink outline-none focus:border-acc disabled:opacity-50"
              >
                {(databases.includes(activeInfo.database)
                  ? databases
                  : [activeInfo.database, ...databases]
                ).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                setCreateDbOpen(true);
              }}
              disabled={connecting}
              title="Create a new database on this server"
              className="press inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] text-dim hover:border-acc/50 hover:text-acc disabled:opacity-50"
            >
              <Plus size={13} />
              New DB
            </button>
          </>
        )}
        <div className="ml-3 flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
          <Tab label="Data" active={view === "data"} onClick={() => setView("data")} />
          <Tab label="Structure" active={view === "structure"} onClick={openStructure} />
          <Tab label="Query" active={view === "query"} onClick={() => setView("query")} />
          <Tab label="Diagram" active={view === "diagram"} onClick={openDiagram} />
        </div>
        <button
          type="button"
          onClick={() => {
            setImportSqlOpen(true);
          }}
          title="Run a .sql file (schema + data) against this database"
          className="press ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-acc/50 hover:text-acc"
        >
          <Upload size={14} />
          Import SQL
        </button>
        <button
          type="button"
          onClick={compareWithDesign}
          disabled={comparing}
          title="Diff your canvas design against this live database"
          className="press inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-acc/50 hover:text-acc disabled:opacity-40"
        >
          <GitCompare size={14} />
          {comparing ? "Comparing…" : "Compare with design"}
        </button>
        <button
          type="button"
          onClick={importToDiagram}
          disabled={importing}
          title="Reverse-engineer this database into a diagram"
          className="press inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow disabled:opacity-40"
          style={{ background: GRADIENT }}
        >
          <GitBranch size={14} />
          {importing ? "Reading schema…" : "Import to diagram"}
        </button>
        <button
          type="button"
          onClick={disconnect}
          className="press rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-high/50 hover:text-high"
        >
          Disconnect
        </button>
      </div>

      {view === "diagram" ? (
        <div className="min-h-0 flex-1">
          {diagramLoading && (
            <div className="p-4 text-[12px] text-dim">Reading the database schema…</div>
          )}
          {!diagramLoading && diagramError && (
            <div className="m-3 rounded-lg border border-crit/40 bg-crit/10 p-3 font-mono text-[11.5px] text-crit">
              {diagramError}
            </div>
          )}
          {!diagramLoading && !diagramError && diagramSchema && diagramSchema.tables.length > 0 && (
            <SchemaDiagram schema={diagramSchema} name={connName} />
          )}
          {!diagramLoading &&
            !diagramError &&
            diagramSchema &&
            diagramSchema.tables.length === 0 && (
              <div className="p-4 text-[12px] text-dim">No tables to diagram in this database.</div>
            )}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <aside className="min-h-0 overflow-auto border-r border-line bg-panel p-2">
            <div className="flex items-center px-2 py-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-faint">
                Tables · {tables.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  refreshTables();
                }}
                disabled={refreshing}
                title="Refresh table list"
                className="relative ml-auto grid h-5 w-5 place-items-center rounded text-faint after:absolute after:left-1/2 after:top-1/2 after:size-9 after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-panel2 hover:text-ink disabled:opacity-50"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              </button>
            </div>
            {tables.length > 0 && (
              <div className="relative px-1 pb-1.5">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  value={tableFilter}
                  onChange={(e) => {
                    setTableFilter(e.target.value);
                  }}
                  placeholder="Filter tables…"
                  className="w-full rounded-md border border-line bg-panel2 py-1 pl-7 pr-2 text-[12px] outline-none focus:border-acc"
                />
              </div>
            )}
            {tables.length > 0 && (
              <div className="mb-1 flex items-center gap-2 px-2 py-0.5">
                <label className="flex items-center gap-1.5 text-[11px] text-faint">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAllVisible}
                    className="h-3.5 w-3.5 accent-[#a64bff]"
                  />
                  {selectedTables.size > 0 ? `${String(selectedTables.size)} selected` : "Select all"}
                </label>
                {selectedTables.size > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setDropOpen(true);
                    }}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-crit/40 bg-crit/10 px-2 py-0.5 text-[11px] font-semibold text-crit hover:bg-crit/20"
                  >
                    <Trash2 size={12} />
                    Drop
                  </button>
                )}
              </div>
            )}
            {tables.length === 0 && (
              <p className="text-pretty px-2 py-2 text-[11px] leading-snug text-med">
                No tables in the selected database. The{" "}
                <span className="font-semibold">Database</span> field is probably empty or wrong —
                disconnect and set it (e.g. your schema name). Run{" "}
                <span className="font-mono">SELECT DATABASE();</span> in the Query tab to see what
                you're connected to.
              </p>
            )}
            {visibleTables.map((t) => {
              const active = selected === t && (view === "data" || view === "structure");
              const checked = selectedTables.has(t);
              return (
                <div
                  key={t}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors ${
                    active ? "bg-acc/15" : checked ? "bg-panel2" : "hover:bg-panel2"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      toggleTableSelect(t);
                    }}
                    title="Select for bulk drop"
                    className="h-3.5 w-3.5 flex-none accent-[#a64bff]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      openTable(t);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, items: tableMenu(t) });
                    }}
                    className={`flex min-w-0 flex-1 items-center gap-2 text-left text-[12.5px] ${
                      active ? "text-acc" : ""
                    }`}
                  >
                    <Table2 size={13} className="flex-none opacity-70" />
                    <span className="truncate">{t}</span>
                  </button>
                </div>
              );
            })}
            {tables.length > 0 && visibleTables.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-faint">No tables match “{tableFilter}”.</p>
            )}
          </aside>

          <section className="flex min-h-0 flex-col">
            {view === "query" && (
              <div className="flex flex-none flex-col gap-2 border-b border-line p-2">
                <div className="flex items-center gap-2">
                  <select
                    value=""
                    disabled={history.length === 0}
                    onChange={(e) => {
                      if (e.target.value) setQuery(e.target.value);
                    }}
                    title="Recent queries"
                    className="max-w-[260px] rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] outline-none disabled:opacity-40"
                  >
                    <option value="">{history.length > 0 ? "Recent queries…" : "No history yet"}</option>
                    {history.map((h, i) => (
                      <option key={i} value={h}>
                        {h.replace(/\s+/g, " ").slice(0, 70)}
                      </option>
                    ))}
                  </select>
                  <span className="ml-auto text-[11px] text-faint">Export result:</span>
                  {(["csv", "json", "sql"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => {
                        exportResult(fmt);
                      }}
                      disabled={!result || result.rows.length === 0}
                      className="press rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] uppercase hover:border-line2 disabled:opacity-40"
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={queryRef}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        runQueryOrSelection();
                      }
                    }}
                    spellCheck={false}
                    placeholder="SELECT * FROM users;   (⌘/Ctrl+Enter runs the selection, or all)"
                    className="h-16 flex-1 resize-none rounded-lg border border-line bg-panel2 p-2 font-mono text-[12px] outline-none focus:border-acc"
                  />
                  <button
                    type="button"
                    onClick={runQueryOrSelection}
                    className="press inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white shadow-glow"
                    style={{ background: GRADIENT }}
                  >
                    <Play size={14} />
                    Run
                  </button>
                </div>
              </div>
            )}

            {view === "data" && selected && (
              <div className="flex h-10 flex-none items-center gap-2 border-b border-line px-3 text-[11.5px] text-dim">
                <span className="font-semibold text-ink">{selected}</span>
                <div className="relative ml-2 max-w-[280px] flex-1">
                  <Search
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-faint"
                  />
                  <input
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applySearch(search);
                      else if (e.key === "Escape") applySearch("");
                    }}
                    placeholder="Search this table… (Enter)"
                    className="w-full rounded-md border border-line bg-panel2 py-1 pl-7 pr-6 text-[12px] text-ink outline-none focus:border-acc"
                  />
                  {search.length > 0 && (
                    <button
                      type="button"
                      title="Clear search"
                      onClick={() => {
                        applySearch("");
                      }}
                      className="absolute right-1.5 top-1/2 grid -translate-y-1/2 place-items-center text-faint hover:text-ink"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setInserting((v) => !v);
                  }}
                  className={`press ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] ${
                    inserting
                      ? "border-acc/40 bg-acc/15 text-acc"
                      : "border-line bg-panel2 hover:border-line2"
                  }`}
                >
                  <Plus size={13} />
                  Insert row
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setExportOpen((v) => !v);
                    }}
                    disabled={!result || result.rows.length === 0}
                    className="press inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] hover:border-line2 disabled:opacity-40"
                  >
                    <Download size={13} />
                    Export
                  </button>
                  {exportOpen && (
                    <div className="absolute right-0 top-8 z-20 w-32 overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl">
                      <button
                        type="button"
                        onClick={() => {
                          exportResult("csv");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-panel3"
                      >
                        CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          exportResult("json");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-panel3"
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          exportResult("sql");
                        }}
                        className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-panel3"
                      >
                        SQL inserts
                      </button>
                    </div>
                  )}
                </div>
                <span className="tabular-nums">
                  rows {offset + 1}–{offset + (result?.rows.length ?? 0)}
                  {rowCount !== null && <span className="text-faint"> of {rowCount}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    page(-1);
                  }}
                  disabled={offset === 0}
                  className="grid h-6 w-6 place-items-center rounded border border-line disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    page(1);
                  }}
                  disabled={(result?.rows.length ?? 0) < PAGE}
                  className="grid h-6 w-6 place-items-center rounded border border-line disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {view === "structure" ? (
                <StructureView
                  loading={diagramLoading}
                  error={diagramError}
                  selected={selected}
                  table={
                    selected ? diagramSchema?.tables.find((t) => t.name === selected) : undefined
                  }
                  onColumnMenu={(e, column) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, items: columnMenu(column) });
                  }}
                />
              ) : (
                <>
                  {loading && <div className="p-4 text-[12px] text-dim">Loading…</div>}
                  {!loading && resultError && (
                    <div className="m-3 rounded-lg border border-crit/40 bg-crit/10 p-3 font-mono text-[11.5px] text-crit">
                      {resultError}
                    </div>
                  )}
                  {!loading && !resultError && view === "data" && inserting && selected && result && (
                    <InsertRow
                      columns={result.columns}
                      onCancel={() => {
                        setInserting(false);
                      }}
                      onInsert={insertRow}
                    />
                  )}
                  {!loading &&
                    !resultError &&
                    result &&
                    (view === "data" ? (
                      <ResultGrid
                        result={result}
                        sort={sort}
                        onSort={toggleSort}
                        pkColumns={pkColumns}
                        onSaveRow={saveRow}
                        onDeleteRow={deleteRow}
                        onCellMenu={(e, column, value, row) => {
                          e.preventDefault();
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items: cellMenu(column, value, row),
                          });
                        }}
                        onCellClick={(column, value) => {
                          setDetail({ column, value });
                        }}
                      />
                    ) : (
                      <ResultGrid result={result} />
                    ))}
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}

      {detail && (
        <CellDetail
          column={detail.column}
          value={detail.value}
          onClose={() => {
            setDetail(null);
          }}
        />
      )}

      {dropOpen && (
        <DropTablesDialog
          tables={[...selectedTables]}
          designTables={designSchema.tables.map((t) => t.name)}
          dialect={connDialect}
          dropping={dropping}
          onCancel={() => {
            if (!dropping) setDropOpen(false);
          }}
          onDrop={dropSelected}
        />
      )}

      {importSqlOpen && activeInfo && connId && (
        <ImportSqlDialog
          connId={connId}
          database={activeInfo.database}
          dialect={connDialect}
          tableCount={tables.length}
          onClose={() => {
            setImportSqlOpen(false);
          }}
          onDone={() => {
            refreshTables(true);
          }}
        />
      )}

      {createDbOpen && activeInfo && (
        <CreateDatabaseDialog
          dialect={connDialect}
          creating={creatingDb}
          existing={databases}
          onCancel={() => {
            if (!creatingDb) setCreateDbOpen(false);
          }}
          onCreate={createDatabase}
        />
      )}

      {compareOpen && diagramSchema && (
        <DiffDialog
          before={diagramSchema}
          after={designSchema}
          liveName={connName}
          onClose={() => {
            setCompareOpen(false);
          }}
        />
      )}

      {guard && (
        <ConfirmDialog
          title="Destructive SQL — run against the live database?"
          tone="danger"
          confirmLabel="Run anyway"
          cancelLabel="Cancel"
          message={
            <div className="flex flex-col gap-2">
              <p className="text-pretty">
                This {guard.findings.length === 1 ? "statement" : "script"} contains operations
                that can lose data or lock the table. They run against{" "}
                <span className="font-semibold text-ink">{connName}</span> and can&apos;t be undone.
              </p>
              <ul className="flex flex-col gap-1.5">
                {guard.findings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
                        f.severity === "destructive" ? "bg-crit" : "bg-high"
                      }`}
                    />
                    <span>
                      <span className="block text-ink">{f.reason}</span>
                      <span className="block font-mono text-[11px] text-faint">{f.statement}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          }
          onConfirm={() => {
            const sql = guard.sql;
            setGuard(null);
            runQuery(sql);
          }}
          onCancel={() => {
            setGuard(null);
          }}
        />
      )}
    </div>
  );
}
