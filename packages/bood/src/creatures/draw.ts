/**
 * Drawing helpers for the bodies that are easier to read as a recipe than as
 * a path: a smooth curve through points, a polygon with round corners, and
 * points round a centre. Each returns path data in the drawing's units.
 */

export type Point = [number, number];

const r = (n: number) => Math.round(n);

/** A closed smooth curve through `points`, as cubic Beziers (Catmull-Rom). */
export function smooth(points: Point[]): string {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n] as Point;
  let d = `M ${r(at(0)[0])} ${r(at(0)[1])}`;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Point = [
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
    ];
    const c2: Point = [
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
    ];
    d += ` C ${r(c1[0])} ${r(c1[1])} ${r(c2[0])} ${r(c2[1])} ${r(p2[0])} ${r(p2[1])}`;
  }
  return `${d} Z`;
}

/** A polygon with each corner rounded by `round`: one size for all, or one per corner. */
export function rounded(points: Point[], round: number | number[]): string {
  const n = points.length;
  const cut = (a: Point, b: Point, k: number): Point => {
    const t = Math.min(k / Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const parts = points.map((p, i) => {
    const k = typeof round === "number" ? round : (round[i] ?? 0);
    const a = cut(p, points[(i - 1 + n) % n] as Point, k);
    const b = cut(p, points[(i + 1) % n] as Point, k);
    return `${i === 0 ? "M" : "L"} ${r(a[0])} ${r(a[1])} Q ${r(p[0])} ${r(p[1])} ${r(b[0])} ${r(b[1])}`;
  });
  return `${parts.join(" ")} Z`;
}

/** `count` points round `center`, from straight up, clockwise, at the radius each index is given. */
export function polar(
  center: Point,
  count: number,
  radius: (i: number, angle: number) => number,
): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    const k = radius(i, angle);
    return [center[0] + Math.cos(angle) * k, center[1] + Math.sin(angle) * k];
  });
}

/** A circle as path data, for a body part. */
export function disc(x: number, y: number, k: number): string {
  return `M ${x - k} ${y} A ${k} ${k} 0 1 0 ${x + k} ${y} A ${k} ${k} 0 1 0 ${x - k} ${y} Z`;
}
