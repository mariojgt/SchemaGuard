export type { ColumnSql, Dialect } from "./dialects/dialect";
export { mysql } from "./dialects/mysql";
export { postgres } from "./dialects/postgres";
export { dialectFor } from "./dialects/registry";
export { sqlite } from "./dialects/sqlite";
export type { EmitOptions } from "./emit/ddl";
export { emitDdl } from "./emit/ddl";
export type {
  ChangeSeverity,
  ColumnDiff,
  DiffSummary,
  FieldChange,
  SchemaDiff,
  TableDiff,
} from "./ir/diff";
export { diffSchemas, typeLabel } from "./ir/diff";
export type { IndexFinding, IndexLevel } from "./ir/indexing";
export { analyzeIndexing, explainIndexing } from "./ir/indexing";
export { sampleSchema } from "./ir/sample";
export type { Smell, SmellFix, SmellSeverity } from "./ir/smells";
export { detectSmells, healthScore } from "./ir/smells";
export type {
  CanonicalType,
  Column,
  DefaultValue,
  DialectId,
  ForeignKey,
  Index,
  IntSize,
  ReferentialAction,
  Schema,
  Table,
} from "./ir/types";
export type { ValidationIssue } from "./ir/validate";
export { validate } from "./ir/validate";
export type {
  EloquentParseResult,
  ModelInfo,
  ModelRelation,
  RelationCategory,
  RelationKind,
} from "./parse/eloquent";
export { mergeModelRelationships, parseModelFiles, parseModelRelations } from "./parse/eloquent";
export type { LaravelParseResult } from "./parse/laravel";
export { parseLaravel } from "./parse/laravel";
export type {
  MigrationChangeSummary,
  MigrationEntry,
  MigrationHistory,
} from "./parse/laravelHistory";
export { parseLaravelMigrations } from "./parse/laravelHistory";
export type {
  MigrationOp,
  MigrationOpKind,
  MigrationRisk,
  RiskFinding,
  RiskLevel,
} from "./parse/migrationRisk";
export { analyzeMigrationSource, extractOps } from "./parse/migrationRisk";
export type { SqlParseResult } from "./parse/sql";
export { parseSql } from "./parse/sql";
