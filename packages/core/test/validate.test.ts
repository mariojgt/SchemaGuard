import { describe, expect, it } from "vitest";

import type { Schema } from "../src/index";
import { sampleSchema, validate } from "../src/index";

describe("validate", () => {
  it("passes the sample schema with no errors", () => {
    const issues = validate(sampleSchema);
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("flags a foreign key to a missing table", () => {
    const schema: Schema = {
      tables: [
        {
          name: "orders",
          columns: [{ name: "user_id", type: { kind: "int", size: "big" }, nullable: false }],
          primaryKey: ["user_id"],
          indexes: [],
          foreignKeys: [{ columns: ["user_id"], refTable: "users", refColumns: ["id"] }],
        },
      ],
    };
    const errors = validate(schema).filter((i) => i.severity === "error");
    expect(errors.some((e) => e.message.includes('missing table "users"'))).toBe(true);
  });

  it("warns about a table with no primary key", () => {
    const schema: Schema = {
      tables: [{ name: "logs", columns: [], indexes: [], foreignKeys: [] }],
    };
    expect(validate(schema).some((i) => i.severity === "warning")).toBe(true);
  });
});
