import type { ModelInfo, ModelRelation, Schema, Table } from "@schemaguard/core";

export interface Insight {
  tone: "good" | "info" | "warn";
  text: string;
}

const VERB: Record<ModelRelation["kind"], string> = {
  belongsTo: "belongs to",
  hasOne: "has one",
  hasMany: "has many",
  belongsToMany: "many-to-many with",
  hasOneThrough: "has one (through) →",
  hasManyThrough: "has many (through) →",
  morphTo: "morphs to (polymorphic)",
  morphOne: "has one (polymorphic)",
  morphMany: "has many (polymorphic)",
  morphToMany: "many-to-many (polymorphic) with",
  morphedByMany: "many-to-many (polymorphic) with",
};

/** Plain-language sentence for a single relation, e.g. "has many Comment". */
export function describeRelation(r: ModelRelation): string {
  const verb = VERB[r.kind];
  const target = r.relatedModel ?? r.relatedTable ?? "";
  return r.kind === "morphTo" ? `${r.method}: ${verb}` : `${verb} ${target}`.trim();
}

/**
 * Derive a list of useful, suggested observations about a model from its
 * schema table, parsed metadata, and how other models point at it.
 */
export function buildInsights(opts: {
  table: Table | undefined;
  info: ModelInfo | undefined;
  outgoing: ModelRelation[];
  incoming: ModelRelation[];
  schema: Schema;
}): Insight[] {
  const { table, info, outgoing, incoming } = opts;
  const out: Insight[] = [];

  // How central is this model in the graph?
  if (incoming.length >= 3) {
    out.push({
      tone: "info",
      text: `Central model — ${String(incoming.length)} other relationship(s) point here. Changes ripple widely.`,
    });
  }
  if (outgoing.length === 0 && incoming.length === 0) {
    out.push({ tone: "info", text: "Standalone model — no relationships detected." });
  }

  // belongsTo relations not backed by a real DB foreign key.
  if (table) {
    const enforced = new Set(
      table.foreignKeys
        .filter((fk) => fk.source !== "model")
        .flatMap((fk) => fk.columns),
    );
    for (const r of outgoing) {
      if (r.kind === "belongsTo" && r.fkColumn && !enforced.has(r.fkColumn)) {
        out.push({
          tone: "warn",
          text: `"${r.method}" → ${r.relatedModel ?? r.relatedTable ?? ""} has no database foreign key (${r.fkColumn}). Referential integrity isn't enforced.`,
        });
      }
    }
  }

  // Many-to-many needs a pivot table.
  const m2m = outgoing.filter((r) => r.category === "manyToMany");
  if (m2m.length > 0) {
    out.push({
      tone: "info",
      text: `Many-to-many: ${m2m.map((r) => r.relatedModel ?? r.relatedTable).join(", ")} — relies on pivot table(s).`,
    });
  }
  const poly = outgoing.filter((r) => r.category === "polymorphic");
  if (poly.length > 0) {
    out.push({
      tone: "info",
      text: `Polymorphic relationship(s): ${poly.map((r) => r.method).join(", ")}.`,
    });
  }

  // Mass-assignment posture.
  if (info) {
    if (info.fillable.length === 0 && info.guarded.length === 0) {
      out.push({
        tone: "warn",
        text: "No $fillable or $guarded — every attribute is mass-assignable. Consider a $fillable allowlist.",
      });
    } else if (info.fillable.length > 0) {
      out.push({
        tone: "good",
        text: `${String(info.fillable.length)} mass-assignable field(s) via $fillable.`,
      });
    }
    if (info.hidden.length > 0) {
      out.push({
        tone: "good",
        text: `Hides ${String(info.hidden.length)} field(s) from JSON: ${info.hidden.join(", ")}.`,
      });
    }
    if (!info.timestamps) {
      out.push({ tone: "info", text: "No created_at / updated_at timestamps on this model." });
    }
    if (info.softDeletes) {
      out.push({ tone: "good", text: "Soft deletes enabled (deleted_at) — rows are archived, not removed." });
    }
    if (info.primaryKey && info.primaryKey !== "id") {
      out.push({ tone: "info", text: `Custom primary key: ${info.primaryKey}.` });
    }
    if (!info.incrementing) {
      out.push({ tone: "info", text: "Non-incrementing key (e.g. UUID / ULID)." });
    }
    const castCount = Object.keys(info.casts).length;
    if (castCount > 0) {
      out.push({
        tone: "info",
        text: `${String(castCount)} attribute cast(s) defined (e.g. ${Object.entries(info.casts)
          .slice(0, 3)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")}).`,
      });
    }
  } else if (table) {
    out.push({
      tone: "info",
      text: "No model file matched this table — import the app/Models folder for richer insights.",
    });
  }

  return out;
}
