import { parseLaravel, parseLaravelMigrations, parseSql } from "@schemaguard/core";
import { Check, FileText, FolderOpen, X } from "lucide-react";
import { useState } from "react";

import { gridLayout } from "../lib/layout";
import { pickFolderFiles, pickTextFiles } from "../lib/projectFile";
import { useSchemaStore } from "../stores/schema";

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

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const loadProject = useSchemaStore((s) => s.loadProject);
  const loadHistory = useSchemaStore((s) => s.loadHistory);
  const [mode, setMode] = useState<Mode>("laravel");
  const [text, setText] = useState("");
  const [migFiles, setMigFiles] = useState<PickedFiles>([]);
  const [modelFiles, setModelFiles] = useState<PickedFiles>([]);
  // Progress for whichever folder is currently being read, plus the build step.
  const [reading, setReading] = useState<"migrations" | "models" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [building, setBuilding] = useState(false);

  const runImport = (source: string) => {
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
    if (warnings.length > 0) {
      alert(
        `Imported ${String(schema.tables.length)} table(s) with notes:\n\n• ${warnings.slice(0, 8).join("\n• ")}`,
      );
    }
    onClose();
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
          alert("No Laravel migrations (Schema::create/table) found in the migrations folder.");
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
        if (history.warnings.length > 0) {
          alert(
            `Imported ${String(history.migrations.length)} migrations with notes:\n\n• ${history.warnings.slice(0, 8).join("\n• ")}`,
          );
        }
        onClose();
      } catch (err) {
        alert(`Couldn't build: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBuilding(false);
      }
    }, 30);
  };

  const openFiles = () => {
    void pickTextFiles(mode === "sql" ? ".sql" : ".php").then((texts) => {
      if (texts.length > 0) runImport(texts.join("\n\n"));
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 hover:border-line2"
          >
            <FileText size={14} />
            Open {mode === "sql" ? ".sql" : ".php"} files…
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
            disabled={text.trim().length === 0}
            onClick={() => {
              runImport(text);
            }}
            className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
            style={{ background: GRADIENT }}
          >
            Build schema &amp; diagram
          </button>
        </div>
      </div>
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
