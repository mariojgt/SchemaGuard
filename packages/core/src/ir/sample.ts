import type { Schema } from "./types";

/** A hand-built sample schema used by the vertical slice (Acme SaaS billing). */
export const sampleSchema: Schema = {
  name: "Acme SaaS",
  sourceDialect: "postgres",
  tables: [
    {
      name: "users",
      comment: "Account owner record — hub of the schema.",
      primaryKey: ["id"],
      indexes: [],
      foreignKeys: [],
      columns: [
        {
          name: "id",
          type: { kind: "serial", size: "big" },
          nullable: false,
          default: { kind: "autoincrement" },
        },
        { name: "name", type: { kind: "string", length: 255 }, nullable: false },
        { name: "email", type: { kind: "string", length: 255 }, nullable: false, unique: true },
      ],
    },
    {
      name: "subscriptions",
      primaryKey: ["id"],
      indexes: [{ columns: ["user_id"], unique: false }],
      foreignKeys: [
        { columns: ["user_id"], refTable: "users", refColumns: ["id"], onDelete: "cascade" },
      ],
      columns: [
        {
          name: "id",
          type: { kind: "serial", size: "big" },
          nullable: false,
          default: { kind: "autoincrement" },
        },
        { name: "user_id", type: { kind: "int", size: "big" }, nullable: false },
        {
          name: "status",
          type: { kind: "string", length: 32 },
          nullable: false,
          default: { kind: "literal", value: "active" },
        },
        { name: "renews_at", type: { kind: "timestamptz" }, nullable: true },
      ],
    },
    {
      name: "invoices",
      primaryKey: ["id"],
      // Note: user_id FK has no covering index — a design smell the linter will flag later.
      indexes: [],
      foreignKeys: [
        { columns: ["user_id"], refTable: "users", refColumns: ["id"], onDelete: "cascade" },
      ],
      columns: [
        {
          name: "id",
          type: { kind: "serial", size: "big" },
          nullable: false,
          default: { kind: "autoincrement" },
        },
        { name: "user_id", type: { kind: "int", size: "big" }, nullable: false },
        { name: "amount_cents", type: { kind: "int", size: "regular" }, nullable: false },
        { name: "paid_at", type: { kind: "timestamptz" }, nullable: true },
      ],
    },
  ],
};
