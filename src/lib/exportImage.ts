import type { Node } from "@xyflow/react";
import { getNodesBounds } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";

export type ImageFormat = "png" | "svg";

/**
 * Export the currently-mounted React Flow diagram to an image.
 *
 * We snapshot the `.react-flow__viewport` element (which holds only the node +
 * edge layers — not the minimap, controls, dotted background or panels) and
 * override its transform so the whole graph fits at 1:1 with padding. Returns
 * false if there's nothing to export.
 */
export async function exportDiagram(opts: {
  nodes: Node[];
  format: ImageFormat;
  /** Background fill for the image (transparent if omitted). */
  background?: string;
  fileName: string;
  /** Scope the lookup to a specific container when several flows can mount. */
  container?: HTMLElement | null;
}): Promise<boolean> {
  const { nodes, format, background, fileName, container } = opts;
  if (nodes.length === 0) return false;

  const root = container ?? document;
  const viewport = root.querySelector<HTMLElement>(".react-flow__viewport");
  if (!viewport) return false;

  const bounds = getNodesBounds(nodes);
  const pad = 48;
  const width = Math.ceil(bounds.width + pad * 2);
  const height = Math.ceil(bounds.height + pad * 2);

  const config = {
    width,
    height,
    pixelRatio: format === "png" ? 2 : 1,
    style: {
      width: `${String(width)}px`,
      height: `${String(height)}px`,
      transform: `translate(${String(-bounds.x + pad)}px, ${String(-bounds.y + pad)}px) scale(1)`,
    },
    ...(background ? { backgroundColor: background } : {}),
  };

  const dataUrl = format === "png" ? await toPng(viewport, config) : await toSvg(viewport, config);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${fileName}.${format}`;
  a.click();
  return true;
}
