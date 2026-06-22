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

const PG_DUMP = `
-- PostgreSQL database dump

CREATE TABLE public.users (
    id bigint NOT NULL,
    email character varying(255) NOT NULL
);

CREATE TABLE public.posts (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    title text
);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
CREATE INDEX posts_user_id_idx ON public.posts USING btree (user_id);

INSERT INTO public.users (id, email) VALUES (1, 'a@b.com'); -- data, must be ignored
`;

describe("parseSql — pg_dump style (comments, ALTER TABLE, CREATE INDEX)", () => {
  const { schema } = parseSql(PG_DUMP);
  const users = schema.tables.find((t) => t.name === "users");
  const posts = schema.tables.find((t) => t.name === "posts");

  it("only creates tables from CREATE TABLE, ignoring INSERT data", () => {
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "posts"]);
  });

  it("reads primary keys from standalone ALTER TABLE statements", () => {
    expect(users?.primaryKey).toEqual(["id"]);
    expect(posts?.primaryKey).toEqual(["id"]);
  });

  it("reads foreign keys from ALTER TABLE … ADD CONSTRAINT", () => {
    expect(posts?.foreignKeys[0]).toMatchObject({
      columns: ["user_id"],
      refTable: "users",
      refColumns: ["id"],
      onDelete: "cascade",
    });
  });

  it("reads standalone CREATE [UNIQUE] INDEX statements", () => {
    expect(users?.indexes).toContainEqual({
      name: "users_email_key",
      columns: ["email"],
      unique: true,
    });
    expect(posts?.indexes).toContainEqual({
      name: "posts_user_id_idx",
      columns: ["user_id"],
      unique: false,
    });
  });
});

const MYSQL_DUMP = `
-- MySQL dump 10.13
/*!40101 SET NAMES utf8mb4 */;

CREATE TABLE \`products\` (
  \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
  \`sku\` varchar(64) NOT NULL,
  \`price\` decimal(10,2) NOT NULL,
  \`category_id\` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`products_sku_unique\` (\`sku\`),
  KEY \`products_category_id_index\` (\`category_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

describe("parseSql — mysqldump style (inline KEY / UNIQUE KEY)", () => {
  const { schema } = parseSql(MYSQL_DUMP);
  const products = schema.tables.find((t) => t.name === "products");

  it("treats AUTO_INCREMENT on `bigint unsigned` as a big serial", () => {
    expect(products?.primaryKey).toEqual(["id"]);
    expect(products?.columns.find((c) => c.name === "id")?.type).toEqual({
      kind: "serial",
      size: "big",
    });
  });

  it("captures inline UNIQUE KEY and non-unique KEY as named indexes", () => {
    expect(products?.indexes).toContainEqual({
      name: "products_sku_unique",
      columns: ["sku"],
      unique: true,
    });
    expect(products?.indexes).toContainEqual({
      name: "products_category_id_index",
      columns: ["category_id"],
      unique: false,
    });
  });
});
