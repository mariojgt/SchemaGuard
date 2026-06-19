import type { RelationCategory } from "@schemaguard/core";

/** Color + label per relation category — shared by the Models panel and canvas. */
export const RELATION_STYLE: Record<RelationCategory, { color: string; label: string }> = {
  one: { color: "#5ad1ff", label: "one" },
  many: { color: "#3ecf8e", label: "many" },
  manyToMany: { color: "#f6c453", label: "many-to-many" },
  polymorphic: { color: "#ff8a5b", label: "polymorphic" },
};
