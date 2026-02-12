/**
 * Port of admin sample-distribution.ts: sample a random X from a distribution curve
 * so that higher Y values are more likely. Used for POST /clients/:id/sample.
 */

const EPS = 1e-9;

function buildSegments(anchors, xMin, xMax) {
  if (!anchors || anchors.length === 0) return [];
  const sorted = [...anchors].sort((a, b) => a.x - b.x);
  if (sorted.length === 1) {
    const y = sorted[0].y;
    return [{ x1: xMin, y1: y, x2: xMax, y2: y }];
  }
  const leftY = sorted[0].y;
  const rightY = sorted[sorted.length - 1].y;
  const segs = [{ x1: xMin, y1: leftY, x2: sorted[0].x, y2: sorted[0].y }];
  for (let i = 1; i < sorted.length; i++) {
    segs.push({
      x1: sorted[i - 1].x,
      y1: sorted[i - 1].y,
      x2: sorted[i].x,
      y2: sorted[i].y,
    });
  }
  segs.push({
    x1: sorted[sorted.length - 1].x,
    y1: sorted[sorted.length - 1].y,
    x2: xMax,
    y2: rightY,
  });
  return segs;
}

function getIntercepts(segments, thresholdY, xMin, xMax) {
  const out = [];
  for (const seg of segments) {
    const { x1, y1, x2, y2 } = seg;
    if (Math.abs(y2 - y1) <= EPS) {
      if (Math.abs(y1 - thresholdY) <= EPS) {
        const xLo = Math.min(x1, x2);
        const xHi = Math.max(x1, x2);
        if (xLo >= xMin - EPS && xLo <= xMax + EPS) out.push({ x: xLo, curveYLeft: y1 });
        if (xHi > xLo + EPS && xHi >= xMin - EPS && xHi <= xMax + EPS) out.push({ x: xHi, curveYLeft: y1 });
      }
      continue;
    }
    const t = (thresholdY - y1) / (y2 - y1);
    if (t >= -EPS && t <= 1 + EPS) {
      const x = x1 + t * (x2 - x1);
      if (x >= xMin - EPS && x <= xMax + EPS) out.push({ x, curveYLeft: y1 });
    }
  }
  out.sort((a, b) => a.x - b.x);
  const deduped = [];
  for (const i of out) {
    if (deduped.length === 0 || i.x > deduped[deduped.length - 1].x + EPS) {
      deduped.push(i);
    }
  }
  return deduped;
}

function buildSpanTable(intercepts, xMin, xMax, thresholdY, segments) {
  const rows = [];
  if (intercepts.length === 0) {
    const curveYAtStart = segments[0].y1;
    const below = thresholdY < curveYAtStart - EPS;
    rows.push({ xStart: xMin, xEnd: xMax, below });
    return rows;
  }
  let previousX = xMin;
  for (const i of intercepts) {
    const interceptX = Math.max(xMin, Math.min(xMax, i.x));
    const below = thresholdY < i.curveYLeft - EPS;
    rows.push({ xStart: previousX, xEnd: interceptX, below });
    previousX = interceptX;
  }
  const lastSeg = segments[segments.length - 1];
  const curveYRight = lastSeg.y2;
  const belowRight = thresholdY < curveYRight - EPS;
  rows.push({ xStart: previousX, xEnd: xMax, below: belowRight });
  return rows;
}

/**
 * @param {{ anchors: Array<{ x: number, y: number }> }} curve
 * @param {number} xMin
 * @param {number} xMax
 * @returns {{ x: number, y: number }}
 */
function sampleFromDistribution(curve, xMin, xMax) {
  try {
    const anchors = curve && curve.anchors ? curve.anchors : [];
    const segments = buildSegments(anchors, xMin, xMax);
    if (segments.length === 0) return { x: 0, y: 0 };

    let maxY = -Infinity;
    for (const seg of segments) {
      maxY = Math.max(maxY, seg.y1, seg.y2);
    }
    if (maxY <= 0) return { x: 0, y: 0 };

    const thresholdY = maxY * Math.random();
    const intercepts = getIntercepts(segments, thresholdY, xMin, xMax);
    const spanTable = buildSpanTable(intercepts, xMin, xMax, thresholdY, segments);

    let totalBelowLength = 0;
    for (const row of spanTable) {
      if (row.below) totalBelowLength += row.xEnd - row.xStart;
    }

    if (totalBelowLength <= EPS) return { x: 0, y: thresholdY };

    let remaining = Math.random() * totalBelowLength;
    for (const row of spanTable) {
      if (!row.below) continue;
      const rowLen = row.xEnd - row.xStart;
      if (rowLen > remaining) {
        const outputX = row.xStart + remaining;
        return { x: Math.max(xMin, Math.min(xMax, outputX)), y: thresholdY };
      }
      remaining -= rowLen;
      if (remaining <= EPS) {
        return { x: Math.max(xMin, Math.min(xMax, row.xEnd)), y: thresholdY };
      }
    }
    const belowRows = spanTable.filter((r) => r.below);
    const lastBelow = belowRows[belowRows.length - 1];
    const outputX = lastBelow ? lastBelow.xEnd : xMin;
    return { x: Math.max(xMin, Math.min(xMax, outputX)), y: thresholdY };
  } catch {
    return { x: 0, y: 0 };
  }
}

module.exports = { sampleFromDistribution };
