import { smoothProgress, strokeEnvelope } from './replayMotion';

test('stroke approaches, holds briefly and recovers continuously at replay timestamps', () => {
  expect(strokeEnvelope(0, 0.5)).toBe(0);
  expect(strokeEnvelope(0.54, 0.5)).toBe(1);
  expect(strokeEnvelope(1.1, 0.5)).toBe(0);
  expect(strokeEnvelope(0.49, 0.5)).toBeLessThan(strokeEnvelope(0.5, 0.5));
  expect(Math.abs(strokeEnvelope(0.5, 0.5) - strokeEnvelope(0.501, 0.5))).toBeLessThan(0.02);
  expect(smoothProgress(0.5, 0, 1)).toBe(0.5);
});
