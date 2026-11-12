// Illustrative collision response. Absolute time makes pause/seek repeatable.
export function wicketBodyAtTime(base, velocity, angularVelocity, elapsed, floor) {
  const t = Math.max(0, Math.min(3, elapsed));
  const landing = (velocity[1] + Math.sqrt(velocity[1] ** 2 + 19.6 * (base[1] - floor))) / 9.8;
  const flight = Math.min(t, landing);
  const slide = Math.max(0, t - landing);
  const horizontalTime = flight + (1 - Math.exp(-4 * slide)) / 4;
  return {
    position: [base[0] + velocity[0] * horizontalTime,
      Math.max(floor, base[1] + velocity[1] * flight - 4.9 * flight ** 2),
      base[2] + velocity[2] * horizontalTime],
    rotation: angularVelocity.map(value => value * flight)
  };
}
