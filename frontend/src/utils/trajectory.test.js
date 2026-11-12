import { prepareTrajectory, sampleTrajectoryAtTime, containRect } from './trajectory';

const point = (t, x = 0) => ({ t, x, y: 1, z: 0.5, pixel_x: x, pixel_y: 0 });

test('prepares immutable, finite, ordered samples and resolves duplicate event timestamps', () => {
  const input = [point(2), point(1), point(1, 4), point(NaN)];
  expect(prepareTrajectory(input)).toEqual([point(1, 4), point(2)]);
  expect(input).toHaveLength(4);
});

test('sampling respects coverage, gaps, exact events, pixel zero, and unknown metrics', () => {
  const points = [point(2), point(2.1, 10), point(4)];
  expect(sampleTrajectoryAtTime(points, 0)).toBeNull();
  expect(sampleTrajectoryAtTime(points, 5)).toBeNull();
  expect(sampleTrajectoryAtTime(points, 3)).toBeNull();
  expect(sampleTrajectoryAtTime(points, 2).pixel_x).toBe(0);
  expect(sampleTrajectoryAtTime(points, 2.05).x).toBeCloseTo(5);
  expect(sampleTrajectoryAtTime(points, 2.05).confidence).toBeNull();
  expect(sampleTrajectoryAtTime(points, 2.05).is_interpolated).toBe(true);
  expect(sampleTrajectoryAtTime([], 0)).toBeNull();
  expect(sampleTrajectoryAtTime([point(2)], 2)).toEqual(point(2));
});

test('maps source pixels into portrait and landscape letterboxing', () => {
  const landscape = containRect(1000, 1000, 1920, 1080);
  Object.entries({ width: 1000, height: 562.5, left: 0, top: 218.75 }).forEach(([key, value]) => {
    expect(landscape[key]).toBeCloseTo(value);
  });
  expect(containRect(1000, 500, 500, 1000)).toEqual({ width: 250, height: 500, left: 375, top: 0 });
  expect(containRect(0, 500, 1920, 1080)).toBeNull();
});

test('position and telemetry interpolate together, using outgoing forces after bounce', () => {
  const a = { ...point(0), velocity_vector: [0, 30, -4], spin_rpm: 2000,
    outgoing_telemetry: { velocity_vector: [0, 20, 2], spin_rpm: 1000 } };
  const b = { ...point(0.1, 2), velocity_vector: [0, 18, 1], spin_rpm: 900 };
  const mid = sampleTrajectoryAtTime([a, b], 0.05);
  expect(mid.x).toBe(1);
  expect(mid.velocity_vector).toEqual([0, 19, 1.5]);
  expect(mid.spin_rpm).toBe(950);
  expect(mid.magnus_vector).toBeNull();
  expect(sampleTrajectoryAtTime([a, b], 0)).toBe(a);
});
