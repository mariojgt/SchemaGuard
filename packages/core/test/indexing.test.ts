import { describe, expect, it } from "vitest";

import type { Schema } from "../src/index";
import { analyzeIndexing } from "../src/index";

const col = (
  name: string,
  kind: "int" | "string" = "int",
): Schema["tables"][number]["columns"][number] =>
  kind === "int"
    ? { name, type: { kind: "int", size: "big" }, nullable: false }
    : { name, type: { kind: "string", length: 255 }, nullable: false };

describe("analyzeIndexing", () => {
  it("flags a table with no primary key as high severity", () => {
    const schema: Schema = {
      tables: [{ name: "logs", columns: [col("message", "string")], indexes: [], foreignKeys: [] }],
    };
    const f = analyzeIndexing(schema);
    expect(f.some((x) => x.title === "No primary key" && x.level === "high")).toBe(true);
  });

  it("flags an unindexed foreign key and offers a Laravel fix", () => {
    const schema: Schema = {
      tables: [
        {
          name: "comments",
          columns: [col("id"), col("post_id")],
          primaryKey: ["id"],
          indexes: [],
          foreignKeys: [{ columns: ["post_id"], refTable: "posts", refColumns: ["id"] }],
        },
      ],
    };
    const fk = analyzeIndexing(schema).find((x) => x.title === "Foreign key has no index");
    expect(fk).toBeDefined();
    expect(fk?.fix?.laravel).toContain("$table->index('post_id')");
  });

  it("does NOT flag a foreign key that already has a leading index", () => {
    const schema: Schema = {
      tables: [
        {
          name: "comments",
          columns: [col("id"), col("post_id")],
          primaryKey: ["id"],
          indexes: [{ columns: ["post_id"], unique: false }],
          foreignKeys: [{ columns: ["post_id"], refTable: "posts", refColumns: ["id"] }],
        },
      ],
    };
    expect(analyzeIndexing(schema).some((x) => x.title === "Foreign key has no index")).toBe(false);
  });

  it("flags a probable foreign key (*_id) with no constraint or index", () => {
    const schema: Schema = {
      tables: [
        {
          name: "events",
          columns: [col("id"), col("actor_id")],
          primaryKey: ["id"],
          indexes: [],
          foreignKeys: [],
        },
      ],
    };
    expect(
      analyzeIndexing(schema).some((x) => x.title === "Probable foreign key not indexed"),
    ).toBe(true);
  });

  it("flags a redundant index that is a prefix of another", () => {
    const schema: Schema = {
      tables: [
        {
          name: "posts",
          columns: [col("id"), col("author_id"), col("status", "string")],
          primaryKey: ["id"],
          indexes: [
            { columns: ["author_id"], unique: false },
            { columns: ["author_id", "status"], unique: false },
          ],
          foreignKeys: [],
        },
      ],
    };
    const r = analyzeIndexing(schema).find((x) => x.title === "Redundant index");
    expect(r?.columns).toEqual(["author_id"]);
  });

  it("returns nothing for a well-indexed schema", () => {
    const schema: Schema = {
      tables: [
        {
          name: "users",
          columns: [col("id"), col("email", "string")],
          primaryKey: ["id"],
          indexes: [],
          foreignKeys: [],
        },
      ],
    };
    expect(analyzeIndexing(schema)).toHaveLength(0);
  });
});
