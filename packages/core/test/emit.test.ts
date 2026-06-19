import { describe, expect, it } from "vitest";

import { emitDdl, postgres, sampleSchema } from "../src/index";

describe("emitDdl (postgres)", () => {
  const sql = emitDdl(sampleSchema, postgres, { ifNotExists: false });

  it("creates each table", () => {
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('CREATE TABLE "subscriptions"');
    expect(sql).toContain('CREATE TABLE "invoices"');
  });

  it("maps canonical types to postgres types", () => {
    expect(sql).toContain('"id" BIGSERIAL');
    expect(sql).toContain('"email" VARCHAR(255) NOT NULL UNIQUE');
    expect(sql).toContain('"renews_at" TIMESTAMPTZ');
    expect(sql).toContain('"amount_cents" INTEGER NOT NULL');
  });

  it("emits a literal default", () => {
    expect(sql).toContain("DEFAULT 'active'");
  });

  it("emits foreign keys as ALTER statements with referential actions", () => {
    expect(sql).toContain('ALTER TABLE "subscriptions" ADD CONSTRAINT');
    expect(sql).toContain('REFERENCES "users" ("id") ON DELETE CASCADE');
  });

  it("emits indexes", () => {
    expect(sql).toContain(
      'CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" ("user_id")',
    );
  });

  it("primary key appears as a table constraint", () => {
    expect(sql).toContain('PRIMARY KEY ("id")');
  });
});
