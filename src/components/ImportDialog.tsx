import type { Smell } from "@schemaguard/core";
import {
  detectSmells,
  healthScore,
  parseLaravel,
  parseLaravelMigrations,
  parseSql,
} from "@schemaguard/core";
import { AlertTriangle, Check, FileText, FolderOpen, Loader2, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import type { DestructiveEntry, DriftIssue, ImportSummary } from "../lib/importInsights";
import { destructiveOps, detectDrift, summarizeImport } from "../lib/importInsights";
import { gridLayout } from "../lib/layout";
import { pickFolderFiles, pickTextFiles } from "../lib/projectFile";
import { useSchemaStore } from "../stores/schema";
import { toast } from "../stores/toasts";

interface ImportReport {
  summary: ImportSummary;
  drift: DriftIssue[];
  destructive: DestructiveEntry[];
  warnings: string[];
}

/** Post-import overview for a raw SQL / DDL import (no migration history). */
interface SqlReport {
  tables: number;
  columns: number;
  foreignKeys: number;
  indexes: number;
  score: number;
  smells: Smell[];
  warnings: string[];
}

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

const LARAVEL_EXAMPLE = `Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique();
    $table->timestamps();
});

Schema::create('posts', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('title');
    $table->boolean('published')->default(false);
});`;

const SQL_EXAMPLE = `CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(120)
);

CREATE TABLE posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);`;

type Mode = "laravel" | "sql";

type PickedFiles = { name: string; content: string }[];

export function ImportDialog({
  onClose,
  initialMode = "laravel",
}: {
  onClose: () => void;
  initialMode?: Mode;
}) {
  const loadProject = useSchemaStore((s) => s.loadProject);
  const loadHistory = useSchemaStore((s) => s.loadHistory);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState("");
  const [migFiles, setMigFiles] = useState<PickedFiles>([]);
  const [modelFiles, setModelFiles] = useState<PickedFiles>([]);
  // Progress for whichever folder is currently being read, plus the build step.
  const [reading, setReading] = useState<"migrations" | "models" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [building, setBuilding] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [sqlReport, setSqlReport] = useState<SqlReport | null>(null);
  // Visible feedback for the paste / open-file path: "reading" the file off the
  // disk, then "parsing" it into the schema (the parse is synchronous).
  const [importBusy, setImportBusy] = useState<null | "reading" | "parsing">(null);

  const runImport = (source: string) => {
    // Show "Parsing…" first, then defer one tick so it paints before the
    // synchronous parse blocks the main thread (matches the folder build).
    setImportBusy("parsing");
    setTimeout(() => {
      try {
        const { schema, warnings } = mode === "sql" ? parseSql(source) : parseLaravel(source);
        if (schema.tables.length === 0) {
          alert(
            mode === "sql"
              ? "No tables found. Paste SQL containing CREATE TABLE statements."
              : "No tables found. Paste Laravel migration(s) that contain Schema::create(...).",
          );
          return;
        }
        loadProject(schema, gridLayout(schema));

        if (mode === "sql") {
          // Keep the dialog open and show a post-import overview (parity with the
          // Laravel folder import) instead of just firing a toast.
          const smells = detectSmells(schema);
          let columns = 0;
          let foreignKeys = 0;
          let indexes = 0;
          for (const t of schema.tables) {
            columns += t.columns.length;
            foreignKeys += t.foreignKeys.length;
            indexes += t.indexes.length;
          }
          setSqlReport({
            tables: schema.tables.length,
            columns,
            foreignKeys,
            indexes,
            score: healthScore(smells),
            smells,
            warnings,
          });
          return;
        }

        toast.success(
          `Imported ${String(schema.tables.length)} table(s)${
            warnings.length > 0 ? ` · ${String(warnings.length)} note(s)` : ""
          }.`,
        );
        onClose();
      } catch (err) {
        toast.error(`Couldn't import: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setImportBusy(null);
      }
    }, 30);
  };

  const pickFolder = (which: "migrations" | "models", set: (f: PickedFiles) => void) => {
    setReading(which);
    setProgress({ done: 0, total: 0 });
    void pickFolderFiles(".php", (done, total) => {
      setProgress({ done, total });
    })
      .then((files) => {
        if (files.length > 0) set(files);
      })
      .finally(() => {
        setReading(null);
      });
  };

  const buildFromFolders = () => {
    if (migFiles.length === 0) return;
    // Defer the (synchronous) parse one tick so the "Building…" bar can paint.
    setBuilding(true);
    setTimeout(() => {
      try {
        const history = parseLaravelMigrations(migFiles, modelFiles);
        if (history.migrations.length === 0) {
          toast.error("No Laravel migrations (Schema::create/table) found in that folder.");
          return;
        }
        loadHistory(
          {
            migrations: history.migrations,
            snapshots: history.snapshots,
            finalSchema: history.finalSchema,
            modelRelations: history.modelRelations,
            modelInfos: history.modelInfos,
          },
          gridLayout(history.finalSchema),
        );
        // Compute the import insights and show a summary instead of closing.
        const drift = detectDrift(
          history.finalSchema,
          history.modelInfos,
          history.modelRelations,
        );
        const summary = summarizeImport({
          schema: history.finalSchema,
          migrations: history.migrations,
          modelInfos: history.modelInfos,
          modelRelations: history.modelRelations,
          driftIssues: drift.length,
        });
        setReport({
          summary,
          drift,
          destructive: destructiveOps(history.migrations),
          warnings: history.warnings,
        });
      } catch (err) {
        toast.error(`Couldn't build: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBuilding(false);
      }
    }, 30);
  };

  const openFiles = () => {
    setImportBusy("reading");
    void pickTextFiles(mode === "sql" ? ".sql" : ".php")
      .then((texts) => {
        // runImport flips the state to "parsing"; clear it if nothing was chosen.
        if (texts.length > 0) runImport(texts.join("\n\n"));
        else setImportBusy(null);
      })
      .catch(() => {
        setImportBusy(null);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[82vh] w-[660px] max-w-full animate-pop flex-col overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {report ? (
          <ImportSummaryView report={report} onClose={onClose} />
        ) : sqlReport ? (
          <SqlImportSummaryView report={sqlReport} onClose={onClose} />
        ) : (
          <>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="text-[14px] font-bold">Import</span>
          <div className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5 text-[12px]">
            <ModeTab
              label="Laravel migrations"
              active={mode === "laravel"}
              onClick={() => setMode("laravel")}
            />
            <ModeTab label="SQL / DDL" active={mode === "sql"} onClick={() => setMode("sql")} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto grid place-items-center text-faint hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {mode === "laravel" && (
          <div className="mx-4 mt-3 flex flex-col gap-2 rounded-lg border border-acc/40 bg-acc/10 p-3">
            <FolderRow
              label="Migrations folder"
              hint="Builds the timeline + schema (database/migrations)."
              required
              count={migFiles.length}
              busy={reading === "migrations"}
              progress={progress}
              onPick={() => {
                pickFolder("migrations", setMigFiles);
              }}
            />
            <FolderRow
              label="Models folder"
              hint="Optional — adds relationships (app/Models)."
              count={modelFiles.length}
              busy={reading === "models"}
              progress={progress}
              onPick={() => {
                pickFolder("models", setModelFiles);
              }}
            />
            <button
              type="button"
              disabled={migFiles.length === 0 || building || reading !== null}
              onClick={buildFromFolders}
              className="mt-1 rounded-lg px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-40"
              style={{ background: GRADIENT }}
            >
              {building ? "Building…" : "Build schema & diagram"}
            </button>
            {building && (
              <div className="h-1.5 overflow-hidden rounded-full bg-panel">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-acc" />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 px-4 pt-3 text-[12px]">
          <button
            type="button"
            onClick={openFiles}
            disabled={importBusy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 hover:border-line2 disabled:opacity-50"
          >
            {importBusy === "reading" ? (
              <Loader2 size={14} className="animate-spin text-acc" />
            ) : (
              <FileText size={14} />
            )}
            {importBusy === "reading"
              ? "Reading…"
              : `Open ${mode === "sql" ? ".sql" : ".php"} files…`}
          </button>
          <button
            type="button"
            onClick={() => {
              setText(mode === "sql" ? SQL_EXAMPLE : LARAVEL_EXAMPLE);
            }}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 hover:border-line2"
          >
            Paste example
          </button>
          <span className="ml-auto text-faint">
            or paste {mode === "sql" ? "SQL" : "migration"} code below
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          spellCheck={false}
          placeholder={
            mode === "sql"
              ? "CREATE TABLE users ( id BIGSERIAL PRIMARY KEY, ... );"
              : "Schema::create('users', function (Blueprint $table) { ... });"
          }
          className="m-4 h-64 flex-1 resize-none rounded-lg border border-line bg-panel2 p-3 font-mono text-[12px] text-ink outline-none focus:border-acc"
        />

        {importBusy !== null && (
          <div className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-dim">
            <Loader2 size={14} className="flex-none animate-spin text-acc" />
            <span className="flex-none">
              {importBusy === "reading" ? "Reading file…" : "Parsing & building schema…"}
            </span>
            <span className="ml-1 h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
              <span className="block h-full w-1/3 animate-pulse rounded-full bg-acc" />
            </span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={text.trim().length === 0 || importBusy !== null}
            onClick={() => {
              runImport(text);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
            style={{ background: GRADIENT }}
          >
            {importBusy === "parsing" && <Loader2 size={14} className="animate-spin" />}
            {importBusy === "parsing" ? "Parsing…" : "Build schema & diagram"}
          </button>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Post-import overview: counts, risk, destructive ops, and schema↔model drift. */
function ImportSummaryView({ report, onClose }: { report: ImportReport; onClose: () => void }) {
  const { summary: s, drift, destructive, warnings } = report;
  const stats: { label: string; value: number }[] = [
    { label: "migrations", value: s.migrations },
    { label: "tables", value: s.tables },
    { label: "columns", value: s.columns },
    { label: "foreign keys", value: s.foreignKeys },
    { label: "indexes", value: s.indexes },
    { label: "relationships", value: s.relationships },
  ];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-[18px] w-[18px] place-items-center rounded bg-low/20 text-low">
          <Check size={12} strokeWidth={3} />
        </span>
        <span className="text-[14px] font-bold">Import complete</span>
        {(s.dateFrom ?? s.dateTo) && (
          <span className="font-mono text-[11px] text-faint">
            {s.dateFrom} → {s.dateTo}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid place-items-center text-faint hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-3 gap-2">
          {stats.map((st) => (
            <div key={st.label} className="lit rounded-lg border border-line bg-panel2 px-3 py-2">
              <div className="font-mono text-[18px] font-bold tabular-nums">{st.value}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-faint">{st.label}</div>
            </div>
          ))}
        </div>

        {/* Risk chips */}
        <div className="mt-3 flex flex-wrap gap-2">
          {s.risky > 0 ? (
            <Chip tone="crit" icon={<AlertTriangle size={11} />} text={`${String(s.risky)} risky migration${s.risky === 1 ? "" : "s"}`} />
          ) : (
            <Chip tone="low" icon={<ShieldCheck size={11} />} text="No risky migrations" />
          )}
          {s.irreversible > 0 && (
            <Chip tone="med" text={`${String(s.irreversible)} without down()`} />
          )}
          {s.destructive > 0 && (
            <Chip tone="high" text={`${String(s.destructive)} destructive op${s.destructive === 1 ? "" : "s"}`} />
          )}
          {s.driftIssues > 0 ? (
            <Chip tone="med" text={`${String(s.driftIssues)} drift issue${s.driftIssues === 1 ? "" : "s"}`} />
          ) : (
            s.models > 0 && <Chip tone="low" icon={<Check size={11} />} text="Models match schema" />
          )}
          <Chip tone="info" text={`${String(s.models)} model${s.models === 1 ? "" : "s"}`} />
        </div>

        {destructive.length > 0 && (
          <SummarySection title={`Destructive operations · ${String(destructive.length)}`}>
            {destructive.map((d, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5 text-[11.5px]">
                <span className="font-mono text-[10px] text-faint">{d.date || "—"}</span>
                <span className="rounded bg-crit/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-crit">
                  {d.op.kind}
                </span>
                <span className="truncate text-dim">
                  {d.op.table}
                  {d.op.column ? `.${d.op.column}` : ""}
                  {d.op.detail ? ` — ${d.op.detail}` : ""}
                </span>
              </div>
            ))}
          </SummarySection>
        )}

        {drift.length > 0 && (
          <SummarySection title={`Schema ⇄ model drift · ${String(drift.length)}`}>
            {drift.map((d, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5 text-[11.5px] leading-snug">
                <span className="mt-0.5 flex-none font-semibold text-ink">{d.model}</span>
                <span className={d.tone === "warn" ? "text-med" : "text-acc2"}>{d.text}</span>
              </div>
            ))}
          </SummarySection>
        )}

        {warnings.length > 0 && (
          <SummarySection title={`Parse notes · ${String(warnings.length)}`}>
            {warnings.slice(0, 12).map((w, i) => (
              <div key={i} className="py-0.5 text-[11.5px] text-dim">
                • {w}
              </div>
            ))}
          </SummarySection>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white"
          style={{ background: GRADIENT }}
        >
          Done
        </button>
      </div>
    </>
  );
}

/** Post-import overview for a raw SQL / DDL import: counts + design health. */
function SqlImportSummaryView({ report, onClose }: { report: SqlReport; onClose: () => void }) {
  const { tables, columns, foreignKeys, indexes, score, smells, warnings } = report;
  const warn = smells.filter((s) => s.severity === "warn").length;
  const info = smells.filter((s) => s.severity === "info").length;
  const scoreTone = score >= 80 ? "low" : score >= 50 ? "med" : "crit";
  const stats: { label: string; value: number }[] = [
    { label: "tables", value: tables },
    { label: "columns", value: columns },
    { label: "foreign keys", value: foreignKeys },
    { label: "indexes", value: indexes },
  ];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="grid h-[18px] w-[18px] place-items-center rounded bg-low/20 text-low">
          <Check size={12} strokeWidth={3} />
        </span>
        <span className="text-[14px] font-bold">SQL imported</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid place-items-center text-faint hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          {stats.map((st) => (
            <div key={st.label} className="lit rounded-lg border border-line bg-panel2 px-3 py-2">
              <div className="font-mono text-[18px] font-bold tabular-nums">{st.value}</div>
              <div className="text-[10.5px] uppercase tracking-wider text-faint">{st.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip
            tone={scoreTone}
            icon={<ShieldCheck size={11} />}
            text={`Health ${String(score)}/100`}
          />
          {warn > 0 ? (
            <Chip
              tone="med"
              icon={<AlertTriangle size={11} />}
              text={`${String(warn)} warning${warn === 1 ? "" : "s"}`}
            />
          ) : (
            <Chip tone="low" icon={<Check size={11} />} text="No design warnings" />
          )}
          {info > 0 && <Chip tone="info" text={`${String(info)} suggestion${info === 1 ? "" : "s"}`} />}
        </div>

        {smells.length > 0 && (
          <SummarySection title={`Design smells · ${String(smells.length)}`}>
            {smells.slice(0, 8).map((s, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5 text-[11.5px] leading-snug">
                <span
                  className={`mt-1 inline-block h-2 w-2 flex-none rounded-full ${
                    s.severity === "warn" ? "bg-med" : "bg-acc2"
                  }`}
                />
                <span className="flex-none font-semibold text-ink">
                  {s.table}
                  {s.column ? `.${s.column}` : ""}
                </span>
                <span className="text-dim">{s.title}</span>
              </div>
            ))}
            {smells.length > 8 && (
              <div className="pt-1 text-[11px] text-faint">
                +{String(smells.length - 8)} more — see Schema health
              </div>
            )}
          </SummarySection>
        )}

        {warnings.length > 0 && (
          <SummarySection title={`Parse notes · ${String(warnings.length)}`}>
            {warnings.slice(0, 12).map((w, i) => (
              <div key={i} className="py-0.5 text-[11.5px] text-dim">
                • {w}
              </div>
            ))}
          </SummarySection>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-1.5 text-[12.5px] font-semibold text-white"
          style={{ background: GRADIENT }}
        >
          Done
        </button>
      </div>
    </>
  );
}

const CHIP_TONE: Record<string, string> = {
  crit: "border-crit/40 bg-crit/10 text-crit",
  high: "border-high/40 bg-high/10 text-high",
  med: "border-med/40 bg-med/10 text-med",
  low: "border-low/40 bg-low/10 text-low",
  info: "border-acc2/40 bg-acc2/10 text-acc2",
};

function Chip({ tone, icon, text }: { tone: string; icon?: React.ReactNode; text: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CHIP_TONE[tone] ?? CHIP_TONE.info}`}
    >
      {icon}
      {text}
    </span>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wider text-faint">
        {title}
      </div>
      <div className="rounded-lg border border-line bg-panel2 px-3 py-2">{children}</div>
    </div>
  );
}

function FolderRow({
  label,
  hint,
  count,
  required,
  busy,
  progress,
  onPick,
}: {
  label: string;
  hint: string;
  count: number;
  required?: boolean;
  busy?: boolean;
  progress: { done: number; total: number };
  onPick: () => void;
}) {
  const picked = count > 0;
  const pct = busy && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onPick}
      className="flex items-center gap-3 rounded-lg border border-line bg-panel2 px-3 py-2 text-left hover:border-line2 disabled:cursor-wait"
    >
      {picked && !busy ? (
        <Check size={18} className="flex-none text-acc" />
      ) : (
        <FolderOpen size={18} className="flex-none text-acc" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold">
          {label}
          {required ? <span className="text-acc"> *</span> : null}
        </span>
        {busy ? (
          <span className="mt-1 block">
            <span className="block text-[11px] text-dim">
              Reading {progress.done}/{progress.total} files… {pct}%
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel">
              <span
                className="block h-full rounded-full bg-acc transition-all"
                style={{ width: `${String(pct)}%` }}
              />
            </span>
          </span>
        ) : (
          <span className="block truncate text-[11px] text-dim">
            {picked ? `${String(count)} .php file${count === 1 ? "" : "s"} selected` : hint}
          </span>
        )}
      </span>
      {!busy && (
        <span className="flex-none text-[11px] text-faint">{picked ? "Change…" : "Choose…"}</span>
      )}
    </button>
  );
}

function ModeTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 ${active ? "font-semibold text-white" : "text-dim"}`}
      style={active ? { background: GRADIENT } : undefined}
    >
      {label}
    </button>
  );
}
