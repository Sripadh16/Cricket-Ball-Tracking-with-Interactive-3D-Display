// Preserve each channel's extrema: averaging stereo can erase an opposite-phase transient.
export function analyzeAudio(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const count = Math.max(1, Math.ceil(buffer.duration * 400));
  const minima = new Float32Array(count);
  const maxima = new Float32Array(count);
  const energy = new Float32Array(count);
  let peak = 0;
  for (let bucket = 0; bucket < count; bucket++) {
    const start = Math.floor(bucket * buffer.length / count);
    const end = Math.floor((bucket + 1) * buffer.length / count);
    let sum = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) {
        const value = channel[i];
        minima[bucket] = Math.min(minima[bucket], value);
        maxima[bucket] = Math.max(maxima[bucket], value);
        peak = Math.max(peak, Math.abs(value));
        sum += value * value;
      }
    }
    energy[bucket] = Math.sqrt(sum / Math.max(1, (end - start) * channels.length));
  }
  const candidates = [];
  for (let i = 1; i < count; i++) {
    const window = Array.from(energy.slice(Math.max(0, i - 40), i)).sort((a, b) => a - b);
    const baseline = window[Math.floor(window.length / 2)] || 0;
    const time = i * buffer.duration / count;
    if (energy[i] > Math.max(0.015, baseline * 6) && energy[i] > energy[i - 1] * 2
      && (!candidates.length || time - candidates[candidates.length - 1] > 0.05)) candidates.push(time);
  }
  return { minima, maxima, candidates, peak, duration: buffer.duration,
    sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels };
}

export function audioExtrema(audio, start, end) {
  if (!audio || end < 0 || start >= audio.duration) return [0, 0];
  const count = audio.minima.length;
  const first = Math.max(0, Math.floor(start / audio.duration * count));
  const last = Math.min(count, Math.max(first + 1, Math.ceil(end / audio.duration * count)));
  let min = 0;
  let max = 0;
  for (let i = first; i < last; i++) {
    min = Math.min(min, audio.minima[i]);
    max = Math.max(max, audio.maxima[i]);
  }
  return [min, max];
}
