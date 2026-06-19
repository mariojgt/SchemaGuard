import { describe, expect, it } from "vitest";

import { prettyMaybeJson, rowToJson, toCsv, toJson, toSqlInserts } from "./exportData";

const cols = ["id", "name", "bio"];
const rows = [
  ["1", "Ann", 'says "hi"'],
  ["2", "Bo", null],
];

describe("exportData", () => {
  it("toCsv quotes fields with commas, quotes, or newlines and blanks nulls", () => {
    expect(toCsv(cols, rows)).toBe('id,name,bio\n1,Ann,"says ""hi"""\n2,Bo,');
  });

  it("toJson returns an array of objects with nulls preserved", () => {
    expect(JSON.parse(toJson(cols, rows))).toEqual([
      { id: "1", name: "Ann", bio: 'says "hi"' },
      { id: "2", name: "Bo", bio: null },
    ]);
  });

  it("rowToJson returns a single object", () => {
    expect(JSON.parse(rowToJson(cols, rows[1] as (string | null)[]))).toEqual({
      id: "2",
      name: "Bo",
      bio: null,
    });
  });

  it("toSqlInserts emits one INSERT per row with NULL handling", () => {
    expect(toSqlInserts("mysql", "users", ["id", "name"], [["1", "Ann"], ["2", null]])).toBe(
      "INSERT INTO `users` (`id`, `name`) VALUES ('1', 'Ann');\n" +
        "INSERT INTO `users` (`id`, `name`) VALUES ('2', NULL);",
    );
  });

  it("prettyMaybeJson formats JSON and leaves plain text alone (cell viewer)", () => {
    const json = prettyMaybeJson('{"a":1,"b":[2,3]}');
    expect(json.isJson).toBe(true);
    expect(json.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');

    const plain = prettyMaybeJson("just text");
    expect(plain).toEqual({ text: "just text", isJson: false });

    // Looks like JSON but isn't — must not throw, returns original.
    expect(prettyMaybeJson("{nope")).toEqual({ text: "{nope", isJson: false });
  });
});
