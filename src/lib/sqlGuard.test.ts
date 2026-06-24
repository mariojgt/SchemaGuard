import { describe, expect, it } from "vitest";

import { scanDestructive, worstSeverity } from "./sqlGuard";

describe("scanDestructive", () => {
  it("ignores read-only and scoped statements (no friction for normal use)", () => {
    expect(scanDestructive("SELECT * FROM users;")).toEqual([]);
    expect(scanDestructive("INSERT INTO users (name) VALUES ('a');")).toEqual([]);
    expect(scanDestructive("DELETE FROM users WHERE id = 1;")).toEqual([]);
    expect(scanDestructive("UPDATE users SET name = 'a' WHERE id = 1;")).toEqual([]);
    expect(scanDestructive("CREATE TABLE t (id int);")).toEqual([]);
    expect(scanDestructive("ALTER TABLE t ADD COLUMN age int;")).toEqual([]);
  });

  it("flags dropping a table as destructive", () => {
    const f = scanDestructive("DROP TABLE users;");
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe("destructive");
  });

  it("flags DROP DATABASE / SCHEMA and TRUNCATE", () => {
    expect(scanDestructive("DROP DATABASE app;")[0]?.severity).toBe("destructive");
    expect(scanDestructive("DROP SCHEMA public CASCADE;")[0]?.severity).toBe("destructive");
    expect(scanDestructive("TRUNCATE TABLE logs;")[0]?.severity).toBe("destructive");
  });

  it("flags DELETE / UPDATE with no WHERE, but not when scoped", () => {
    expect(scanDestructive("DELETE FROM orders;")[0]?.reason).toMatch(/no WHERE/);
    expect(scanDestructive("UPDATE orders SET paid = 1;")[0]?.reason).toMatch(/no WHERE/);
    // A WHERE mentioned only inside a column list shouldn't be confused — these
    // have a real WHERE clause, so they're safe.
    expect(scanDestructive("DELETE FROM orders WHERE id < 10;")).toEqual([]);
  });

  it("treats ALTER … DROP COLUMN as destructive but a named constraint drop as caution", () => {
    expect(scanDestructive("ALTER TABLE users DROP COLUMN email;")[0]?.severity).toBe(
      "destructive",
    );
    expect(scanDestructive("ALTER TABLE users DROP CONSTRAINT users_email_fk;")[0]?.severity).toBe(
      "caution",
    );
    expect(scanDestructive("DROP INDEX idx_users_email;")[0]?.severity).toBe("caution");
  });

  it("scans every statement in a multi-statement script", () => {
    const findings = scanDestructive(
      "SELECT 1; DROP TABLE a; UPDATE b SET x = 1; INSERT INTO c VALUES (1);",
    );
    expect(findings).toHaveLength(2);
    expect(worstSeverity(findings)).toBe("destructive");
  });

  it("is not fooled by a DROP TABLE mentioned inside a string literal", () => {
    expect(scanDestructive("INSERT INTO logs (msg) VALUES ('DROP TABLE users');")).toEqual([]);
  });
});
