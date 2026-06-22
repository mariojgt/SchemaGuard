import type { MigrationEntry, ModelInfo, ModelRelation, Schema } from "@schemaguard/core";

import type { Positions } from "../stores/schema";

export interface ProjectFile {
  version: 1;
  schema: Schema;
  positions: Positions;
  /** Migration timeline, when the project was built from a migrations folder. */
  migrations?: MigrationEntry[];
  migrationSnapshots?: Schema[];
  currentMigration?: number;
  /** Eloquent relationships + which models are overlaid on the diagram. */
  modelRelations?: ModelRelation[];
  shownRelationModels?: string[];
  /** Per-model metadata for the insights panel. */
  modelInfos?: ModelInfo[];
}

export function serializeProject(
  schema: Schema,
  positions: Positions,
  extra?: {
    migrations: MigrationEntry[];
    migrationSnapshots: Schema[];
    currentMigration: number;
    modelRelations: ModelRelation[];
    shownRelationModels: string[];
    modelInfos: ModelInfo[];
  },
): string {
  const history =
    extra && extra.migrations.length > 0
      ? {
          migrations: extra.migrations,
          migrationSnapshots: extra.migrationSnapshots,
          currentMigration: extra.currentMigration,
        }
      : {};
  const relations =
    extra && extra.modelRelations.length > 0
      ? {
          modelRelations: extra.modelRelations,
          shownRelationModels: extra.shownRelationModels,
          modelInfos: extra.modelInfos,
        }
      : {};
  const file: ProjectFile = { version: 1, schema, positions, ...history, ...relations };
  return JSON.stringify(file, null, 2);
}

export function parseProject(text: string): ProjectFile {
  const data = JSON.parse(text) as Partial<ProjectFile>;
  if (!data || typeof data !== "object" || !data.schema || !Array.isArray(data.schema.tables)) {
    throw new Error("Not a valid SchemaGuard project file");
  }
  return {
    version: 1,
    schema: data.schema,
    positions: data.positions ?? {},
    ...(Array.isArray(data.migrations) ? { migrations: data.migrations } : {}),
    ...(Array.isArray(data.migrationSnapshots)
      ? { migrationSnapshots: data.migrationSnapshots }
      : {}),
    ...(typeof data.currentMigration === "number"
      ? { currentMigration: data.currentMigration }
      : {}),
    ...(Array.isArray(data.modelRelations) ? { modelRelations: data.modelRelations } : {}),
    ...(Array.isArray(data.shownRelationModels)
      ? { shownRelationModels: data.shownRelationModels }
      : {}),
    ...(Array.isArray(data.modelInfos) ? { modelInfos: data.modelInfos } : {}),
  };
}

/** Trigger a browser download of text content (works in dev + Tauri webview). */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a whole-folder picker and resolve files (filtered by extension) with
 * their names. `onProgress(done, total)` fires as each file is read — `total`
 * is 0 until the user has chosen a folder.
 */
export function pickFolderFiles(
  ext: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ name: string; content: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;

    // Resolve at most once. Cancelling the OS dialog fires no `change` event,
    // so without this the caller's promise (and its progress bar) hangs forever.
    let settled = false;
    const finish = (files: { name: string; content: string }[]): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onRefocus);
      resolve(files);
    };

    // Fallback cancel detection: focus returns to the window but no files were
    // chosen (and `change` therefore won't fire).
    const onRefocus = (): void => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 400);
    };

    input.oncancel = () => {
      finish([]);
    };
    input.onchange = () => {
      const files = Array.from(input.files ?? []).filter((f) => f.name.endsWith(ext));
      if (files.length === 0) {
        finish([]);
        return;
      }
      let done = 0;
      onProgress?.(0, files.length);
      void Promise.all(
        files.map(async (f) => {
          const content = await f.text();
          done++;
          onProgress?.(done, files.length);
          return { name: f.name, content };
        }),
      )
        .then(finish)
        .catch(() => {
          finish([]);
        });
    };

    window.addEventListener("focus", onRefocus, { once: true });
    input.click();
  });
}

/** Open a multi-select file picker and resolve each chosen file's text. */
export function pickTextFiles(accept: string): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;

    // Resolve at most once. Cancelling the OS dialog fires no `change` event, so
    // without this a caller showing a "reading…" spinner would hang forever.
    let settled = false;
    const finish = (texts: string[]): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onRefocus);
      resolve(texts);
    };
    const onRefocus = (): void => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) finish([]);
      }, 400);
    };

    input.oncancel = () => {
      finish([]);
    };
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        finish([]);
        return;
      }
      void Promise.all(files.map((f) => f.text()))
        .then(finish)
        .catch(() => {
          finish([]);
        });
    };

    window.addEventListener("focus", onRefocus, { once: true });
    input.click();
  });
}

/** Open a native file picker and resolve the chosen file's text (null if cancelled). */
export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
