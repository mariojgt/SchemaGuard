import type { MigrationEntry, ModelInfo, ModelRelation, Schema } from "@schemaguard/core";
import { describe, expect, it } from "vitest";

import { destructiveOps, detectDrift, summarizeImport, tableHistory } from "./importInsights";

const schema: Schema = {
  name: "app",
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: { kind: "serial", size: "big" }, nullable: false },
        { name: "email", type: { kind: "string", length: 191 }, nullable: false, unique: true },
        { name: "created_at", type: { kind: "datetime" }, nullable: true },
        { name: "updated_at", type: { kind: "datetime" }, nullable: true },
      ],
      indexes: [],
      foreignKeys: [],
      primaryKey: ["id"],
    },
  ],
};

const migrations: MigrationEntry[] = [
  {
    filename: "2019_01_01_000000_create_users_table.php",
    date: "2019-01-01",
    title: "create users table",
    changes: [{ table: "users", kind: "create", detail: "id, email, timestamps" }],
    affectedTables: ["users"],
    risk: { level: "none", ops: [{ kind: "createTable", table: "users" }], findings: [], hasDown: true },
  },
  {
    filename: "2021_06_01_000000_drop_phone_from_users.php",
    date: "2021-06-01",
    title: "drop phone from users",
    changes: [{ table: "users", kind: "alter", detail: "drop column phone" }],
    affectedTables: ["users"],
    risk: {
      level: "high",
      ops: [{ kind: "dropColumn", table: "users", column: "phone" }],
      findings: [{ level: "high", text: "Dropping column phone is destructive." }],
      hasDown: false,
    },
  },
];

describe("importInsights", () => {
  it("summarizeImport counts everything at a glance", () => {
    const s = summarizeImport({ schema, migrations, modelInfos: [], modelRelations: [], driftIssues: 3 });
    expect(s).toMatchObject({
      migrations: 2,
      tables: 1,
      columns: 4,
      foreignKeys: 0,
      risky: 1, // the high-risk drop
      irreversible: 1, // the one with hasDown: false
      destructive: 1, // one dropColumn
      driftIssues: 3,
      dateFrom: "2019-01-01",
      dateTo: "2021-06-01",
    });
  });

  it("detectDrift flags model declarations that don't match columns", () => {
    const info: ModelInfo = {
      model: "User",
      table: "users",
      fillable: ["email", "nickname"], // nickname doesn't exist
      guarded: [],
      hidden: ["password"], // doesn't exist
      casts: { settings: "array" }, // doesn't exist
      appends: [],
      relations: [],
      timestamps: true,
      softDeletes: true, // no deleted_at column
      incrementing: true,
    };
    const rels: ModelRelation[] = [
      { model: "User", table: "users", method: "company", kind: "belongsTo", category: "one", relatedTable: "companies", fkColumn: "company_id" },
    ];
    const drift = detectDrift(schema, [info], rels);
    const texts = drift.map((d) => d.text).join("\n");
    expect(texts).toContain('$fillable lists "nickname"');
    expect(texts).toContain('$hidden lists "password"');
    expect(texts).toContain('$casts references "settings"');
    expect(texts).toContain("no deleted_at column");
    expect(texts).toContain('foreign key "company_id"');
    // email IS a column — must not be flagged
    expect(texts).not.toContain('"email"');
  });

  it("detectDrift flags a model whose table was never migrated", () => {
    const orphan: ModelInfo = {
      model: "Ghost",
      table: "ghosts",
      fillable: [],
      guarded: [],
      hidden: [],
      casts: {},
      appends: [],
      relations: [],
      timestamps: true,
      softDeletes: false,
      incrementing: true,
    };
    const drift = detectDrift(schema, [orphan], []);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.text).toContain('no migration creates it');
  });

  it("tableHistory lists how a table evolved, oldest first", () => {
    const h = tableHistory(migrations, "users");
    expect(h.map((e) => e.kind)).toEqual(["create", "alter"]);
    expect(h[1]?.details).toContain("drop column phone");
  });

  it("destructiveOps collects prod-dangerous operations", () => {
    const ops = destructiveOps(migrations);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.op.kind).toBe("dropColumn");
    expect(ops[0]?.level).toBe("high");
  });
});
