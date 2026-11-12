export function subscribeMediaClock(media, onTime, onPlaying, onDuration, onError) {
  let frame;
  let disposed = false;
  let waiting = false;
  const videoFrames = typeof media.requestVideoFrameCallback === 'function';
  const cancel = () => {
    if (frame == null) return;
    if (videoFrames) media.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = null;
  };
  const tick = (_, metadata) => {
    frame = null;
    if (disposed || waiting || media.seeking) return;
    onTime(metadata?.mediaTime ?? media.currentTime, true);
    if (!media.paused && !media.ended) schedule();
  };
  const schedule = () => {
    if (frame != null || disposed) return;
    frame = videoFrames ? media.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  };
  const sync = () => {
    if (media.seeking || waiting) return;
    onTime(media.currentTime, false);
    onPlaying(!media.paused && !media.ended);
    if (Number.isFinite(media.duration) && media.duration > 0) onDuration(media.duration);
    if (media.paused || media.ended) cancel();
    else schedule();
  };
  const wait = () => { waiting = true; cancel(); onPlaying(false); };
  const resume = () => { waiting = false; sync(); };
  const fail = () => { wait(); onError(); };
  const events = { loadedmetadata: resume, durationchange: sync, seeked: resume,
    play: sync, playing: resume, pause: resume, ended: resume, ratechange: sync,
    waiting: wait, seeking: wait, emptied: sync, error: fail };
  Object.entries(events).forEach(([event, handler]) => media.addEventListener(event, handler));
  sync();
  return () => {
    disposed = true;
    cancel();
    Object.entries(events).forEach(([event, handler]) => media.removeEventListener(event, handler));
  };
}
