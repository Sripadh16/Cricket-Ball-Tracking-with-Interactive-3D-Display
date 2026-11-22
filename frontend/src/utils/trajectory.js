export function prepareTrajectory(points = []) {
  const byTime = new Map();
  (Array.isArray(points) ? points : []).forEach(point => {
    if (point && ['t', 'x', 'y', 'z'].every(key => Number.isFinite(point[key]))) {
      byTime.set(point.t, point);
    }
  });
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/**
 * Sample the tracked trajectory at a media time.
 *
 * The review intentionally keeps the 3D ball visible for the whole clip:
 *  - before the first tracked point (run-up) it is anchored at the release point
 *    and flagged `is_at_release`;
 *  - after the last tracked point (keeper / post-impact) it stays at the final
 *    point and is flagged `is_post_delivery`;
 *  - exact sample times return the original point object unchanged;
 *  - anything in between is linearly interpolated (`is_interpolated`); metrics
 *    unknown on both neighbours come back as `null` rather than invented.
 */
export function sampleTrajectoryAtTime(points, time) {
  if (!points || !points.length || !Number.isFinite(time)) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (time === first.t) return first;
  if (time === last.t) return last;

  // Before first point (during bowler run-up): anchor ball at initial release point
  if (time < first.t) {
    return { ...points[0], is_at_release: true };
  }

  // After last point (post-impact / keeper): anchor ball at final trajectory point
  if (time > last.t) {
    return { ...last, is_post_delivery: true };
  }

  const index = points.findIndex(point => point.t >= time);
  if (index === -1) return points[points.length - 1];
  const next = points[index];
  if (next.t === time) return next;
  const previous = points[index - 1];
  if (!previous) return next;

  const alpha = Math.max(0, Math.min(1, (time - previous.t) / Math.max(1e-4, next.t - previous.t)));
  const sample = { ...previous, t: time, is_interpolated: true };
  ['x', 'y', 'z', 'pixel_x', 'pixel_y', 'speed_kmh', 'confidence', 'spin_rpm',
    'magnus_force_n', 'drag_force_n', 'reynolds_number', 'vx', 'vy', 'vz'].forEach(key => {
    sample[key] = Number.isFinite(previous[key]) && Number.isFinite(next[key])
      ? previous[key] + (next[key] - previous[key]) * alpha : (previous[key] ?? next[key] ?? null);
  });
  const outgoing = previous.outgoing_telemetry || previous;
  ['velocity_vector', 'gravity_vector', 'drag_vector', 'magnus_vector', 'seam_vector',
    'net_force_vector', 'spin_vector', 'acceleration'].forEach(key => {
    const a = outgoing[key];
    const b = next[key];
    sample[key] = Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
      && [...a, ...b].every(Number.isFinite)
      ? a.map((value, axis) => value + (b[axis] - value) * alpha) : (a || b || null);
  });
  ['spin_rpm', 'speed_kmh', 'magnus_force_n', 'drag_force_n', 'reynolds_number'].forEach(key => {
    sample[key] = Number.isFinite(outgoing[key]) && Number.isFinite(next[key])
      ? outgoing[key] + (next[key] - outgoing[key]) * alpha : (outgoing[key] ?? next[key] ?? null);
  });
  sample.is_predicted = Boolean(previous.is_predicted || next.is_predicted);
  return sample;
}

export function containRect(width, height, sourceWidth, sourceHeight) {
  if (![width, height, sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale,
    left: (width - sourceWidth * scale) / 2, top: (height - sourceHeight * scale) / 2 };
}
