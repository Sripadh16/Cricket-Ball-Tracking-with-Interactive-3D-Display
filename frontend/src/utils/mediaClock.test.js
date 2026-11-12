import { subscribeMediaClock } from './mediaClock';

function mediaFixture() {
  const media = new EventTarget();
  Object.assign(media, { currentTime: 2, duration: 12, paused: false, ended: false,
    requestVideoFrameCallback: jest.fn(() => 1), cancelVideoFrameCallback: jest.fn() });
  return media;
}

test('uses presented media time and cleans up callbacks and subscriptions', () => {
  const media = mediaFixture();
  const time = jest.fn();
  const playing = jest.fn();
  const duration = jest.fn();
  const stop = subscribeMediaClock(media, time, playing, duration, jest.fn());
  expect(duration).toHaveBeenCalledWith(12);
  media.requestVideoFrameCallback.mock.calls[0][0](0, { mediaTime: 2.04 });
  expect(time).toHaveBeenLastCalledWith(2.04, true);
  media.dispatchEvent(new Event('waiting'));
  expect(playing).toHaveBeenLastCalledWith(false);
  media.paused = true;
  media.currentTime = 6;
  media.dispatchEvent(new Event('seeked'));
  expect(time).toHaveBeenLastCalledWith(6, false);
  stop();
  time.mockClear();
  media.dispatchEvent(new Event('play'));
  expect(time).not.toHaveBeenCalled();
  expect(media.cancelVideoFrameCallback).toHaveBeenCalled();
});

test('fallback reads the media element instead of integrating a second clock', () => {
  const media = mediaFixture();
  delete media.requestVideoFrameCallback;
  const previousRequest = global.requestAnimationFrame;
  const previousCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = jest.fn(() => 7);
  global.cancelAnimationFrame = jest.fn();
  try {
    const time = jest.fn();
    const stop = subscribeMediaClock(media, time, jest.fn(), jest.fn(), jest.fn());
    media.currentTime = 4.5;
    global.requestAnimationFrame.mock.calls[0][0](9000);
    expect(time).toHaveBeenLastCalledWith(4.5, true);
    stop();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(7);
  } finally {
    global.requestAnimationFrame = previousRequest;
    global.cancelAnimationFrame = previousCancel;
  }
});

test('rate changes cannot restart the clock during buffering or an incomplete seek', () => {
  const media = mediaFixture();
  const time = jest.fn();
  const stop = subscribeMediaClock(media, time, jest.fn(), jest.fn(), jest.fn());
  media.dispatchEvent(new Event('waiting'));
  time.mockClear();
  media.currentTime = 8;
  media.dispatchEvent(new Event('ratechange'));
  expect(time).not.toHaveBeenCalled();
  media.seeking = true;
  media.dispatchEvent(new Event('seeking'));
  media.dispatchEvent(new Event('pause'));
  expect(time).not.toHaveBeenCalled();
  media.seeking = false;
  media.dispatchEvent(new Event('seeked'));
  expect(time).toHaveBeenLastCalledWith(8, false);
  stop();
});
