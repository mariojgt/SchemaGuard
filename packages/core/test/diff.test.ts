import { describe, expect, it } from "vitest";

import type { Column, Schema, Table } from "../src/index";
import { diffSchemas, typeLabel } from "../src/index";

function table(name: string, columns: Column[]): Table {
  return { name, columns, indexes: [], foreignKeys: [] };
}

function schema(tables: Table[]): Schema {
  return { tables };
}

const idCol: Column = { name: "id", type: { kind: "serial", size: "big" }, nullable: false };
const emailCol: Column = { name: "email", type: { kind: "string", length: 255 }, nullable: false };
const users = table("users", [idCol, emailCol]);

describe("typeLabel", () => {
  it("renders parameterized types stably", () => {
    expect(typeLabel({ kind: "string", length: 255 })).toBe("string(255)");
    expect(typeLabel({ kind: "int", size: "big" })).toBe("int(big)");
    expect(typeLabel({ kind: "decimal", precision: 10, scale: 2 })).toBe("decimal(10,2)");
    expect(typeLabel({ kind: "boolean" })).toBe("boolean");
  });
});

describe("diffSchemas", () => {
  it("reports no changes for identical schemas", () => {
    const d = diffSchemas(schema([users]), schema([users]));
    expect(d.identical).toBe(true);
    expect(d.tables).toHaveLength(0);
  });

  it("treats a new table as a safe addition", () => {
    const d = diffSchemas(schema([]), schema([users]));
    expect(d.summary.tablesAdded).toBe(1);
    expect(d.tables.find((t) => t.name === "users")?.status).toBe("added");
    expect(d.tables.find((t) => t.name === "users")?.severity).toBe("safe");
    expect(d.summary.destructive).toBe(0);
  });

  it("flags a dropped table as destructive", () => {
    const d = diffSchemas(schema([users]), schema([]));
    expect(d.summary.tablesRemoved).toBe(1);
    expect(d.tables.find((t) => t.name === "users")?.severity).toBe("destructive");
    expect(d.summary.destructive).toBe(1);
  });

  it("treats a dropped column as destructive", () => {
    const after = table("users", [idCol]); // drop email
    const d = diffSchemas(schema([users]), schema([after]));
    const col = d.tables.find((t) => t.name === "users")?.columns.find((c) => c.name === "email");
    expect(col?.status).toBe("removed");
    expect(col?.severity).toBe("destructive");
  });

  it("treats a nullable new column as safe but NOT NULL without default as caution", () => {
    const nullableAdd = table("users", [
      ...users.columns,
      { name: "nickname", type: { kind: "string", length: 50 }, nullable: true },
    ]);
    const notNullAdd = table("users", [
      ...users.columns,
      { name: "nickname", type: { kind: "string", length: 50 }, nullable: false },
    ]);
    const safe = diffSchemas(schema([users]), schema([nullableAdd]));
    const caution = diffSchemas(schema([users]), schema([notNullAdd]));
    expect(safe.tables.find((t) => t.name === "users")?.columns.find((c) => c.name === "nickname")?.severity).toBe(
      "safe",
    );
    expect(caution.tables.find((t) => t.name === "users")?.columns.find((c) => c.name === "nickname")?.severity).toBe(
      "caution",
    );
  });

  it("flags tightening nullability and a type change", () => {
    const before = table("users", [
      idCol,
      { name: "email", type: { kind: "string", length: 255 }, nullable: true },
    ]);
    const after = table("users", [
      idCol,
      { name: "email", type: { kind: "text" }, nullable: false }, // string(255) -> text, + NOT NULL
    ]);
    const d = diffSchemas(schema([before]), schema([after]));
    const col = d.tables.find((t) => t.name === "users")?.columns.find((c) => c.name === "email");
    expect(col?.status).toBe("modified");
    expect(col?.changes?.some((c) => c.field === "type")).toBe(true);
    expect(col?.changes?.some((c) => c.field === "nullable" && c.severity === "caution")).toBe(true);
  });

  it("matches tables and columns case-insensitively", () => {
    const before = schema([table("Users", [{ name: "Email", type: { kind: "text" }, nullable: true }])]);
    const after = schema([table("users", [{ name: "email", type: { kind: "text" }, nullable: true }])]);
    expect(diffSchemas(before, after).identical).toBe(true);
  });
});
