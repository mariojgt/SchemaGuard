/** True for native Postgres/MySQL JSON result types. */
export function isJsonColumnType(type: string | undefined): boolean {
  return type?.toLowerCase() === "json" || type?.toLowerCase() === "jsonb";
}

/**
 * Validate a value before it reaches a JSON/JSONB column. SQL NULL is always
 * valid; an empty value may also mean "use the column default" in insert mode.
 */
export function jsonValueError(
  value: string | null,
  options: { allowEmpty?: boolean } = {},
): string | null {
  if (value === null || (options.allowEmpty && value.trim() === "")) return null;
  try {
    JSON.parse(value);
    return null;
  } catch (error) {
    const detail =
      error instanceof SyntaxError ? error.message.replace(/^JSON\.parse:\s*/i, "") : "";
    return detail ? `Invalid JSON — ${detail}` : "Invalid JSON";
  }
}

/** Pretty-print a valid JSON value; invalid text is returned unchanged. */
export function formatJsonValue(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
