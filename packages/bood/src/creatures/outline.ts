/**
 * A body's outline as polygons, so plain code can ask whether a point is
 * inside it: how far a face may slide before an eye leaves the body. Every
 * renderer reads the same answer, since nothing here needs a DOM.
 */

import type { Point } from "./draw.js";

/** Line pieces per curve: a few units off at the drawing's 8500-unit scale, far inside an eye's margin. */
const STEPS = 8;
/** Each path data's polygons, worked out once. */
const outlines = new Map<string, Point[][]>();

/** The numbers and command letters of path data, in order. */
function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  for (const match of d.matchAll(re)) out.push(match[1] ?? Number(match[2]));
  return out;
}

/** An arc's points after its start, from SVG's endpoint form (the SVG spec, appendix F.6). */
function arc(
  from: Point, rx: number, ry: number, angle: number, large: boolean, sweep: boolean, to: Point,
): Point[] {
  if (rx === 0 || ry === 0) return [to];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const turn = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = turn(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = turn((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  if (sweep && delta < 0) delta += Math.PI * 2;
  const points: Point[] = [];
  for (let i = 1; i <= STEPS; i += 1) {
    const t = start + (delta * i) / STEPS;
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return points;
}

/** Path data as one polygon per subpath, curves cut into short lines. */
export function outline(d: string): Point[][] {
  const held = outlines.get(d);
  if (held !== undefined) return held;
  const polygons = trace(d);
  outlines.set(d, polygons);
  return polygons;
}

function trace(d: string): Point[][] {
  const list = tokens(d);
  const polygons: Point[][] = [];
  let polygon: Point[] = [];
  let at: Point = [0, 0];
  let start: Point = [0, 0];
  // The last control point, for the smooth curves that mirror it.
  let control: Point | null = null;
  let command = "";
  let i = 0;
  const num = () => list[i++] as number;
  const close = () => {
    if (polygon.length > 2) polygons.push(polygon);
    polygon = [];
  };
  const cubic = (c1: Point, c2: Point, to: Point) => {
    for (let s = 1; s <= STEPS; s += 1) {
      const t = s / STEPS;
      const u = 1 - t;
      polygon.push([
        u * u * u * at[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
        u * u * u * at[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
      ]);
    }
    control = c2;
    at = to;
  };
  const quad = (c: Point, to: Point) => {
    for (let s = 1; s <= STEPS; s += 1) {
      const t = s / STEPS;
      const u = 1 - t;
      polygon.push([u * u * at[0] + 2 * u * t * c[0] + t * t * to[0], u * u * at[1] + 2 * u * t * c[1] + t * t * to[1]]);
    }
    control = c;
    at = to;
  };
  while (i < list.length) {
    if (typeof list[i] === "string") command = list[i++] as string;
    const rel = command === command.toLowerCase();
    const ox = rel ? at[0] : 0;
    const oy = rel ? at[1] : 0;
    const was = command.toUpperCase();
    switch (was) {
      case "M": {
        close();
        at = [ox + num(), oy + num()];
        start = at;
        polygon.push(at);
        control = null;
        // Pairs after a move are lines.
        command = rel ? "l" : "L";
        break;
      }
      case "L": at = [ox + num(), oy + num()]; polygon.push(at); control = null; break;
      case "H": at = [(rel ? at[0] : 0) + num(), at[1]]; polygon.push(at); control = null; break;
      case "V": at = [at[0], (rel ? at[1] : 0) + num()]; polygon.push(at); control = null; break;
      case "C": cubic([ox + num(), oy + num()], [ox + num(), oy + num()], [ox + num(), oy + num()]); break;
      case "S": {
        const mirror: Point = control === null ? at : [2 * at[0] - control[0], 2 * at[1] - control[1]];
        cubic(mirror, [ox + num(), oy + num()], [ox + num(), oy + num()]);
        break;
      }
      case "Q": quad([ox + num(), oy + num()], [ox + num(), oy + num()]); break;
      case "T": {
        const mirror: Point = control === null ? at : [2 * at[0] - control[0], 2 * at[1] - control[1]];
        quad(mirror, [ox + num(), oy + num()]);
        break;
      }
      case "A": {
        const rx = num(), ry = num(), angle = num(), large = num() !== 0, sweep = num() !== 0;
        const to: Point = [ox + num(), oy + num()];
        polygon.push(...arc(at, rx, ry, angle, large, sweep, to));
        at = to;
        control = null;
        break;
      }
      case "Z": close(); at = start; polygon.push(at); control = null; break;
      default: i += 1;
    }
  }
  close();
  return polygons;
}

/** Whether a point is inside polygons filled by the nonzero rule, as SVG fills a path. */
export function insideOutline(polygons: Point[][], x: number, y: number): boolean {
  let winding = 0;
  for (const polygon of polygons) {
    for (let k = 0; k < polygon.length; k += 1) {
      const [x1, y1] = polygon[k] as Point;
      const [x2, y2] = polygon[(k + 1) % polygon.length] as Point;
      if (y1 <= y) {
        if (y2 > y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) > 0) winding += 1;
      } else if (y2 <= y && (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1) < 0) winding -= 1;
    }
  }
  return winding !== 0;
}
