// Port of simulatedClientServer/sample-distribution.js: sample a random X from a
// distribution curve so that higher Y values are more likely.

use rand::Rng;

const EPS: f64 = 1e-9;

#[derive(Clone, Copy, Debug)]
struct Segment {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
}

#[derive(Clone, Copy, Debug)]
struct Intercept {
    x: f64,
    curve_y_left: f64,
}

#[derive(Clone, Copy, Debug)]
struct SpanRow {
    x_start: f64,
    x_end: f64,
    below: bool,
}

fn build_segments(anchors: &[(f64, f64)], x_min: f64, x_max: f64) -> Vec<Segment> {
    if anchors.is_empty() {
        return vec![];
    }
    let mut sorted: Vec<(f64, f64)> = anchors.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    if sorted.len() == 1 {
        let y = sorted[0].1;
        return vec![Segment {
            x1: x_min,
            y1: y,
            x2: x_max,
            y2: y,
        }];
    }
    let left_y = sorted[0].1;
    let right_y = sorted[sorted.len() - 1].1;
    let mut segs = vec![Segment {
        x1: x_min,
        y1: left_y,
        x2: sorted[0].0,
        y2: sorted[0].1,
    }];
    for i in 1..sorted.len() {
        segs.push(Segment {
            x1: sorted[i - 1].0,
            y1: sorted[i - 1].1,
            x2: sorted[i].0,
            y2: sorted[i].1,
        });
    }
    segs.push(Segment {
        x1: sorted[sorted.len() - 1].0,
        y1: sorted[sorted.len() - 1].1,
        x2: x_max,
        y2: right_y,
    });
    segs
}

fn get_intercepts(
    segments: &[Segment],
    threshold_y: f64,
    x_min: f64,
    x_max: f64,
) -> Vec<Intercept> {
    let mut out: Vec<Intercept> = Vec::new();
    for seg in segments {
        let (x1, y1, x2, y2) = (seg.x1, seg.y1, seg.x2, seg.y2);
        if (y2 - y1).abs() <= EPS {
            if (y1 - threshold_y).abs() <= EPS {
                let x_lo = x1.min(x2);
                let x_hi = x1.max(x2);
                if x_lo >= x_min - EPS && x_lo <= x_max + EPS {
                    out.push(Intercept {
                        x: x_lo,
                        curve_y_left: y1,
                    });
                }
                if x_hi > x_lo + EPS && x_hi >= x_min - EPS && x_hi <= x_max + EPS {
                    out.push(Intercept {
                        x: x_hi,
                        curve_y_left: y1,
                    });
                }
            }
            continue;
        }
        let t = (threshold_y - y1) / (y2 - y1);
        if t >= -EPS && t <= 1.0 + EPS {
            let x = x1 + t * (x2 - x1);
            if x >= x_min - EPS && x <= x_max + EPS {
                out.push(Intercept {
                    x,
                    curve_y_left: y1,
                });
            }
        }
    }
    out.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal));
    let mut deduped: Vec<Intercept> = Vec::new();
    for i in out {
        if deduped.is_empty() || i.x > deduped[deduped.len() - 1].x + EPS {
            deduped.push(i);
        }
    }
    deduped
}

fn build_span_table(
    intercepts: &[Intercept],
    x_min: f64,
    x_max: f64,
    threshold_y: f64,
    segments: &[Segment],
) -> Vec<SpanRow> {
    let mut rows: Vec<SpanRow> = Vec::new();
    if intercepts.is_empty() {
        let curve_y_at_start = segments[0].y1;
        let below = threshold_y < curve_y_at_start - EPS;
        rows.push(SpanRow {
            x_start: x_min,
            x_end: x_max,
            below,
        });
        return rows;
    }
    let mut previous_x = x_min;
    for i in intercepts {
        let intercept_x = i.x.max(x_min).min(x_max);
        let below = threshold_y < i.curve_y_left - EPS;
        rows.push(SpanRow {
            x_start: previous_x,
            x_end: intercept_x,
            below,
        });
        previous_x = intercept_x;
    }
    let last_seg = segments[segments.len() - 1];
    let curve_y_right = last_seg.y2;
    let below_right = threshold_y < curve_y_right - EPS;
    rows.push(SpanRow {
        x_start: previous_x,
        x_end: x_max,
        below: below_right,
    });
    rows
}

/// Sample a random (x, y) from the distribution curve. Higher Y values in the curve
/// are more likely. Anchors are (x, y) pairs. Returns (0.0, 0.0) for empty or invalid curves.
pub fn sample_from_distribution(
    anchors: &[(f64, f64)],
    x_min: f64,
    x_max: f64,
    rng: &mut impl rand::RngCore,
) -> (f64, f64) {
    let segments = build_segments(anchors, x_min, x_max);
    if segments.is_empty() {
        return (0.0, 0.0);
    }
    let max_y = segments
        .iter()
        .map(|s| s.y1.max(s.y2))
        .fold(f64::NEG_INFINITY, f64::max);
    if max_y <= 0.0 {
        return (0.0, 0.0);
    }
    let threshold_y = max_y * rng.gen::<f64>();
    let intercepts = get_intercepts(&segments, threshold_y, x_min, x_max);
    let span_table = build_span_table(&intercepts, x_min, x_max, threshold_y, &segments);
    let total_below: f64 = span_table
        .iter()
        .filter(|r| r.below)
        .map(|r| r.x_end - r.x_start)
        .sum();
    if total_below <= EPS {
        return (0.0, threshold_y);
    }
    let remaining = rng.gen::<f64>() * total_below;
    let mut rem = remaining;
    for row in &span_table {
        if !row.below {
            continue;
        }
        let row_len = row.x_end - row.x_start;
        if row_len > rem {
            let output_x = row.x_start + rem;
            return (output_x.clamp(x_min, x_max), threshold_y);
        }
        rem -= row_len;
        if rem <= EPS {
            return (row.x_end.clamp(x_min, x_max), threshold_y);
        }
    }
    let below_rows: Vec<_> = span_table.iter().filter(|r| r.below).collect();
    let last_below = below_rows.last();
    let output_x = last_below.map(|r| r.x_end).unwrap_or(x_min);
    (output_x.clamp(x_min, x_max), threshold_y)
}
