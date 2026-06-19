import { describe, expect, it } from "vitest";

import { parseSql } from "../src/index";

const DDL = `
CREATE TABLE "users" (
  "id" BIGSERIAL PRIMARY KEY,
  "email" VARCHAR(255) NOT NULL UNIQUE,
  "name" VARCHAR(120),
  "active" BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE posts (
  id bigint NOT NULL AUTO_INCREMENT,
  user_id bigint NOT NULL,
  title varchar(200) NOT NULL,
  rating decimal(3,2),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
`;

describe("parseSql", () => {
  const { schema } = parseSql(DDL);
  const users = schema.tables.find((t) => t.name === "users");
  const posts = schema.tables.find((t) => t.name === "posts");

  it("parses both tables", () => {
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "posts"]);
  });

  it("parses columns, types, nullability, unique and inline PK", () => {
    expect(users?.primaryKey).toEqual(["id"]);
    expect(users?.columns.find((c) => c.name === "id")?.type).toEqual({
      kind: "serial",
      size: "big",
    });
    const email = users?.columns.find((c) => c.name === "email");
    expect(email?.type).toEqual({ kind: "string", length: 255 });
    expect(email?.unique).toBe(true);
    expect(email?.nullable).toBe(false);
    expect(users?.columns.find((c) => c.name === "name")?.nullable).toBe(true);
  });

  it("treats AUTO_INCREMENT as serial and reads table-level PRIMARY KEY", () => {
    expect(posts?.columns.find((c) => c.name === "id")?.type).toEqual({
      kind: "serial",
      size: "big",
    });
    expect(posts?.primaryKey).toEqual(["id"]);
  });

  it("parses table-level foreign keys with referential actions", () => {
    expect(posts?.foreignKeys[0]).toMatchObject({
      columns: ["user_id"],
      refTable: "users",
      refColumns: ["id"],
      onDelete: "cascade",
    });
  });

  it("parses decimal precision/scale", () => {
    expect(posts?.columns.find((c) => c.name === "rating")?.type).toEqual({
      kind: "decimal",
      precision: 3,
      scale: 2,
    });
  });
});
