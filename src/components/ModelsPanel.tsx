import type { ModelRelation } from "@schemaguard/core";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useMemo } from "react";

import { RELATION_STYLE } from "../lib/relationStyle";
import { useSchemaStore } from "../stores/schema";

interface ModelGroup {
  model: string;
  table: string;
  relations: ModelRelation[];
}

/**
 * Browse the Eloquent models found in the imported project. Toggle a model to
 * overlay its relationships (belongsTo / hasMany / belongsToMany / morph…) on
 * the diagram, color-coded by category.
 */
export function ModelsPanel() {
  const relations = useSchemaStore((s) => s.modelRelations);
  const shown = useSchemaStore((s) => s.shownRelationModels);
  const toggle = useSchemaStore((s) => s.toggleRelationModel);
  const setShown = useSchemaStore((s) => s.setShownRelationModels);

  const groups = useMemo<ModelGroup[]>(() => {
    const byModel = new Map<string, ModelGroup>();
    for (const r of relations) {
      let g = byModel.get(r.model);
      if (!g) {
        g = { model: r.model, table: r.table, relations: [] };
        byModel.set(r.model, g);
      }
      g.relations.push(r);
    }
    return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
  }, [relations]);

  const shownSet = useMemo(() => new Set(shown), [shown]);
  const allModels = useMemo(() => groups.map((g) => g.model), [groups]);
  const allShown = groups.length > 0 && shown.length === groups.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-faint">
          Models · {groups.length}
        </span>
        <button
          type="button"
          onClick={() => {
            setShown(allShown ? [] : allModels);
          }}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-panel2 px-2 py-1 text-[11px] hover:border-line2"
        >
          {allShown ? <EyeOff size={12} /> : <Eye size={12} />}
          {allShown ? "Hide all" : "Show all"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {groups.map((g) => {
          const isShown = shownSet.has(g.model);
          return (
            <div
              key={g.model}
              className={`mb-1.5 rounded-lg border ${
                isShown ? "border-acc/60 bg-acc/5" : "border-line bg-panel2"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  toggle(g.model);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                {isShown ? (
                  <Eye size={14} className="flex-none text-acc" />
                ) : (
                  <EyeOff size={14} className="flex-none text-faint" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold">{g.model}</span>
                  <span className="block font-mono text-[10px] text-faint">{g.table}</span>
                </span>
                <span className="flex-none text-[10px] text-faint">
                  {g.relations.length} rel{g.relations.length === 1 ? "" : "s"}
                </span>
              </button>

              <div className="flex flex-col gap-1 border-t border-line/50 px-3 py-2">
                {g.relations.map((r, i) => {
                  const style = RELATION_STYLE[r.category];
                  return (
                    <div key={i} className="flex items-center gap-2 text-[11.5px]">
                      <span
                        className="flex-none rounded px-1.5 py-0.5 text-[9.5px] font-bold"
                        style={{ background: `${style.color}22`, color: style.color }}
                        title={`${r.kind} · ${style.label}`}
                      >
                        {r.kind}
                      </span>
                      <span className="font-medium">{r.method}</span>
                      <ArrowRight size={11} className="flex-none text-faint" />
                      <span className="truncate font-mono text-[10.5px] text-dim">
                        {r.relatedTable ?? "(polymorphic)"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
