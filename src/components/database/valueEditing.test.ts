import { describe, expect, it } from "vitest";

import { formatJsonValue, isJsonColumnType, jsonValueError } from "./valueEditing";

describe("database JSON value editing", () => {
  it("recognizes Postgres and MySQL JSON types", () => {
    expect(isJsonColumnType("JSON")).toBe(true);
    expect(isJsonColumnType("JSONB")).toBe(true);
    expect(isJsonColumnType("VARCHAR")).toBe(false);
    expect(isJsonColumnType(undefined)).toBe(false);
  });

  it("catches malformed JSON before a row update reaches the database", () => {
    expect(jsonValueError('{"enabled":true}')).toBeNull();
    expect(jsonValueError("[1, 2, 3]")).toBeNull();
    expect(jsonValueError('{"enabled":}')).toContain("Invalid JSON");
    expect(jsonValueError("")).toContain("Invalid JSON");
    expect(jsonValueError(null)).toBeNull();
  });

  it("allows a blank JSON insert to use the column default", () => {
    expect(jsonValueError("", { allowEmpty: true })).toBeNull();
  });

  it("formats valid JSON without altering invalid text", () => {
    expect(formatJsonValue('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatJsonValue("not-json")).toBe("not-json");
  });
});
