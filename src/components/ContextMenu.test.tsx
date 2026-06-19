import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ContextMenu", () => {
  it("renders items and fires an item's onClick, then closes", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        items={[
          { label: "Browse data", onClick },
          "separator",
          { label: "Copy table name", onClick: () => undefined },
        ]}
      />,
    );
    // The reported bug: clicking a menu item did nothing.
    fireEvent.click(screen.getByText("Browse data"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss from the opening interaction, but closes on a later outside mousedown", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose} items={[{ label: "X", onClick: () => undefined }]} />,
    );
    // Before the deferred listener attaches, the event that opened the menu
    // must NOT immediately close it.
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    // Listener attaches on the next tick; now an outside press closes it.
    vi.advanceTimersByTime(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a mousedown inside the menu (so items stay clickable)", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        onClose={onClose}
        items={[{ label: "Inside item", onClick: () => undefined }]}
      />,
    );
    vi.advanceTimersByTime(1);
    fireEvent.mouseDown(screen.getByText("Inside item"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <ContextMenu x={10} y={10} onClose={onClose} items={[{ label: "X", onClick: () => undefined }]} />,
    );
    vi.advanceTimersByTime(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
