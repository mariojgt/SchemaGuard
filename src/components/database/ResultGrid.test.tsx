import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryResult } from "../../lib/db";
import { ResultGrid } from "./ResultGrid";

const result: QueryResult = {
  columns: ["id", "name"],
  rows: [
    ["1", "Ada"],
    ["2", "Grace"],
  ],
  rowsAffected: 2,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ResultGrid", () => {
  it("omits hidden rows and keeps the hide action wired to original row indexes", () => {
    const onHideRow = vi.fn();

    render(<ResultGrid result={result} hiddenRows={new Set([1])} onHideRow={onHideRow} />);

    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText("Grace")).toBeNull();

    fireEvent.click(screen.getByTitle("Hide row"));
    expect(onHideRow).toHaveBeenCalledWith(0);
  });

  it("shows an empty state when every loaded row is hidden", () => {
    render(<ResultGrid result={result} hiddenRows={new Set([0, 1])} onHideRow={() => undefined} />);

    expect(screen.getByText("All rows on this page are hidden.")).toBeTruthy();
  });
});
