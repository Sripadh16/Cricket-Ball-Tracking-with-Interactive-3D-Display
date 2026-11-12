import { analyzeAudio, audioExtrema } from './audio';

function buffer(sampleRate, channels) {
  return { sampleRate, length: channels[0].length, duration: channels[0].length / sampleRate,
    numberOfChannels: channels.length, getChannelData: i => channels[i] };
}

test.each([8000, 44100, 48000])('finds a right-channel transient at its decoded time (%i Hz)', rate => {
  const silent = new Float32Array(rate);
  const right = silent.slice();
  right[Math.floor(rate * 0.5)] = 1;
  right[rate - 1] = -0.8;
  const result = analyzeAudio(buffer(rate, [silent, right]));
  expect(result.candidates[0]).toBeCloseTo(0.5, 2);
  expect(result.channels).toBe(2);
  expect(audioExtrema(result, 0.49, 0.51)[1]).toBe(1);
  expect(audioExtrema(result, 0.99, 1)[0]).toBeCloseTo(-0.8);
  expect(audioExtrema(result, -1, -0.5)).toEqual([0, 0]);
});

test('silence produces no evidence or invented contact', () => {
  const result = analyzeAudio(buffer(8000, [new Float32Array(8000)]));
  expect(result.candidates).toEqual([]);
  expect(result.peak).toBe(0);
});
