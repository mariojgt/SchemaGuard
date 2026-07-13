import { Braces, Wand2 } from "lucide-react";

import { formatJsonValue, isJsonColumnType, jsonValueError } from "./valueEditing";

export function ValueEditor({
  value,
  columnType,
  disabled,
  allowEmpty = false,
  ariaLabel,
  onChange,
}: {
  value: string | null;
  columnType?: string | undefined;
  disabled: boolean;
  allowEmpty?: boolean;
  ariaLabel?: string | undefined;
  onChange: (value: string | null) => void;
}) {
  const json = isJsonColumnType(columnType);

  if (value === null) {
    return (
      <div className="flex min-h-7 items-center gap-1.5">
        <span className="rounded bg-panel3 px-1.5 py-0.5 text-[10px] italic text-faint">NULL</span>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ? `Set ${ariaLabel} value` : "Set value"}
          onClick={() => {
            onChange("");
          }}
          className="text-[10px] text-acc2 hover:underline disabled:opacity-40"
        >
          set value
        </button>
      </div>
    );
  }

  if (json) {
    const error = jsonValueError(value, { allowEmpty });
    return (
      <div className="min-w-[260px]">
        <div className="relative">
          <Braces
            size={13}
            className={`absolute left-2 top-2 ${error ? "text-crit" : "text-acc2"}`}
          />
          <textarea
            value={value}
            rows={3}
            spellCheck={false}
            aria-label={ariaLabel ?? "JSON value"}
            aria-invalid={Boolean(error)}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className={`w-full resize-y rounded-md border bg-panel py-1.5 pl-7 pr-2 font-mono text-[11.5px] leading-relaxed outline-none disabled:opacity-50 ${
              error
                ? "border-crit/70 focus:border-crit focus:ring-2 focus:ring-crit/10"
                : "border-line focus:border-acc"
            }`}
          />
        </div>
        <div className="mt-1 flex min-h-4 items-start gap-2 text-[10px]">
          <span className={`min-w-0 flex-1 leading-snug ${error ? "text-crit" : "text-low"}`}>
            {error ??
              (allowEmpty && value.trim() === "" ? "Uses the column default" : "Valid JSON")}
          </span>
          <button
            type="button"
            disabled={disabled || Boolean(error) || value.trim() === ""}
            onClick={() => {
              onChange(formatJsonValue(value));
            }}
            className="inline-flex flex-none items-center gap-1 text-faint hover:text-ink disabled:opacity-30"
          >
            <Wand2 size={10} />
            Format
          </button>
          <button
            type="button"
            title="Set SQL NULL"
            disabled={disabled}
            onClick={() => {
              onChange(null);
            }}
            className="flex-none text-faint hover:text-ink disabled:opacity-40"
          >
            NULL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        aria-label={ariaLabel}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="w-full min-w-[90px] rounded border border-line bg-panel px-1.5 py-1 text-[12px] outline-none focus:border-acc disabled:opacity-50"
      />
      <button
        type="button"
        title="Set SQL NULL"
        disabled={disabled}
        onClick={() => {
          onChange(null);
        }}
        className="flex-none rounded px-1 text-[11px] text-faint hover:text-ink disabled:opacity-40"
      >
        ∅
      </button>
    </div>
  );
}
