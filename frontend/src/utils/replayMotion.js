export function smoothProgress(time, start, end) {
  const t = Math.max(0, Math.min(1, (time - start) / Math.max(0.001, end - start)));
  return t * t * (3 - 2 * t);
}

export function strokeEnvelope(time, contactTime) {
  const approach = smoothProgress(time, contactTime - 0.14, contactTime + 0.04);
  const recovery = smoothProgress(time, contactTime + 0.18, contactTime + 0.6);
  return approach * (1 - recovery);
}
