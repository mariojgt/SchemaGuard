import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || (c.group?.toLowerCase().includes(q) ?? false),
    );
  }, [commands, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setIndex(0);
  }, [query]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    c.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[index]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid animate-fade justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-strong h-fit w-[560px] max-w-[92vw] animate-pop overflow-hidden rounded-xl border border-line/70 shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command or table name…"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-[14px] outline-none"
        />
        <div className="max-h-[50vh] overflow-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-faint">No matches</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseEnter={() => {
                setIndex(i);
              }}
              onClick={() => {
                run(c);
              }}
              className={`flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] ${
                i === index ? "bg-acc/15" : ""
              }`}
            >
              {c.group && (
                <span className="text-[10px] uppercase tracking-wide text-faint">{c.group}</span>
              )}
              <span>{c.label}</span>
              {c.hint && (
                <span className="ml-auto font-mono text-[10.5px] text-faint">{c.hint}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
