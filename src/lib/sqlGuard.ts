/**
 * SQL "guard" pre-flight for the live Database client.
 *
 * The Query tab runs whatever SQL you type straight against a live connection,
 * with no confirmation. This scanner reads the statements *before* they run and
 * flags the destructive/locking shapes — dropping tables, truncating, deleting
 * or updating every row, dropping columns — so the panel can ask for an explicit
 * confirm. Anything it doesn't recognise (SELECT, scoped writes, safe DDL) is
 * left alone, so normal use has zero friction.
 *
 * It reuses the streamed-import statement splitter so multi-statement scripts
 * are analysed one statement at a time, with comments and string literals
 * already handled. It is deliberately conservative: it matches the well-known
 * dangerous shapes and stays quiet otherwise.
 */
import { extractStatements, flushStatements } from "./sqlSplit";

/** Aligns with the diff's severities so the UI can reuse the same colours. */
export type GuardSeverity = "caution" | "destructive";

export interface DestructiveFinding {
  /** The offending statement, trimmed (and truncated for display). */
  statement: string;
  severity: GuardSeverity;
  reason: string;
}

/** Split a (possibly multi-statement) script into individual statements. */
function statementsOf(sql: string): string[] {
  const { statements, rest } = extractStatements(sql);
  return [...statements, ...flushStatements(rest)];
}

function shorten(stmt: string): string {
  const oneLine = stmt.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
}

/** Classify a single statement; null when it isn't a recognised danger. */
function findingFor(stmt: string): Omit<DestructiveFinding, "statement"> | null {
  const s = stmt.trim();

  if (/^\s*drop\s+(database|schema)\b/i.test(s))
    return { severity: "destructive", reason: "Drops a database/schema and everything in it." };

  if (/^\s*drop\s+(temporary\s+|temp\s+)?table\b/i.test(s))
    return { severity: "destructive", reason: "Drops a table — all of its data is lost." };

  if (/^\s*drop\s+(materialized\s+)?view\b/i.test(s))
    return { severity: "caution", reason: "Drops a view." };

  if (/^\s*truncate\b/i.test(s))
    return { severity: "destructive", reason: "Truncates a table — removes every row." };

  // DELETE / UPDATE with no WHERE hits every row in the table.
  if (/^\s*delete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s))
    return { severity: "destructive", reason: "DELETE with no WHERE — removes every row." };

  if (/^\s*update\b/i.test(s) && !/\bwhere\b/i.test(s))
    return { severity: "destructive", reason: "UPDATE with no WHERE — overwrites every row." };

  // ALTER TABLE … DROP …  (column / constraint / foreign key / index).
  if (/^\s*alter\s+table\b/i.test(s) && /\bdrop\b/i.test(s)) {
    // A named constraint/index/key drop is recoverable; a column drop loses data.
    const constraintDrop = /\bdrop\s+(constraint|foreign\s+key|primary\s+key|index|key|check)\b/i.test(s);
    if (constraintDrop)
      return {
        severity: "caution",
        reason: "Drops a constraint/index via ALTER — integrity or query speed may change.",
      };
    return { severity: "destructive", reason: "Drops a column via ALTER — its data is lost." };
  }

  if (/^\s*drop\s+index\b/i.test(s))
    return { severity: "caution", reason: "Drops an index — queries relying on it may slow down." };

  return null;
}

/**
 * Scan SQL for destructive/locking operations. Returns one finding per flagged
 * statement (in order); an empty array means nothing dangerous was recognised.
 */
export function scanDestructive(sql: string): DestructiveFinding[] {
  const findings: DestructiveFinding[] = [];
  for (const stmt of statementsOf(sql)) {
    const f = findingFor(stmt);
    if (f) findings.push({ statement: shorten(stmt), ...f });
  }
  return findings;
}

/** The worst severity in a set of findings (for the guard's overall tone). */
export function worstSeverity(findings: DestructiveFinding[]): GuardSeverity {
  return findings.some((f) => f.severity === "destructive") ? "destructive" : "caution";
}
