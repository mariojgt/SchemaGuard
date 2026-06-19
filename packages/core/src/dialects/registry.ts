import type { DialectId } from "../ir/types";
import type { Dialect } from "./dialect";
import { mysql } from "./mysql";
import { postgres } from "./postgres";
import { sqlite } from "./sqlite";

export function dialectFor(id: DialectId): Dialect {
  switch (id) {
    case "mysql":
      return mysql;
    case "sqlite":
      return sqlite;
    case "postgres":
      return postgres;
  }
}
