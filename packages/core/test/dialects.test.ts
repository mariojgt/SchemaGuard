import { describe, expect, it } from "vitest";

import { dialectFor, emitDdl, mysql, sampleSchema, sqlite } from "../src/index";

describe("MySQL dialect", () => {
  const sql = emitDdl(sampleSchema, mysql, { ifNotExists: false });

  it("uses backtick identifiers and AUTO_INCREMENT", () => {
    expect(sql).toContain("CREATE TABLE `users`");
    expect(sql).toContain("`id` BIGINT NOT NULL AUTO_INCREMENT");
    expect(sql).toContain("PRIMARY KEY (`id`)");
  });

  it("emits foreign keys as ALTER statements", () => {
    expect(sql).toContain("ALTER TABLE `subscriptions` ADD CONSTRAINT");
    expect(sql).toContain("REFERENCES `users` (`id`) ON DELETE CASCADE");
  });

  it("maps timestamptz to TIMESTAMP and warns", () => {
    expect(sql).toContain("TIMESTAMP");
    expect(sql).toContain("-- ⚠");
  });
});

describe("SQLite dialect", () => {
  const sql = emitDdl(sampleSchema, sqlite, { ifNotExists: false });

  it("emits INTEGER PRIMARY KEY AUTOINCREMENT inline", () => {
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
  });

  it("declares foreign keys inline (never ALTER)", () => {
    expect(sql).not.toContain("ALTER TABLE");
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE');
  });

  it("stores varchar as TEXT and warns about it", () => {
    expect(sql).toContain('"name" TEXT');
    expect(sql).toContain("-- ⚠");
  });
});

describe("dialectFor", () => {
  it("resolves each dialect id", () => {
    expect(dialectFor("mysql").id).toBe("mysql");
    expect(dialectFor("sqlite").id).toBe("sqlite");
    expect(dialectFor("postgres").id).toBe("postgres");
  });
});
