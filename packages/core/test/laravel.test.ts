import { describe, expect, it } from "vitest";

import { parseLaravel } from "../src/index";

const SRC = `
Schema::create('users', function (Blueprint $table) {
  $table->id();
  $table->string('email')->unique();
  $table->string('name', 120)->nullable();
  $table->boolean('active')->default(true);
  $table->timestamps();
});

Schema::create('posts', function (Blueprint $table) {
  $table->id();
  $table->foreignId('user_id')->constrained()->cascadeOnDelete();
  $table->string('title');
  $table->text('body')->nullable();
  $table->decimal('rating', 3, 2)->nullable();
});
`;

describe("parseLaravel", () => {
  const { schema } = parseLaravel(SRC);
  const users = schema.tables.find((t) => t.name === "users");
  const posts = schema.tables.find((t) => t.name === "posts");

  it("parses both tables in order", () => {
    expect(schema.tables.map((t) => t.name)).toEqual(["users", "posts"]);
  });

  it("parses columns, lengths, nullability and defaults", () => {
    expect(users?.primaryKey).toEqual(["id"]);
    const email = users?.columns.find((c) => c.name === "email");
    expect(email?.unique).toBe(true);
    const name = users?.columns.find((c) => c.name === "name");
    expect(name?.type).toEqual({ kind: "string", length: 120 });
    expect(name?.nullable).toBe(true);
    const active = users?.columns.find((c) => c.name === "active");
    expect(active?.default).toEqual({ kind: "literal", value: true });
  });

  it("expands timestamps() into created_at / updated_at", () => {
    expect(users?.columns.find((c) => c.name === "created_at")).toBeTruthy();
    expect(users?.columns.find((c) => c.name === "updated_at")).toBeTruthy();
  });

  it("infers a foreign key from foreignId()->constrained()", () => {
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
