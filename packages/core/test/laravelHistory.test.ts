import { describe, expect, it } from "vitest";

import { parseLaravelMigrations } from "../src/index";

const FILES = [
  {
    name: "2024_03_01_000000_create_posts_table.php",
    content: `class C extends Migration {
      public function up(): void {
        Schema::create('posts', function (Blueprint $table) {
          $table->id();
          $table->foreignId('user_id')->constrained();
          $table->string('title');
        });
      }
      public function down(): void { Schema::dropIfExists('posts'); }
    }`,
  },
  {
    name: "2024_01_01_000000_create_users_table.php",
    content: `class C extends Migration {
      public function up(): void {
        Schema::create('users', function (Blueprint $table) {
          $table->id();
          $table->string('email')->unique();
        });
      }
      public function down(): void { Schema::dropIfExists('users'); }
    }`,
  },
  {
    name: "2024_02_01_000000_add_name_to_users_table.php",
    content: `class C extends Migration {
      public function up(): void {
        Schema::table('users', function (Blueprint $table) {
          $table->string('name')->nullable();
        });
      }
      public function down(): void {}
    }`,
  },
];

describe("parseLaravelMigrations", () => {
  const h = parseLaravelMigrations(FILES);

  it("orders migrations chronologically by filename", () => {
    expect(h.migrations.map((m) => m.title)).toEqual([
      "create users table",
      "add name to users table",
      "create posts table",
    ]);
  });

  it("parses dates from filenames", () => {
    expect(h.migrations[0]?.date).toBe("2024-01-01");
  });

  it("classifies create vs alter changes", () => {
    expect(h.migrations[0]?.changes[0]).toMatchObject({ table: "users", kind: "create" });
    expect(h.migrations[1]?.changes[0]).toMatchObject({ table: "users", kind: "alter" });
  });

  it("builds a snapshot after each migration", () => {
    // After migration 0: users has no `name` column yet.
    const users0 = h.snapshots[0]?.tables.find((t) => t.name === "users");
    expect(users0?.columns.find((c) => c.name === "name")).toBeUndefined();
    // After migration 1: `name` exists.
    const users1 = h.snapshots[1]?.tables.find((t) => t.name === "users");
    expect(users1?.columns.find((c) => c.name === "name")).toBeTruthy();
  });

  it("produces a final schema with all tables", () => {
    expect(h.finalSchema.tables.map((t) => t.name).sort()).toEqual(["posts", "users"]);
  });
});
