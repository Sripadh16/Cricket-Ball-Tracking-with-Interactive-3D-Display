export function prepareTrajectory(points = []) {
  const byTime = new Map();
  (Array.isArray(points) ? points : []).forEach(point => {
    if (point && ['t', 'x', 'y', 'z'].every(key => Number.isFinite(point[key]))) {
      byTime.set(point.t, point);
    }
  });
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function sampleTrajectoryAtTime(points, time, maxGap = 0.2) {
  if (!points.length || !Number.isFinite(time) || time < points[0].t || time > points[points.length - 1].t) return null;
  const index = points.findIndex(point => point.t >= time);
  const next = points[index];
  if (next.t === time) return next;
  const previous = points[index - 1];
  if (!previous || next.t - previous.t > maxGap) return null;
  const alpha = (time - previous.t) / (next.t - previous.t);
  const sample = { ...previous, t: time, is_interpolated: true };
  ['x', 'y', 'z', 'pixel_x', 'pixel_y', 'speed_kmh', 'confidence', 'spin_rpm',
    'magnus_force_n', 'drag_force_n', 'reynolds_number', 'vx', 'vy', 'vz'].forEach(key => {
    sample[key] = Number.isFinite(previous[key]) && Number.isFinite(next[key])
      ? previous[key] + (next[key] - previous[key]) * alpha : null;
  });
  const outgoing = previous.outgoing_telemetry || previous;
  ['velocity_vector', 'gravity_vector', 'drag_vector', 'magnus_vector', 'seam_vector',
    'net_force_vector', 'spin_vector', 'acceleration'].forEach(key => {
    const a = outgoing[key];
    const b = next[key];
    sample[key] = Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
      && [...a, ...b].every(Number.isFinite)
      ? a.map((value, axis) => value + (b[axis] - value) * alpha) : null;
  });
  ['spin_rpm', 'speed_kmh', 'magnus_force_n', 'drag_force_n', 'reynolds_number'].forEach(key => {
    sample[key] = Number.isFinite(outgoing[key]) && Number.isFinite(next[key])
      ? outgoing[key] + (next[key] - outgoing[key]) * alpha : null;
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
