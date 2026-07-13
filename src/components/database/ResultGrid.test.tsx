import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResultGrid } from "./ResultGrid";

afterEach(cleanup);

describe("ResultGrid row editing", () => {
  it("blocks a row save while a JSONB cell is malformed", () => {
    const onSaveRow = vi.fn(() => Promise.resolve(true));
    render(
      <ResultGrid
        result={{
          columns: ["id", "settings"],
          columnTypes: ["INT4", "JSONB"],
          rows: [["1", '{"theme":"dark"}']],
          rowsAffected: 1,
        }}
        pkColumns={["id"]}
        onSaveRow={onSaveRow}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit row"));
    const editor = screen.getByLabelText<HTMLTextAreaElement>("settings");
    fireEvent.change(editor, { target: { value: '{"theme":}' } });

    expect(screen.getByText(/Invalid JSON/)).toBeTruthy();
    expect(screen.getByTitle("Save row").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByTitle("Save row"));
    expect(onSaveRow).not.toHaveBeenCalled();
  });

  it("formats valid JSON before saving", () => {
    render(
      <ResultGrid
        result={{
          columns: ["id", "settings"],
          columnTypes: ["INT4", "JSONB"],
          rows: [["1", '{"theme":"dark"}']],
          rowsAffected: 1,
        }}
        pkColumns={["id"]}
        onSaveRow={() => Promise.resolve(true)}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit row"));
    fireEvent.click(screen.getByText("Format"));
    expect(screen.getByLabelText<HTMLTextAreaElement>("settings").value).toContain("\n");
    expect(screen.getByTitle("Save row").hasAttribute("disabled")).toBe(false);
  });

  it("opens a dedicated editor and saves only after a field changes", async () => {
    const onSaveRow = vi.fn(() => Promise.resolve(true));
    render(
      <ResultGrid
        tableName="users"
        result={{
          columns: ["id", "name"],
          columnTypes: ["INT4", "TEXT"],
          rows: [["1", "Ada"]],
          rowsAffected: 1,
        }}
        pkColumns={["id"]}
        onSaveRow={onSaveRow}
      />,
    );

    fireEvent.click(screen.getByTitle("Edit row"));
    expect(screen.getByRole("dialog", { name: "Edit row in users" })).toBeTruthy();
    expect(screen.getByTitle("Save row").hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Grace" } });
    expect(screen.getByText("1 field changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSaveRow).toHaveBeenCalledWith(["1", "Ada"], ["1", "Grace"]);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
