/**
 * Incremental SQL statement splitter for streamed imports.
 *
 * `extractStatements` is fed a growing buffer of SQL text (one file chunk at a
 * time). It returns every *complete* statement it can find — comments stripped,
 * quotes/escapes respected — and the trailing `rest` that may be an incomplete
 * statement (or sit inside an unterminated string/comment). The caller appends
 * the next chunk to `rest` and calls again, so a file of any size is split
 * without ever holding it all in memory.
 *
 * Mirrors the SQL splitter in @schemaguard/core so behaviour is consistent.
 */
export interface ExtractResult {
  statements: string[];
  /** Raw, unconsumed text after the last complete statement (a `;` boundary). */
  rest: string;
}

export function extractStatements(buf: string): ExtractResult {
  const statements: string[] = [];
  let cur = ""; // current statement, comments stripped
  let quote: string | null = null;
  let depth = 0;
  let i = 0;
  let consumed = 0; // raw index just after the last completed statement's ';'
  const n = buf.length;

  while (i < n) {
    const ch = buf[i] as string;
    const next = i + 1 < n ? (buf[i + 1] as string) : "";

    if (quote) {
      // Inside a quoted literal: copy verbatim, honour backslash escapes.
      if (ch === "\\" && quote !== "`" && i + 1 < n) {
        cur += ch + buf[i + 1];
        i += 2;
        continue;
      }
      cur += ch;
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if ((ch === "-" && next === "-") || ch === "#") {
      // Line comment — needs a newline to terminate. If the buffer doesn't have
      // one yet, stop and keep the rest raw for the next chunk.
      const nl = buf.indexOf("\n", i);
      if (nl === -1) break;
      cur += "\n";
      i = nl + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = buf.indexOf("*/", i + 2);
      if (end === -1) break; // unterminated block comment — wait for more
      if (buf[i + 2] === "!") {
        // MySQL conditional comment (e.g. /*!40014 SET FOREIGN_KEY_CHECKS=0 */)
        // is executable SQL, not a comment — keep it verbatim so things like
        // disabling FK checks during a dump actually take effect.
        cur += buf.slice(i, end + 2);
      } else {
        cur += " ";
      }
      i = end + 2;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      const s = cur.trim();
      if (s.length > 0) statements.push(s);
      cur = "";
      i++;
      consumed = i;
      continue;
    }
    cur += ch;
    i++;
  }

  return { statements, rest: buf.slice(consumed) };
}

/**
 * Flush whatever is left after the last chunk. A well-formed dump ends with a
 * `;`, so this is usually empty/whitespace/comments, but it also recovers a
 * final statement that has no trailing semicolon.
 */
export function flushStatements(rest: string): string[] {
  if (rest.trim().length === 0) return [];
  // Append a terminator so a trailing statement without `;` is emitted.
  return extractStatements(`${rest}\n;`).statements;
}
