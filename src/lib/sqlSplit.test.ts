import { describe, expect, it } from "vitest";

import { extractStatements, flushStatements } from "./sqlSplit";

describe("extractStatements", () => {
  it("splits complete statements and strips comments", () => {
    const { statements, rest } = extractStatements(
      "-- header\nCREATE TABLE t (id int); /* c */ INSERT INTO t VALUES (1);\n",
    );
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TABLE t");
    expect(statements[1]).toContain("INSERT INTO t VALUES (1)");
    expect(rest.trim()).toBe("");
  });

  it("keeps a `;` inside a string literal as part of the statement", () => {
    const { statements } = extractStatements("INSERT INTO t VALUES ('a;b'), ('c');\n");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("'a;b'");
  });

  it("returns an incomplete trailing statement as rest", () => {
    const { statements, rest } = extractStatements("INSERT INTO t VALUES (1); INSERT INTO t VAL");
    expect(statements).toHaveLength(1);
    expect(rest).toBe(" INSERT INTO t VAL");
  });

  it("holds back text inside an unterminated string until more arrives", () => {
    // The string opened by the second INSERT isn't closed in this chunk.
    const first = extractStatements("INSERT INTO t VALUES (1); INSERT INTO t VALUES ('un");
    expect(first.statements).toHaveLength(1);
    expect(first.rest).toContain("'un");
    // Append the rest of the file; now the second statement completes.
    const second = extractStatements(`${first.rest}terminated; more');\nSELECT 1;`);
    expect(second.statements).toHaveLength(2);
    expect(second.statements[0]).toContain("'unterminated; more'");
    expect(second.statements[1]).toContain("SELECT 1");
  });

  it("reassembles a statement split across two chunks", () => {
    const a = extractStatements("CREATE TABLE t (\n  id int,\n  name var");
    expect(a.statements).toHaveLength(0);
    const b = extractStatements(`${a.rest}char(255)\n);\nSELECT 2;`);
    expect(b.statements).toHaveLength(2);
    expect(b.statements[0]).toContain("name varchar(255)");
  });

  it("strips ordinary comments but preserves MySQL conditional comments", () => {
    const { statements } = extractStatements(
      "/* plain comment */\n" +
        "/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\n" +
        "CREATE TABLE t (id int);\n",
    );
    // The plain comment is dropped (not its own statement); the /*! ... */
    // directive survives so FK checks actually get disabled.
    expect(statements).toEqual([
      "/*!40014 SET FOREIGN_KEY_CHECKS=0 */",
      "CREATE TABLE t (id int)",
    ]);
  });

  it("keeps an inline conditional comment as part of its statement", () => {
    const { statements } = extractStatements(
      "CREATE TABLE t (id int) /*!50100 TABLESPACE ts */;\n",
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("/*!50100 TABLESPACE ts */");
  });

  it("flushes a trailing statement that lacks a semicolon", () => {
    expect(flushStatements("SELECT 42")).toEqual(["SELECT 42"]);
    expect(flushStatements("  \n-- only a comment\n")).toEqual([]);
  });
});
