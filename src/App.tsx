import {
  detectSmells,
  dialectFor,
  emitDdl,
  healthScore,
  sampleSchema,
  validate,
} from "@schemaguard/core";
import {
  AlertTriangle,
  Database,
  Download,
  FileInput,
  ListTree,
  Moon,
  PanelsTopLeft,
  Plug,
  Plus,
  Redo2,
  Settings,
  Share2,
  Shield,
  Sparkles,
  Sun,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Assistant } from "./components/Assistant";
import { Canvas } from "./components/Canvas";
import { CatalogDialog } from "./components/CatalogDialog";
import type { Command } from "./components/CommandPalette";
import { CommandPalette } from "./components/CommandPalette";
import { DatabasePanel } from "./components/DatabasePanel";
import { DataflowView } from "./components/DataflowView";
import { ImportDialog } from "./components/ImportDialog";
import { IndexingDialog } from "./components/IndexingDialog";
import { Inspector } from "./components/Inspector";
import { LeftPane } from "./components/LeftPane";
import { McpDialog } from "./components/McpDialog";
import { QueryPanel } from "./components/QueryPanel";
import { RecentsDialog } from "./components/RecentsDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { SmellsDialog } from "./components/SmellsDialog";
import { Toaster } from "./components/Toaster";
import { startAppBridge } from "./lib/appBridge";
import { autoLayout } from "./lib/autoLayout";
import { gridLayout } from "./lib/layout";
import { downloadText, parseProject, pickTextFile, serializeProject } from "./lib/projectFile";
import { useRecents } from "./stores/recents";
import { useSchemaStore } from "./stores/schema";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";

const GRADIENT = "linear-gradient(135deg,#ff3fa4,#a64bff)";

export function App() {
  const schema = useSchemaStore((s) => s.schema);
  const positions = useSchemaStore((s) => s.positions);
  const selectedTable = useSchemaStore((s) => s.selectedTable);
  const newProject = useSchemaStore((s) => s.newProject);
  const loadProject = useSchemaStore((s) => s.loadProject);
  const loadFullProject = useSchemaStore((s) => s.loadFullProject);
  const migrationSnapshots = useSchemaStore((s) => s.migrationSnapshots);
  const modelRelations = useSchemaStore((s) => s.modelRelations);
  const shownRelationModels = useSchemaStore((s) => s.shownRelationModels);
  const modelInfos = useSchemaStore((s) => s.modelInfos);
  const addTable = useSchemaStore((s) => s.addTable);
  const undo = useSchemaStore((s) => s.undo);
  const redo = useSchemaStore((s) => s.redo);
  const canUndo = useSchemaStore((s) => s.past.length > 0);
  const canRedo = useSchemaStore((s) => s.future.length > 0);
  const migrations = useSchemaStore((s) => s.migrations);
  const currentMigration = useSchemaStore((s) => s.currentMigration);
  const target = useSchemaStore((s) => s.target);
  const setTarget = useSchemaStore((s) => s.setTarget);
  const selectTable = useSchemaStore((s) => s.selectTable);
  const arrange = useSchemaStore((s) => s.arrange);
  const remember = useRecents((s) => s.remember);
  const recentCount = useRecents((s) => s.items.length);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);

  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"laravel" | "sql">("laravel");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(false);
  const [smellsOpen, setSmellsOpen] = useState(false);
  const [indexingOpen, setIndexingOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [newConfirmOpen, setNewConfirmOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(460);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;
    const onMove = (ev: MouseEvent) => {
      setLeftWidth(Math.min(760, Math.max(320, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const projectName = schema.name && schema.name.length > 0 ? schema.name : "Untitled";

  const issueCount = useMemo(
    () => validate(schema).filter((i) => i.severity === "error").length,
    [schema],
  );

  const health = useMemo(() => healthScore(detectSmells(schema)), [schema]);
  const healthColor = health >= 85 ? "#3ecf8e" : health >= 60 ? "#f6c453" : "#ff6b6b";

  const loadSample = () => {
    loadProject(sampleSchema, gridLayout(sampleSchema));
  };

  // Apply the selected theme to the document root.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);

  // Bridge live-control commands from the MCP server into this app, so external
  // MCP agents can drive the canvas/query/view in real time.
  useEffect(() => startAppBridge(), []);

  // Remember the current project (debounced) so it appears in Recent projects.
  useEffect(() => {
    if (schema.tables.length === 0) return;
    const id = setTimeout(() => {
      remember(projectName, schema, positions);
    }, 1500);
    return () => {
      clearTimeout(id);
    };
  }, [schema, positions, projectName, remember]);

  const handleSave = () => {
    downloadText(
      `${projectName}.schemaguard.json`,
      serializeProject(schema, positions, {
        migrations,
        migrationSnapshots,
        currentMigration,
        modelRelations,
        shownRelationModels,
        modelInfos,
      }),
      "application/json",
    );
  };

  const handleOpen = () => {
    void pickTextFile(".json,application/json").then((text) => {
      if (!text) return;
      try {
        const project = parseProject(text);
        loadFullProject(project);
      } catch (err) {
        alert(`Couldn't open project: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  };

  const handleExportSql = () => {
    downloadText(
      `${projectName}.${target}.sql`,
      emitDdl(schema, dialectFor(target), { ifNotExists: false }),
      "text/plain",
    );
  };

  const handleNew = () => {
    // A blank project, but only if there's something to clear.
    if (schema.tables.length === 0 && migrations.length === 0) {
      newProject();
      return;
    }
    setNewConfirmOpen(true);
  };

  // Open the import dialog, optionally pre-selecting the SQL or Laravel tab.
  const openImport = (m: "laravel" | "sql" = "laravel") => {
    setImportMode(m);
    setImportOpen(true);
  };

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (k === "s") {
        e.preventDefault();
        handleSave();
      } else if (k === "e") {
        e.preventDefault();
        handleExportSql();
      } else if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const commands = useMemo<Command[]>(
    () => [
      { id: "new", group: "File", label: "New project", run: handleNew },
      { id: "open", group: "File", label: "Open project…", run: handleOpen },
      {
        id: "recent",
        group: "File",
        label: "Open recent…",
        run: () => {
          setRecentsOpen(true);
        },
      },
      { id: "save", group: "File", label: "Save project", hint: "⌘S", run: handleSave },
      {
        id: "import",
        group: "File",
        label: "Import Laravel migrations…",
        run: () => {
          openImport("laravel");
        },
      },
      {
        id: "import-sql",
        group: "File",
        label: "Import SQL file…",
        run: () => {
          openImport("sql");
        },
      },
      {
        id: "export",
        group: "File",
        label: `Export SQL (${target})`,
        hint: "⌘E",
        run: handleExportSql,
      },
      {
        id: "catalog",
        group: "View",
        label: "Open catalog",
        run: () => {
          setCatalogOpen(true);
        },
      },
      {
        id: "health",
        group: "View",
        label: "Schema health & design smells",
        run: () => {
          setSmellsOpen(true);
        },
      },
      {
        id: "indexing",
        group: "View",
        label: "Indexing advisor — explain & fix indexes",
        run: () => {
          setIndexingOpen(true);
        },
      },
      {
        id: "settings",
        group: "View",
        label: "Open settings",
        run: () => {
          setSettingsOpen(true);
        },
      },
      {
        id: "mcp",
        group: "View",
        label: "MCP server — connect AI tools",
        run: () => {
          setMcpOpen(true);
        },
      },
      {
        id: "arrange",
        group: "Edit",
        label: "Auto-arrange diagram",
        run: () => {
          arrange(autoLayout(schema));
        },
      },
      {
        id: "theme",
        group: "View",
        label: "Toggle light / dark theme",
        run: () => {
          const cur = useSettings.getState().theme;
          useSettings.getState().setTheme(cur === "dark" ? "light" : "dark");
        },
      },
      { id: "sample", group: "Edit", label: "Load sample schema", run: loadSample },
      { id: "add", group: "Edit", label: "Add table", run: addTable },
      { id: "undo", group: "Edit", label: "Undo", hint: "⌘Z", run: undo },
      { id: "redo", group: "Edit", label: "Redo", hint: "⌘⇧Z", run: redo },
      {
        id: "d-sqlite",
        group: "Dialect",
        label: "Target: SQLite",
        run: () => {
          setTarget("sqlite");
        },
      },
      {
        id: "d-mysql",
        group: "Dialect",
        label: "Target: MySQL",
        run: () => {
          setTarget("mysql");
        },
      },
      {
        id: "d-postgres",
        group: "Dialect",
        label: "Target: PostgreSQL",
        run: () => {
          setTarget("postgres");
        },
      },
      ...schema.tables.map((t) => ({
        id: `go-${t.name}`,
        group: "Go to table",
        label: t.name,
        run: () => {
          selectTable(t.name);
        },
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schema, target],
  );

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {/* top bar */}
      <header className="lit flex h-12 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-2">
          <div
            className="lit grid h-[22px] w-[22px] animate-shimmer place-items-center rounded-md shadow-glow-soft"
            style={{ background: GRADIENT, backgroundSize: "200% 200%" }}
          >
            <Shield size={13} strokeWidth={2.5} color="#ffffff" />
          </div>
          <span className="text-gradient text-[13px] font-bold tracking-tight">SchemaGuard</span>
        </div>

        <span className="h-5 w-px bg-line" />

        {/* mode switch: schema designer vs. live database client */}
        <div className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
          <ModeTab
            label="Designer"
            icon={<PanelsTopLeft size={13} />}
            active={mode === "designer"}
            onClick={() => {
              setMode("designer");
            }}
          />
          <ModeTab
            label="Dataflow"
            icon={<Share2 size={13} />}
            active={mode === "dataflow"}
            onClick={() => {
              setMode("dataflow");
            }}
          />
          <ModeTab
            label="Database"
            icon={<Database size={13} />}
            active={mode === "database"}
            onClick={() => {
              setMode("database");
            }}
          />
        </div>

        {mode === "designer" && (
          <>
            <div className="flex items-center gap-1">
              <BarButton label="New" onClick={handleNew} />
              <BarButton label="Open" onClick={handleOpen} />
              <BarButton label="Save" onClick={handleSave} />
              <BarButton
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <FileInput size={14} />
                    Import
                  </span>
                }
                title="Import a schema from Laravel migrations or a SQL file"
                onClick={() => {
                  openImport("laravel");
                }}
              />
            </div>
            <div className="flex items-center gap-1">
              <BarButton
                label={<Undo2 size={15} />}
                title="Undo"
                disabled={!canUndo}
                onClick={undo}
              />
              <BarButton
                label={<Redo2 size={15} />}
                title="Redo"
                disabled={!canRedo}
                onClick={redo}
              />
            </div>
            <div className="flex items-center gap-1">
              <BarButton
                label="Catalog"
                onClick={() => {
                  setCatalogOpen(true);
                }}
              />
              {schema.tables.length > 0 && (
                <button
                  type="button"
                  title="Schema health — design smells & one-click fixes"
                  onClick={() => {
                    setSmellsOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12px] hover:border-line2"
                >
                  <Sparkles size={13} style={{ color: healthColor }} />
                  <span className="font-semibold" style={{ color: healthColor }}>
                    {health}
                  </span>
                </button>
              )}
              {schema.tables.length > 0 && (
                <BarButton
                  label={<ListTree size={15} />}
                  title="Indexing advisor — explain & fix indexes"
                  onClick={() => {
                    setIndexingOpen(true);
                  }}
                />
              )}
              {issueCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCatalogOpen(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-crit/40 bg-crit/10 px-2.5 py-1.5 text-[12px] font-semibold text-crit"
                >
                  <AlertTriangle size={13} />
                  {issueCount}
                </button>
              )}
            </div>
          </>
        )}

        {/* centered project title — doubles as the command-palette trigger */}
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setPaletteOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-3 py-1 text-[12.5px] text-dim hover:border-line2"
          >
            <Database size={13} />
            <span className="font-semibold text-ink">{projectName}</span>
            <span className="ml-2 rounded bg-panel3 px-1.5 py-0.5 font-mono text-[10px] text-faint">
              ⌘K
            </span>
          </button>
        </div>

        {mode === "designer" && (
          <>
            <button
              type="button"
              onClick={addTable}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
            >
              <Plus size={14} />
              Table
            </button>
            <button
              type="button"
              onClick={handleExportSql}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow transition-transform hover:-translate-y-px active:translate-y-0"
              style={{ background: GRADIENT }}
            >
              <Download size={14} />
              Export SQL
            </button>
          </>
        )}
        <BarButton
          label={theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          title="Toggle light / dark theme"
          onClick={() => {
            setTheme(theme === "dark" ? "light" : "dark");
          }}
        />
        <BarButton
          label={<Plug size={15} />}
          title="MCP server — connect AI tools"
          onClick={() => {
            setMcpOpen(true);
          }}
        />
        <BarButton
          label={<Settings size={15} />}
          title="Settings"
          onClick={() => {
            setSettingsOpen(true);
          }}
        />
      </header>

      {/* body: schema designer (two panes), the dataflow graph, or the live database client */}
      {mode === "designer" && (
        <div className="flex min-h-0 flex-1">
          <div className="flex-none border-r border-line" style={{ width: leftWidth }}>
            <LeftPane />
          </div>
          <div
            onMouseDown={startResize}
            className="w-1 flex-none cursor-col-resize bg-transparent hover:bg-acc/40"
          />
          <div className="relative min-w-0 flex-1">
            <Canvas />

            {migrations.length > 0 && currentMigration >= 0 && (
              <div className="glass absolute left-3 top-3 z-10 flex animate-slideup items-center gap-2 rounded-lg border border-line/70 px-3 py-1.5 text-[11.5px] shadow-lg">
                <span className="text-faint">Viewing migration</span>
                <span className="font-semibold">
                  {currentMigration + 1} / {migrations.length}
                </span>
                <span className="text-dim">· {migrations[currentMigration]?.title}</span>
              </div>
            )}

            {schema.tables.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="glass pointer-events-auto flex animate-pop flex-col items-center gap-3 rounded-2xl border border-line/70 px-8 py-7 text-center shadow-2xl">
                  <div className="text-[14px] font-semibold">No tables yet</div>
                  <div className="max-w-[260px] text-[12px] text-dim">
                    Import Laravel migrations or a SQL file, load the sample, or add a table to
                    start designing.
                  </div>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        openImport("laravel");
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white shadow-glow"
                      style={{ background: GRADIENT }}
                    >
                      <FileInput size={14} />
                      Import
                    </button>
                    {recentCount > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setRecentsOpen(true);
                        }}
                        className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
                      >
                        Recent
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Load sample"
                      onClick={loadSample}
                      className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
                    >
                      Load sample
                    </button>
                    <button
                      type="button"
                      onClick={addTable}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
                    >
                      <Plus size={14} />
                      Table
                    </button>
                  </div>
                </div>
              </div>
            )}

            {selectedTable !== null && (
              <div className="glass absolute bottom-3 right-3 top-3 w-[320px] animate-slideright overflow-hidden rounded-xl border border-line/70 shadow-2xl">
                <Inspector />
              </div>
            )}
          </div>
        </div>
      )}
      {mode === "dataflow" && <DataflowView />}
      {mode === "database" && (
        <DatabasePanel
          onImported={() => {
            setMode("designer");
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          initialMode={importMode}
          onClose={() => {
            setImportOpen(false);
          }}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          onClose={() => {
            setPaletteOpen(false);
          }}
        />
      )}

      {catalogOpen && (
        <CatalogDialog
          onClose={() => {
            setCatalogOpen(false);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}

      {recentsOpen && (
        <RecentsDialog
          onClose={() => {
            setRecentsOpen(false);
          }}
          onPick={(s, p) => {
            loadProject(s, p);
          }}
        />
      )}

      {smellsOpen && (
        <SmellsDialog
          onClose={() => {
            setSmellsOpen(false);
          }}
        />
      )}

      {indexingOpen && (
        <IndexingDialog
          onClose={() => {
            setIndexingOpen(false);
          }}
        />
      )}

      {mcpOpen && (
        <McpDialog
          onClose={() => {
            setMcpOpen(false);
          }}
        />
      )}

      {newConfirmOpen && (
        <div
          className="fixed inset-0 z-50 grid animate-fade place-items-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={() => {
            setNewConfirmOpen(false);
          }}
        >
          <div
            className="glass-strong w-[400px] max-w-full animate-pop rounded-xl border border-line/70 p-5 shadow-2xl"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="text-[14px] font-bold">Start a new project?</div>
            <p className="mt-1.5 text-[12.5px] text-dim">
              This clears the current diagram, migrations and models. Your current project stays in
              Recent projects, and you can undo with ⌘Z.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNewConfirmOpen(false);
                }}
                className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-[12.5px] hover:border-line2"
              >
                Cancel
              </button>
              <button
                type="button"
                aria-label="Start new"
                onClick={() => {
                  newProject();
                  setNewConfirmOpen(false);
                }}
                className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white"
                style={{ background: GRADIENT }}
              >
                Start new
              </button>
            </div>
          </div>
        </div>
      )}

      {/* floating AI assistant — available in every mode, sees the open scene */}
      <Assistant />

      {/* live query the assistant authored, floating beside the assistant */}
      <QueryPanel />

      <Toaster />
    </div>
  );
}

function ModeTab({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${
        active ? "bg-panel3 text-ink" : "text-dim hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

interface BarButtonProps {
  label: React.ReactNode;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
}

function BarButton({ label, title, disabled, onClick }: BarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title ?? (typeof label === "string" ? label : undefined)}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-[12.5px] hover:border-line2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}
