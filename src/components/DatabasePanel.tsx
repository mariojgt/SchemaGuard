import type { CanonicalType, Schema, Table } from "@schemaguard/core";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  Equal,
  FileText,
  Filter,
  GitBranch,
  GitCompare,
  Hash,
  KeyRound,
  ListTree,
  Loader2,
  Pencil,
  Play,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  ShieldOff,
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
  dbImportBegin,
  dbImportExec,
  dbImportFinish,
  dbQuery,
  dbTableData,
  dbTables,
  isDesktop,
} from "../lib/db";
import { prettyMaybeJson, rowToJson, toCsv, toJson, toSqlInserts } from "../lib/exportData";
import { fetchPrimaryKey, introspectSchema } from "../lib/introspect";
import { downloadText } from "../lib/projectFile";
import { extractStatements, flushStatements } from "../lib/sqlSplit";
import { useConnections } from "../stores/connections";
import { useSchemaStore } from "../stores/schema";
import { toast } from "../stores/toasts";
import { useUi } from "../stores/ui";
import type { MenuItem } from "./ContextMenu";
import { ContextMenu } from "./ContextMenu";
import { DiffDialog } from "./DiffDialog";
import { SchemaDiagram } from "./SchemaDiagram";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";
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

  // Run the highlighted text if the user has a selection, else the whole editor
  // (Beekeeper "Run selection"). Lets you keep several statements and run one.
  const runQueryOrSelection = () => {
    const el = queryRef.current;
    const sel = el ? el.value.slice(el.selectionStart, el.selectionEnd).trim() : "";
    runQuery(sel.length > 0 ? sel : query);
  };

  // Drop a generated query into the Query tab and run it — the heart of the
  // right-click "search with SQL" flow.
  const openInQuery = (sql: string) => {
    setQuery(sql);
    setView("query");
    setSelected(null);
    runQuery(sql);
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
            <div className="text-[15px] font-bold">Connect to a database</div>
          </div>

          {!desktop && (
            <p className="mb-4 rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
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
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-[13px] font-semibold text-white shadow-glow disabled:opacity-40 disabled:shadow-none"
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
                    className="group flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-2 hover:border-line2"
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
              className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] text-dim hover:border-acc/50 hover:text-acc disabled:opacity-50"
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
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-acc/50 hover:text-acc"
        >
          <Upload size={14} />
          Import SQL
        </button>
        <button
          type="button"
          onClick={compareWithDesign}
          disabled={comparing}
          title="Diff your canvas design against this live database"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-acc/50 hover:text-acc disabled:opacity-40"
        >
          <GitCompare size={14} />
          {comparing ? "Comparing…" : "Compare with design"}
        </button>
        <button
          type="button"
          onClick={importToDiagram}
          disabled={importing}
          title="Reverse-engineer this database into a diagram"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow disabled:opacity-40"
          style={{ background: GRADIENT }}
        >
          <GitBranch size={14} />
          {importing ? "Reading schema…" : "Import to diagram"}
        </button>
        <button
          type="button"
          onClick={disconnect}
          className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-high/50 hover:text-high"
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
                className="ml-auto grid h-5 w-5 place-items-center rounded text-faint hover:bg-panel2 hover:text-ink disabled:opacity-50"
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
              <p className="px-2 py-2 text-[11px] leading-snug text-med">
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
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 ${
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
                      className="rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] uppercase hover:border-line2 disabled:opacity-40"
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
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white shadow-glow"
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
                  className={`ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] ${
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
                    className="inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] hover:border-line2 disabled:opacity-40"
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
                <span>
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
    </div>
  );
}

// Read this many bytes per slice. The whole file is never held in memory — we
// stream slices, split off complete statements, and send them in batches.
const IMPORT_CHUNK = 4 * 1024 * 1024;
const IMPORT_BATCH = 400;

// Per-dialect session statements to suspend / restore foreign-key enforcement
// for the duration of an import (mysqldump-style), so dumps restore regardless
// of statement order. Postgres uses session_replication_role (needs elevated
// rights — applied best-effort).
const FK_OFF: Record<DbDialect, string> = {
  mysql: "SET FOREIGN_KEY_CHECKS=0",
  postgres: "SET session_replication_role = replica",
};
const FK_ON: Record<DbDialect, string> = {
  mysql: "SET FOREIGN_KEY_CHECKS=1",
  postgres: "SET session_replication_role = origin",
};

/**
 * phpMyAdmin-style import: pick a .sql file and run it against the database.
 * The file is streamed in chunks so dumps of any size import without loading
 * the whole script into memory or sending it across the bridge at once.
 */
function ImportSqlDialog({
  connId,
  database,
  dialect,
  tableCount,
  onClose,
  onDone,
}: {
  connId: string;
  database: string;
  dialect: DbDialect;
  tableCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // Opt-in: wipe the database before importing so a full dump restores cleanly
  // (avoids "table already exists" / 1050 on re-import).
  const [emptyFirst, setEmptyFirst] = useState(false);
  const [emptying, setEmptying] = useState(false);
  // On by default: disable FK checks for the import session so a full dump
  // restores regardless of table/row order (avoids 1452). Re-enabled at the end.
  const [disableFk, setDisableFk] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setProgress(0);
    let importId: string | null = null;
    try {
      // Drop every existing table first when requested. FK checks are disabled
      // so tables referenced by others still drop; this runs before the import
      // session opens, and DDL auto-commits, so the import sees a clean schema.
      if (emptyFirst) {
        setEmptying(true);
        const existing = await dbTables(connId);
        if (existing.length > 0) await dbDropTables(connId, existing, true);
        setEmptying(false);
      }
      importId = await dbImportBegin(connId);
      // Turn off FK enforcement for this one import connection so a full dump
      // restores regardless of statement/row order. Best-effort: on Postgres
      // this needs elevated rights, so a failure just leaves checks on.
      if (disableFk) {
        await dbImportExec(importId, [FK_OFF[dialect]]).catch(() => undefined);
      }
      let offset = 0;
      let buffer = "";
      let totalRows = 0;
      let pending: string[] = [];
      const flush = async () => {
        if (pending.length === 0) return;
        totalRows += await dbImportExec(importId as string, pending);
        pending = [];
      };
      while (offset < file.size) {
        const text = await file.slice(offset, offset + IMPORT_CHUNK).text();
        offset += IMPORT_CHUNK;
        buffer += text;
        const { statements, rest } = extractStatements(buffer);
        buffer = rest;
        for (const s of statements) {
          pending.push(s);
          if (pending.length >= IMPORT_BATCH) await flush();
        }
        await flush();
        setProgress(Math.min(100, Math.round((offset / file.size) * 100)));
      }
      // Emit any final statement that lacked a trailing semicolon.
      for (const s of flushStatements(buffer)) pending.push(s);
      await flush();

      toast.success(`Imported “${file.name}” · ${String(totalRows)} row(s) affected.`);
      onDone();
      onClose();
    } catch (e: unknown) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (importId) {
        // Restore FK enforcement before the connection returns to the pool so
        // the disabled setting never leaks into later queries. (Re-enabling
        // doesn't re-validate the rows just imported, so it can't error.)
        if (disableFk) await dbImportExec(importId, [FK_ON[dialect]]).catch(() => undefined);
        await dbImportFinish(importId).catch(() => undefined);
      }
      setEmptying(false);
      setRunning(false);
    }
  };

  const sizeLabel = (n: number): string =>
    n < 1024
      ? `${String(n)} B`
      : n < 1024 * 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={() => {
        if (!running) onClose();
      }}
    >
      <div
        className="glass-strong flex w-[460px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span
            className="grid h-[18px] w-[18px] place-items-center rounded text-white"
            style={{ background: GRADIENT }}
          >
            <Upload size={11} />
          </span>
          <span className="text-[14px] font-bold">Import SQL</span>
          <span className="font-mono text-[11px] text-faint">→ {database}</span>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="ml-auto grid place-items-center text-faint hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <input
            ref={inputRef}
            type="file"
            accept=".sql,.txt,application/sql,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={running}
            className="flex w-full items-center gap-2 rounded-lg border border-dashed border-line2 bg-panel2 px-3 py-3 text-left hover:border-acc/60 disabled:opacity-50"
          >
            <FileText size={16} className="flex-none text-acc" />
            {file ? (
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-semibold">{file.name}</span>
                <span className="text-[11px] text-faint">
                  {sizeLabel(file.size)} · click to change
                </span>
              </span>
            ) : (
              <span className="text-[12.5px] text-dim">Choose a .sql file…</span>
            )}
          </button>

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-med/30 bg-med/10 px-3 py-2 text-[11.5px] text-med">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>
              Statements run directly against <span className="font-semibold">{database}</span>. This
              can create, modify, or overwrite data and isn&apos;t undoable.
            </span>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={emptyFirst}
              disabled={running}
              onChange={(e) => {
                setEmptyFirst(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-high" />
                Drop existing tables first
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">
                {tableCount > 0
                  ? `Permanently deletes all ${String(tableCount)} table${tableCount === 1 ? "" : "s"} in ${database} before importing, so a full dump restores without "already exists" errors.`
                  : `${database} is already empty — the dump will import as-is.`}
              </span>
            </span>
          </label>

          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={disableFk}
              disabled={running}
              onChange={(e) => {
                setDisableFk(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-med" />
                Disable foreign-key checks during import
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">
                Recommended for full dumps — lets tables and rows load in any order without
                constraint errors (1452). Re-enabled automatically when the import finishes.
              </span>
            </span>
          </label>

          {running && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-dim">
                <span>{emptying ? "Emptying database…" : "Streaming & importing…"}</span>
                <span className="font-mono tabular-nums">{progress}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-panel">
                <div
                  className="h-full rounded-full bg-acc transition-all"
                  style={{ width: `${String(progress)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void run();
            }}
            disabled={!file || running}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow disabled:opacity-40 disabled:shadow-none"
            style={{ background: GRADIENT }}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {emptying ? "Emptying…" : running ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Name and create a new database on the connected server, then switch to it. */
function CreateDatabaseDialog({
  dialect,
  creating,
  existing,
  onCancel,
  onCreate,
}: {
  dialect: DbDialect;
  creating: boolean;
  existing: string[];
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = name.trim();
  const duplicate = existing.some((d) => d.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !duplicate && !creating;
  const submit = () => {
    if (canCreate) onCreate(trimmed);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-strong flex w-[440px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-[18px] w-[18px] place-items-center rounded bg-acc/20 text-acc">
            <Database size={12} />
          </span>
          <span className="text-[14px] font-bold">Create database</span>
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="ml-auto grid place-items-center text-faint hover:text-ink disabled:opacity-40"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4">
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-faint">
            Name
          </label>
          <input
            ref={inputRef}
            value={name}
            disabled={creating}
            placeholder="my_new_database"
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full rounded-lg border border-line bg-panel2 px-2.5 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-acc disabled:opacity-50"
          />
          {duplicate ? (
            <p className="mt-2 text-[11px] text-med">
              A database named “{trimmed}” already exists.
            </p>
          ) : (
            <p className="mt-2 text-[11px] text-faint">
              Creates an empty database on this {dialect === "mysql" ? "MySQL" : "PostgreSQL"}{" "}
              server and switches to it.
            </p>
          )}
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canCreate}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow disabled:opacity-40"
            style={{ background: GRADIENT }}
          >
            <Plus size={13} />
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Confirm dropping several tables at once, with an opt-in to skip FK checks. */
function DropTablesDialog({
  tables,
  dialect,
  dropping,
  onCancel,
  onDrop,
}: {
  tables: string[];
  dialect: DbDialect;
  dropping: boolean;
  onCancel: () => void;
  onDrop: (disableFk: boolean) => void;
}) {
  const [disableFk, setDisableFk] = useState(false);
  const fkHint =
    dialect === "mysql"
      ? "Runs with FOREIGN_KEY_CHECKS = 0 so tables referenced by others still drop."
      : "Uses DROP TABLE … CASCADE, which also drops dependent foreign keys.";

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-[460px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-3">
          <span className="grid h-[18px] w-[18px] place-items-center rounded bg-crit/20 text-crit">
            <Trash2 size={12} />
          </span>
          <span className="text-[14px] font-bold">
            Drop {tables.length} table{tables.length === 1 ? "" : "s"}?
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="flex items-start gap-2 rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-[11.5px] text-crit">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>This permanently deletes the table(s) and all their data. It can't be undone.</span>
          </div>

          <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-panel2 p-2">
            {tables.map((t) => (
              <div key={t} className="flex items-center gap-2 py-0.5 font-mono text-[12px]">
                <Table2 size={12} className="flex-none text-faint" />
                {t}
              </div>
            ))}
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={disableFk}
              disabled={dropping}
              onChange={(e) => {
                setDisableFk(e.target.checked);
              }}
              className="mt-0.5 h-3.5 w-3.5 accent-[#a64bff]"
            />
            <span>
              <span className="inline-flex items-center gap-1 font-semibold text-ink">
                <ShieldOff size={12} className="text-med" />
                Drop without foreign-key checks
              </span>
              <span className="mt-0.5 block text-[11px] text-faint">{fkHint}</span>
            </span>
          </label>
        </div>

        <div className="flex flex-none items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={dropping}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onDrop(disableFk);
            }}
            disabled={dropping}
            className="inline-flex items-center gap-1.5 rounded-lg border border-crit/50 bg-crit/15 px-3 py-1.5 text-[12.5px] font-semibold text-crit hover:bg-crit/25 disabled:opacity-40"
          >
            <Trash2 size={13} />
            {dropping ? "Dropping…" : `Drop ${String(tables.length)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultGrid({
  result,
  sort,
  onSort,
  pkColumns,
  onSaveRow,
  onDeleteRow,
  onCellMenu,
  onCellClick,
}: {
  result: QueryResult;
  sort?: { col: string; dir: "asc" | "desc" } | null;
  onSort?: (col: string) => void;
  pkColumns?: string[];
  onSaveRow?: (original: (string | null)[], next: (string | null)[]) => Promise<boolean>;
  onDeleteRow?: (row: (string | null)[]) => Promise<boolean>;
  onCellMenu?: (
    e: React.MouseEvent,
    column: string,
    value: string | null,
    row: (string | null)[],
  ) => void;
  onCellClick?: (column: string, value: string | null) => void;
}) {
  const editable = !!onSaveRow && (pkColumns?.length ?? 0) > 0;
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [draft, setDraft] = useState<(string | null)[]>([]);
  const [saving, setSaving] = useState(false);

  if (result.columns.length === 0) {
    return (
      <div className="p-4 text-[12px] text-dim">{result.rowsAffected} row(s). No columns.</div>
    );
  }

  const startEdit = (i: number) => {
    const r = result.rows[i];
    if (!r) return;
    setEditing(i);
    setDraft([...r]);
  };

  const save = async (original: (string | null)[]) => {
    if (!onSaveRow) return;
    setSaving(true);
    const ok = await onSaveRow(original, draft);
    setSaving(false);
    if (ok) setEditing(null);
  };

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead className="sticky top-0">
        <tr>
          {editable && <th className="w-px border-b border-line bg-panel2" />}
          {result.columns.map((c) => (
            <th
              key={c}
              className="border-b border-line bg-panel2 px-3 py-1.5 text-left font-semibold text-dim"
            >
              {onSort ? (
                <button
                  type="button"
                  onClick={() => {
                    onSort(c);
                  }}
                  className="inline-flex items-center gap-1 hover:text-ink"
                  title="Sort by this column"
                >
                  {c}
                  <span className="text-acc">
                    {sort?.col === c ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                  </span>
                </button>
              ) : (
                c
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, i) => {
          const isEdit = editing === i;
          return (
            <tr key={i} className={isEdit ? "bg-acc/5" : "hover:bg-panel2/60"}>
              {editable && (
                <td className="border-b border-line/50 px-2 py-1 align-top">
                  {isEdit ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Save row"
                        disabled={saving}
                        onClick={() => {
                          void save(row);
                        }}
                        className="grid h-6 w-6 place-items-center rounded bg-acc/20 text-acc hover:bg-acc/30 disabled:opacity-40"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Cancel"
                        disabled={saving}
                        onClick={() => {
                          setEditing(null);
                        }}
                        className="grid h-6 w-6 place-items-center rounded border border-line hover:border-line2 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : confirmDelete === i ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        title="Confirm delete"
                        disabled={saving}
                        onClick={() => {
                          if (!onDeleteRow) return;
                          setSaving(true);
                          void onDeleteRow(row).finally(() => {
                            setSaving(false);
                            setConfirmDelete(null);
                          });
                        }}
                        className="grid h-6 w-6 place-items-center rounded bg-crit/20 text-crit hover:bg-crit/30 disabled:opacity-40"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Cancel"
                        disabled={saving}
                        onClick={() => {
                          setConfirmDelete(null);
                        }}
                        className="grid h-6 w-6 place-items-center rounded border border-line hover:border-line2 disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        title="Edit row"
                        onClick={() => {
                          startEdit(i);
                        }}
                        className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-panel2 hover:text-ink"
                      >
                        <Pencil size={12} />
                      </button>
                      {onDeleteRow && (
                        <button
                          type="button"
                          title="Delete row"
                          onClick={() => {
                            setConfirmDelete(i);
                          }}
                          className="grid h-6 w-6 place-items-center rounded text-faint hover:bg-crit/15 hover:text-crit"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  )}
                </td>
              )}
              {row.map((cell, j) => (
                <td
                  key={j}
                  onClick={
                    onCellClick && !isEdit
                      ? () => {
                          onCellClick(result.columns[j] ?? "", cell);
                        }
                      : undefined
                  }
                  onContextMenu={
                    onCellMenu && !isEdit
                      ? (e) => {
                          onCellMenu(e, result.columns[j] ?? "", cell, row);
                        }
                      : undefined
                  }
                  title={onCellClick && !isEdit ? "Click to view full value" : undefined}
                  className={`max-w-[360px] border-b border-line/50 px-3 py-1.5 font-mono ${isEdit ? "" : "cursor-pointer truncate"}`}
                >
                  {isEdit ? (
                    <CellEditor
                      value={draft[j] ?? null}
                      disabled={saving}
                      onChange={(v) => {
                        setDraft((d) => d.map((x, k) => (k === j ? v : x)));
                      }}
                    />
                  ) : cell === null ? (
                    <span className="italic text-faint">NULL</span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CellEditor({
  value,
  disabled,
  onChange,
}: {
  value: string | null;
  disabled: boolean;
  onChange: (v: string | null) => void;
}) {
  if (value === null) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] italic text-faint">NULL</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange("");
          }}
          className="text-[10px] text-acc2 hover:underline disabled:opacity-40"
        >
          set value
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="w-full min-w-[90px] rounded border border-line bg-panel px-1.5 py-0.5 text-[12px] outline-none focus:border-acc disabled:opacity-50"
      />
      <button
        type="button"
        title="Set NULL"
        disabled={disabled}
        onClick={() => {
          onChange(null);
        }}
        className="flex-none rounded px-1 text-[11px] text-faint hover:text-ink disabled:opacity-40"
      >
        ∅
      </button>
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${full ? "col-span-2" : ""}`}>
      <span className="text-[11px] text-faint">{label}</span>
      {children}
    </label>
  );
}

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[12px] ${active ? "bg-panel3 text-ink" : "text-dim hover:text-ink"}`}
    >
      {label}
    </button>
  );
}

/** A blank-field form to INSERT a new row. Empty fields fall back to defaults. */
function InsertRow({
  columns,
  onCancel,
  onInsert,
}: {
  columns: string[];
  onCancel: () => void;
  onInsert: (draft: (string | null)[]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<(string | null)[]>(() => columns.map(() => ""));
  const [saving, setSaving] = useState(false);

  const submit = () => {
    setSaving(true);
    void onInsert(draft).finally(() => {
      setSaving(false);
    });
  };

  return (
    <div className="border-b border-line bg-acc/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-[11.5px]">
        <Plus size={13} className="text-acc" />
        <span className="font-semibold text-ink">New row</span>
        <span className="text-faint">— leave a field blank to use its default</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {columns.map((c, j) => (
          <label key={c} className="flex flex-col gap-0.5">
            <span className="font-mono text-[10.5px] text-faint">{c}</span>
            <input
              value={draft[j] ?? ""}
              spellCheck={false}
              onChange={(e) => {
                setDraft((d) => d.map((x, k) => (k === j ? e.target.value : x)));
              }}
              className="w-40 rounded border border-line bg-panel px-1.5 py-1 font-mono text-[12px] outline-none focus:border-acc"
            />
          </label>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white shadow-glow disabled:opacity-40"
          style={{ background: GRADIENT }}
        >
          <Check size={13} />
          {saving ? "Inserting…" : "Insert"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12px] hover:border-line2 disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A modal showing a single cell's full value — Beekeeper's row/cell viewer. */
function CellDetail({
  column,
  value,
  onClose,
}: {
  column: string;
  value: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const pretty = value === null ? { text: "NULL", isJson: false } : prettyMaybeJson(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[55] grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[80vh] w-[640px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex flex-none items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="font-mono text-[12.5px] font-semibold">{column}</span>
          {pretty.isJson && (
            <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] text-faint">JSON</span>
          )}
          {value !== null && (
            <span className="text-[11px] text-faint">{value.length} chars</span>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(value ?? "").then(() => {
                setCopied(true);
                setTimeout(() => {
                  setCopied(false);
                }, 1200);
              });
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line bg-panel2 px-2 py-1 text-[11.5px] hover:border-line2"
          >
            {copied ? <Check size={12} color="#3ecf8e" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {value === null ? (
            <span className="italic text-faint">NULL</span>
          ) : value.length === 0 ? (
            <span className="italic text-faint">(empty string)</span>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
              {pretty.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

/** A compact, human-readable label for a canonical column type. */
function typeLabel(t: CanonicalType): string {
  switch (t.kind) {
    case "serial":
      return t.size === "big" ? "bigserial" : t.size === "small" ? "smallserial" : "serial";
    case "int":
      return t.size === "big" ? "bigint" : t.size === "small" ? "smallint" : "int";
    case "decimal":
      return `decimal(${String(t.precision)},${String(t.scale)})`;
    case "string":
      return `varchar(${String(t.length)})`;
    default:
      return t.kind;
  }
}

/** phpMyAdmin-style "Structure" view: columns, keys, indexes and FKs of a table. */
function StructureView({
  loading,
  error,
  selected,
  table,
  onColumnMenu,
}: {
  loading: boolean;
  error: string | null;
  selected: string | null;
  table: Table | undefined;
  onColumnMenu: (e: React.MouseEvent, column: string) => void;
}) {
  if (loading) return <div className="p-4 text-[12px] text-dim">Reading the database schema…</div>;
  if (error)
    return (
      <div className="m-3 rounded-lg border border-crit/40 bg-crit/10 p-3 font-mono text-[11.5px] text-crit">
        {error}
      </div>
    );
  if (!selected) return <div className="p-4 text-[12px] text-dim">Select a table on the left to view its structure.</div>;
  if (!table)
    return <div className="p-4 text-[12px] text-dim">No structure found for “{selected}”.</div>;

  const pk = new Set(table.primaryKey ?? []);

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold">
          <Table2 size={14} className="text-acc" />
          {table.name}
          <span className="text-[11px] font-normal text-faint">· {table.columns.length} columns</span>
        </div>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-faint">
              <th className="border-b border-line px-3 py-1.5 font-semibold">Column</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Type</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Null</th>
              <th className="border-b border-line px-3 py-1.5 font-semibold">Key</th>
            </tr>
          </thead>
          <tbody>
            {table.columns.map((col) => (
              <tr
                key={col.name}
                onContextMenu={(e) => {
                  onColumnMenu(e, col.name);
                }}
                className="cursor-context-menu hover:bg-panel2/60"
              >
                <td className="border-b border-line/50 px-3 py-1.5 font-mono">{col.name}</td>
                <td className="border-b border-line/50 px-3 py-1.5 font-mono text-acc2">
                  {typeLabel(col.type)}
                </td>
                <td className="border-b border-line/50 px-3 py-1.5 text-dim">
                  {col.nullable ? "YES" : "NO"}
                </td>
                <td className="border-b border-line/50 px-3 py-1.5">
                  {pk.has(col.name) && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-high">
                      <KeyRound size={11} /> PK
                    </span>
                  )}
                  {col.unique && !pk.has(col.name) && (
                    <span className="text-[11px] text-dim">unique</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {table.indexes.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
            <ListTree size={13} className="text-acc" /> Indexes
          </div>
          <ul className="space-y-1 text-[12px]">
            {table.indexes.map((idx, i) => (
              <li key={i} className="font-mono text-dim">
                {idx.unique ? "UNIQUE " : ""}({idx.columns.join(", ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {table.foreignKeys.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
            <GitBranch size={13} className="text-acc" /> Foreign keys
          </div>
          <ul className="space-y-1 text-[12px]">
            {table.foreignKeys.map((fk, i) => (
              <li key={i} className="font-mono text-dim">
                ({fk.columns.join(", ")}) → {fk.refTable} ({fk.refColumns.join(", ")})
                {fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
