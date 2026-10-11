/** SVG as text: for a page, a file, a server, or a test. */

import type { BoodScene, SvgNode } from "./types.js";

const escape = (value: string | number): string =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

/** One node and its children as SVG markup. */
export function toSvg(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join("");
  const children = node.children ?? [];
  return children.length === 0
    ? `<${node.tag}${attrs}/>`
    : `<${node.tag}${attrs}>${children.map(toSvg).join("")}</${node.tag}>`;
}

/** A whole scene, every layer at rest, as one standalone `<svg>` document. */
export function sceneSvg(
  scene: BoodScene,
  options: { width?: number; title?: string } = {},
): string {
  const [, , w, h] = scene.viewBox.split(" ").map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const width = options.width ?? 850;
  const height = Math.round((width * h) / w);
  const title =
    options.title === undefined
      ? ""
      : `<title>${escape(options.title)}</title>`;
  const body = scene.layers
    .map(
      (layer) =>
        `<g data-layer="${layer.target}">${layer.nodes.map(toSvg).join("")}</g>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${scene.viewBox}" width="${width}" height="${height}">${title}${body}</svg>`;
}
