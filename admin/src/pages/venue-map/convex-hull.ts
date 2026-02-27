/**
 * Convex hull (Graham scan) for [lat, lng] points.
 * Returns hull vertices in counterclockwise order.
 */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];

  const idx = lowestThenLeftmost(points);
  const pivot = points[idx];
  const rest = points
    .map((p, i) => ({ p, i }))
    .filter((_, i) => i !== idx)
    .map(({ p }) => p);

  rest.sort((a, b) => crossAngle(pivot, a, b));
  const stack: [number, number][] = [pivot, rest[0]];

  for (let i = 1; i < rest.length; i++) {
    const next = rest[i];
    while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], next) <= 0) {
      stack.pop();
    }
    stack.push(next);
  }

  return stack;
}

function lowestThenLeftmost(points: [number, number][]): number {
  let idx = 0;
  for (let i = 1; i < points.length; i++) {
    const [latA, lngA] = points[idx];
    const [latB, lngB] = points[i];
    if (latB < latA || (latB === latA && lngB < lngA)) idx = i;
  }
  return idx;
}

/** Cross product (p2 - p0) x (p1 - p0). Positive = left turn. */
function cross(p0: [number, number], p1: [number, number], p2: [number, number]): number {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  return (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
}

/** Sort by polar angle from pivot. Use lng as x, lat as y. */
function crossAngle(pivot: [number, number], a: [number, number], b: [number, number]): number {
  const c = cross(pivot, a, b);
  if (c !== 0) return -c;
  return distSq(pivot, a) - distSq(pivot, b);
}

function distSq(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return dx * dx + dy * dy;
}
