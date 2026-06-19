import type { CanonicalType } from "@schemaguard/core";

export interface TypePreset {
  id: string;
  label: string;
  type: CanonicalType;
}

/** The type choices offered in the inspector dropdown (a friendly subset of the IR). */
export const TYPE_PRESETS: TypePreset[] = [
  { id: "serial", label: "bigint (auto-increment)", type: { kind: "serial", size: "big" } },
  { id: "bigint", label: "bigint", type: { kind: "int", size: "big" } },
  { id: "integer", label: "integer", type: { kind: "int", size: "regular" } },
  { id: "boolean", label: "boolean", type: { kind: "boolean" } },
  { id: "varchar", label: "varchar(255)", type: { kind: "string", length: 255 } },
  { id: "text", label: "text", type: { kind: "text" } },
  { id: "decimal", label: "decimal(10,2)", type: { kind: "decimal", precision: 10, scale: 2 } },
  { id: "uuid", label: "uuid", type: { kind: "uuid" } },
  { id: "json", label: "json", type: { kind: "json" } },
  { id: "date", label: "date", type: { kind: "date" } },
  { id: "datetime", label: "datetime", type: { kind: "datetime" } },
  { id: "timestamptz", label: "timestamptz", type: { kind: "timestamptz" } },
];

export function presetIdForType(type: CanonicalType): string {
  switch (type.kind) {
    case "serial":
      return "serial";
    case "int":
      return type.size === "big" ? "bigint" : "integer";
    case "string":
      return "varchar";
    case "boolean":
      return "boolean";
    case "text":
      return "text";
    case "decimal":
      return "decimal";
    case "uuid":
      return "uuid";
    case "json":
      return "json";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "timestamptz":
      return "timestamptz";
    default:
      return "text";
  }
}
