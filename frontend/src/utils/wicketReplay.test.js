import { wicketBodyAtTime } from './wicketReplay';

test('wicket pose is deterministic on seek and remains above ground', () => {
  const args = [[0, 0.711, 0], [1.2, 6.5, 3], [16, 10, 22]];
  const pose = wicketBodyAtTime(...args, 0.5, 0.008);
  wicketBodyAtTime(...args, 2, 0.008);
  expect(wicketBodyAtTime(...args, 0.5, 0.008)).toEqual(pose);
  expect(wicketBodyAtTime(...args, 0, 0.008).position).toEqual(args[0]);
  expect(wicketBodyAtTime(...args, 10, 0.008).position[1]).toBeGreaterThanOrEqual(0.008);
});
