import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  connect: vi.fn(),
  databases: vi.fn(),
  disconnect: vi.fn(),
  query: vi.fn(),
  tableData: vi.fn(),
  tables: vi.fn(),
}));

vi.mock("../lib/db", () => ({
  dbConnect: db.connect,
  dbCreateDatabase: vi.fn(),
  dbDatabases: db.databases,
  dbDisconnect: db.disconnect,
  dbDropTables: vi.fn(),
  dbExecute: vi.fn(),
  dbQuery: db.query,
  dbTableData: db.tableData,
  dbTables: db.tables,
  isDesktop: () => true,
}));

import { DatabasePanel } from "./DatabasePanel";

beforeEach(() => {
  localStorage.clear();
  db.connect.mockReset().mockResolvedValue("conn-1");
  db.databases.mockReset().mockResolvedValue(["postgres"]);
  db.disconnect.mockReset().mockResolvedValue(undefined);
  db.query.mockReset().mockResolvedValue({
    columns: [],
    columnTypes: [],
    rows: [],
    rowsAffected: 0,
  });
  db.tableData.mockReset().mockResolvedValue({
    columns: ["id", "name"],
    columnTypes: ["INT4", "TEXT"],
    rows: [["1", "Ada"]],
    rowsAffected: 1,
  });
  db.tables.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
});

describe("DatabasePanel connection lifecycle", () => {
  it("closes its native session when Database mode is left", async () => {
    const view = render(<DatabasePanel onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByText("Connected · postgres");
    view.unmount();

    expect(db.disconnect).toHaveBeenCalledWith("conn-1");
  });

  it("closes a partially-opened session when initial table loading fails", async () => {
    db.tables.mockRejectedValueOnce(new Error("Could not load tables"));
    render(<DatabasePanel onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByText("Could not load tables");
    await waitFor(() => {
      expect(db.disconnect).toHaveBeenCalledWith("conn-1");
    });
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  });

  it("shows a running state and a timed result summary for queries", async () => {
    let finishQuery:
      | ((result: {
          columns: string[];
          columnTypes: string[];
          rows: (string | null)[][];
          rowsAffected: number;
        }) => void)
      | undefined;
    db.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishQuery = resolve;
        }),
    );

    render(<DatabasePanel onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await screen.findByText("Connected · postgres");
    fireEvent.click(screen.getByRole("button", { name: "Query" }));
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));

    expect(await screen.findByText("Running query…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Running…" }).hasAttribute("disabled")).toBe(true);

    await act(() => {
      finishQuery?.({
        columns: ["answer"],
        columnTypes: ["INT4"],
        rows: [["1"]],
        rowsAffected: 1,
      });
      return Promise.resolve();
    });

    expect(await screen.findByText("1 row returned")).toBeTruthy();
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByText("answer")).toBeTruthy();
  });
});

describe("DatabasePanel table sidebar", () => {
  it("keeps bulk controls out of the way and supports table actions and collapse", async () => {
    db.tables.mockResolvedValue(["users", "orders"]);
    render(<DatabasePanel onImported={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await screen.findByRole("button", { name: /^users/ });
    expect(screen.queryByTitle("Select for bulk drop")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Actions for users" }));
    expect(screen.getByText("Browse data")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "Manage tables" }));
    expect(screen.getAllByTitle("Select for bulk drop")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Select users"));

    fireEvent.click(screen.getByRole("button", { name: "Collapse table sidebar" }));
    expect(screen.getByTestId("database-sidebar").getAttribute("data-collapsed")).toBe("true");
    expect(screen.queryByTitle("Select for bulk drop")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand table sidebar" }));
    expect(screen.getByRole("button", { name: "Manage tables" })).toBeTruthy();
  });
});
