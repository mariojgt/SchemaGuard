import { emitDdl, postgres } from "@schemaguard/core";
import { useMemo } from "react";

import { useSchemaStore } from "../stores/schema";

export function SqlPreview() {
  const schema = useSchemaStore((s) => s.schema);

  // Slice: only the Postgres emitter exists. MySQL/SQLite dialects are next.
  const sql = useMemo(() => emitDdl(schema, postgres, { ifNotExists: false }), [schema]);

  return (
    <pre className="h-full overflow-auto whitespace-pre p-3 font-mono text-[11.5px] leading-relaxed text-ink">
      {sql}
    </pre>
  );
}
