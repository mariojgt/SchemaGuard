import { describe, expect, it } from "vitest";

import {
  buildBrowseQuery,
  buildDeleteQuery,
  buildFilterQuery,
  buildInsertQuery,
} from "./browseQuery";

describe("right-click menu queries", () => {
  it("builds a search/filter query from a cell value (the 'Find rows where' action)", () => {
    const sql = buildFilterQuery({
      dialect: "postgres",
      table: "posts",
      column: "user_id",
      op: "=",
      value: "42",
      limit: 100,
    });
    expect(sql).toBe(`SELECT * FROM "posts" WHERE "user_id" = '42' LIMIT 100;`);
  });

  it("escapes quotes in search values so the query stays valid", () => {
    const sql = buildFilterQuery({
      dialect: "mysql",
      table: "users",
      column: "name",
      op: "<>",
      value: "O'Brien",
      limit: 50,
    });
    expect(sql).toBe("SELECT * FROM `users` WHERE `name` <> 'O''Brien' LIMIT 50;");
  });

  it("builds a free-text browse search across columns", () => {
    const sql = buildBrowseQuery({
      dialect: "postgres",
      table: "users",
      columns: ["name", "email"],
      search: "ann",
      limit: 100,
      offset: 0,
    });
    expect(sql).toContain(`CAST("name" AS TEXT) LIKE '%ann%'`);
    expect(sql).toContain(`CAST("email" AS TEXT) LIKE '%ann%'`);
  });

  it("builds insert and delete from menu actions", () => {
    expect(
      buildInsertQuery({
        dialect: "postgres",
        table: "users",
        values: [{ column: "email", value: "a@b.com" }],
      }),
    ).toBe(`INSERT INTO "users" ("email") VALUES ('a@b.com')`);

    expect(
      buildDeleteQuery({ dialect: "mysql", table: "posts", where: [{ column: "id", value: "7" }] }),
    ).toBe("DELETE FROM `posts` WHERE `id` = '7'");
  });
});
