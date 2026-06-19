import type { ReactNode } from "react";

const KEYWORDS = new Set([
  "CREATE",
  "TABLE",
  "AS",
  "SELECT",
  "FROM",
  "JOIN",
  "LEFT",
  "RIGHT",
  "INNER",
  "OUTER",
  "ON",
  "GROUP",
  "BY",
  "ORDER",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "UNIQUE",
  "INDEX",
  "ALTER",
  "ADD",
  "CONSTRAINT",
  "DELETE",
  "UPDATE",
  "CASCADE",
  "RESTRICT",
  "DEFAULT",
  "DISTINCT",
  "IF",
  "EXISTS",
  "INTO",
  "VALUES",
  "SET",
  "TRUE",
  "FALSE",
  "ACTION",
  "NO",
]);
const TYPES = new Set([
  "BIGSERIAL",
  "SMALLSERIAL",
  "SERIAL",
  "BIGINT",
  "INTEGER",
  "SMALLINT",
  "INT",
  "BOOLEAN",
  "NUMERIC",
  "DECIMAL",
  "REAL",
  "DOUBLE",
  "PRECISION",
  "VARCHAR",
  "TEXT",
  "UUID",
  "JSONB",
  "JSON",
  "DATE",
  "TIME",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "BYTEA",
  "CHAR",
]);

const TOKEN =
  /(--[^\n]*)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|([(),;.*])/g;

/** Lightweight SQL highlighter → React spans. No external dependency. */
export function highlightSql(line: string): ReactNode {
  if (line.length === 0) return " ";
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(line)) !== null) {
    if (m.index > last) out.push(line.slice(last, m.index));
    last = TOKEN.lastIndex;
    const tok = m[0];
    if (m[1])
      out.push(
        <span key={key++} className="italic text-faint">
          {tok}
        </span>,
      );
    else if (m[2] ?? m[3])
      out.push(
        <span key={key++} className="text-med">
          {tok}
        </span>,
      );
    else if (m[4])
      out.push(
        <span key={key++} className="text-low">
          {tok}
        </span>,
      );
    else if (m[5]) {
      const up = tok.toUpperCase();
      if (KEYWORDS.has(up))
        out.push(
          <span key={key++} className="font-medium text-acc">
            {tok}
          </span>,
        );
      else if (TYPES.has(up))
        out.push(
          <span key={key++} className="text-low">
            {tok}
          </span>,
        );
      else out.push(<span key={key++}>{tok}</span>);
    } else
      out.push(
        <span key={key++} className="text-dim">
          {tok}
        </span>,
      );
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}
