import { useEffect, useState } from "react";

import { useSchemaStore } from "../stores/schema";
import { CopilotPanel } from "./CopilotPanel";
import { MigrationTimeline } from "./MigrationTimeline";
import { ModelsPanel } from "./ModelsPanel";
import { SqlEditorPane } from "./SqlEditorPane";

type Tab = "sql" | "migrations" | "models" | "copilot";

export function LeftPane() {
  const migrationCount = useSchemaStore((s) => s.migrations.length);
  const modelCount = useSchemaStore((s) => new Set(s.modelRelations.map((r) => r.model)).size);
  const hasHistory = migrationCount > 0;
  const hasModels = modelCount > 0;
  const [tab, setTab] = useState<Tab>("sql");

  // Jump to the timeline automatically when migrations are imported.
  useEffect(() => {
    if (hasHistory) setTab("migrations");
  }, [hasHistory]);

  const active: Tab =
    (tab === "migrations" && !hasHistory) || (tab === "models" && !hasModels) ? "sql" : tab;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 flex-none items-center gap-1 border-b border-line px-2">
        <TabButton label="SQL" active={active === "sql"} onClick={() => setTab("sql")} />
        <TabButton
          label="Copilot"
          active={active === "copilot"}
          onClick={() => setTab("copilot")}
        />
        <TabButton
          label={hasHistory ? `Migrations · ${String(migrationCount)}` : "Migrations"}
          active={active === "migrations"}
          disabled={!hasHistory}
          onClick={() => setTab("migrations")}
        />
        <TabButton
          label={hasModels ? `Models · ${String(modelCount)}` : "Models"}
          active={active === "models"}
          disabled={!hasModels}
          onClick={() => setTab("models")}
        />
      </div>
      <div className="min-h-0 flex-1">
        {active === "sql" && <SqlEditorPane />}
        {active === "copilot" && <CopilotPanel />}
        {active === "migrations" && <MigrationTimeline />}
        {active === "models" && <ModelsPanel />}
      </div>
    </div>
  );
}

interface TabButtonProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function TabButton({ label, active, disabled, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[12px] ${
        active ? "bg-panel3 text-ink" : "text-dim hover:text-ink"
      } disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {label}
    </button>
  );
}
