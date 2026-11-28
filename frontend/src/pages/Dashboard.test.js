import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Dashboard from './Dashboard';
import api, { ensureGuestSession } from '../api/client';

jest.mock('../api/client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  ensureGuestSession: jest.fn(),
  MAX_UPLOAD_SIZE_MB: 500,
}));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(ticks = 8) {
  await act(async () => {
    for (let i = 0; i < ticks; i += 1) {
      await Promise.resolve();
    }
  });
}

async function advanceTimersAndFlush(ms) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flushMicrotasks();
}

describe('Dashboard', () => {
  const onVideoSelect = jest.fn();
  const onLaunchDemo = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    ensureGuestSession.mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('awaits poll completion before scheduling the next poll and stops when processing finishes', async () => {
    const processingVideo = {
      id: 'v1',
      original_filename: 'yorker.mp4',
      status: 'processing',
      file_size: 2 * 1024 * 1024,
    };
    const processedVideo = {
      ...processingVideo,
      status: 'processed',
      ball_detected: true,
    };

    const poll1 = createDeferred();
    const poll2 = createDeferred();

    api.get
      .mockResolvedValueOnce({ data: { videos: [processingVideo] } })
      .mockImplementationOnce(() => poll1.promise)
      .mockImplementationOnce(() => poll2.promise);

    render(<Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />);
    await flushMicrotasks();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText('yorker.mp4')).toBeInTheDocument();
    expect(screen.getByText('Analysing')).toBeInTheDocument();

    // First poll triggers after 2500ms
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(2);

    // While poll 1 is still in flight, advancing multiple intervals must not overlap
    await advanceTimersAndFlush(6000);
    expect(api.get).toHaveBeenCalledTimes(2);

    // Resolve poll 1 (still processing) -> next poll waits a full 2500ms after completion
    poll1.resolve({ data: { videos: [processingVideo] } });
    await flushMicrotasks();

    await advanceTimersAndFlush(2499);
    expect(api.get).toHaveBeenCalledTimes(2);

    await advanceTimersAndFlush(1);
    expect(api.get).toHaveBeenCalledTimes(3);

    // Resolve poll 2 as processed -> polling stops
    poll2.resolve({ data: { videos: [processedVideo] } });
    await flushMicrotasks();

    expect(screen.getByText('Ready to review')).toBeInTheDocument();
    await advanceTimersAndFlush(10000);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  test('prevents overlapping manual refresh and in-flight polling without redundant fetches', async () => {
    const processingVideo = {
      id: 'v1',
      original_filename: 'inswinger.mp4',
      status: 'processing',
      file_size: 1024 * 1024,
    };
    const processedVideo = {
      ...processingVideo,
      status: 'processed',
      ball_detected: true,
    };

    const poll1 = createDeferred();

    api.get
      .mockResolvedValueOnce({ data: { videos: [processingVideo] } })
      .mockImplementationOnce(() => poll1.promise);

    render(<Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />);
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(1);

    // Start background poll
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(2);

    // Trigger manual refresh while poll 1 is still in flight
    const refreshBtn = screen.getByRole('button', { name: 'Refresh deliveries' });
    fireEvent.click(refreshBtn);

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(refreshBtn).toBeDisabled();

    // Resolve the shared in-flight request
    poll1.resolve({ data: { videos: [processedVideo] } });
    await flushMicrotasks();

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Refresh deliveries' })).toBeEnabled();
    expect(screen.getByText('Ready to review')).toBeInTheDocument();
  });

  test('prevents scheduled poll from overlapping an in-flight manual refresh', async () => {
    const processingVideo = {
      id: 'v1',
      original_filename: 'bouncer.mp4',
      status: 'processing',
      file_size: 1024 * 1024,
    };

    const manualRefresh = createDeferred();

    api.get
      .mockResolvedValueOnce({ data: { videos: [processingVideo] } })
      .mockImplementationOnce(() => manualRefresh.promise)
      .mockResolvedValue({ data: { videos: [processingVideo] } });

    render(<Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />);
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh deliveries' }));
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(2);

    // Scheduled poll timer fires while manual refresh is still pending -> joins instead of overlapping
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(2);

    manualRefresh.resolve({ data: { videos: [processingVideo] } });
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(2);

    // Next scheduled poll occurs 2500ms after the joined load completed
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  test('cleans up pending poll timers and ignores stale updates on unmount', async () => {
    const processingVideo = {
      id: 'v1',
      original_filename: 'googly.mp4',
      status: 'processing',
      file_size: 1024 * 1024,
    };

    const inFlightPoll = createDeferred();

    api.get
      .mockResolvedValueOnce({ data: { videos: [processingVideo] } })
      .mockImplementationOnce(() => inFlightPoll.promise);

    const { unmount } = render(
      <Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />
    );
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(1);

    // Start poll, then unmount before it resolves
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(2);

    unmount();

    // Resolving after unmount must not schedule further polls or trigger state updates
    inFlightPoll.resolve({ data: { videos: [processingVideo] } });
    await flushMicrotasks();
    await advanceTimersAndFlush(10000);

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('cleans up scheduled timer when unmounted before poll fires', async () => {
    const processingVideo = {
      id: 'v1',
      original_filename: 'offbreak.mp4',
      status: 'uploaded',
      file_size: 1024 * 1024,
    };

    api.get.mockResolvedValueOnce({ data: { videos: [processingVideo] } });

    const { unmount } = render(
      <Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />
    );
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(1);

    unmount();
    await advanceTimersAndFlush(10000);

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('preserves upload, reprocess, and delete behavior including post-mutation refresh', async () => {
    const video = {
      id: 'v1',
      original_filename: 'seam.mp4',
      status: 'processed',
      ball_detected: true,
      file_size: 3 * 1024 * 1024,
    };
    const uploadedVideo = {
      id: 'v2',
      original_filename: 'new-clip.mp4',
      status: 'uploaded',
    };

    api.get
      .mockResolvedValueOnce({ data: { videos: [video] } })
      .mockResolvedValueOnce({ data: { videos: [{ ...video, status: 'processing' }] } })
      .mockResolvedValueOnce({ data: { videos: [video] } })
      .mockResolvedValueOnce({ data: { videos: [] } });
    api.post
      .mockResolvedValueOnce({ data: { status: 'processing' } })
      .mockResolvedValueOnce({ data: uploadedVideo });
    api.delete.mockResolvedValueOnce({ data: { deleted: true } });

    render(<Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />);
    await flushMicrotasks();

    // Reprocess
    fireEvent.click(screen.getByRole('button', { name: 'Reprocess seam.mp4' }));
    await flushMicrotasks();

    expect(api.post).toHaveBeenCalledWith('/videos/v1/reprocess', null, { params: { sync: false } });
    expect(screen.getByText('Analysing')).toBeInTheDocument();

    // Poll completes processing so Delete is enabled again
    await advanceTimersAndFlush(2500);
    expect(screen.getByText('Ready to review')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete seam.mp4' }));
    expect(screen.getByText('Delete this delivery?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete delivery' }));
    await flushMicrotasks();

    expect(api.delete).toHaveBeenCalledWith('/videos/v1');
    expect(screen.getByText('No deliveries yet')).toBeInTheDocument();

    // Upload valid clip
    const fileInput = screen.getByLabelText('Choose cricket video');
    const file = new File(['video-bytes'], 'new-clip.mp4', { type: 'video/mp4' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await flushMicrotasks();

    expect(api.post).toHaveBeenLastCalledWith(
      '/videos/upload',
      expect.any(FormData),
      expect.objectContaining({ onUploadProgress: expect.any(Function) })
    );
    expect(onVideoSelect).toHaveBeenCalledWith(uploadedVideo);
  });

  test('runs a sequential fresh fetch after mutation when a poll is already in flight', async () => {
    const readyVideo = {
      id: 'v1',
      original_filename: 'old-clip.mp4',
      status: 'processed',
      ball_detected: true,
      file_size: 1024 * 1024,
    };
    const processingVideo = {
      id: 'v2',
      original_filename: 'active-clip.mp4',
      status: 'processing',
      file_size: 1024 * 1024,
    };

    const stalePoll = createDeferred();

    api.get
      .mockResolvedValueOnce({ data: { videos: [readyVideo, processingVideo] } })
      .mockImplementationOnce(() => stalePoll.promise)
      .mockResolvedValueOnce({ data: { videos: [{ ...processingVideo, status: 'processed', ball_detected: true }] } });
    api.delete.mockResolvedValueOnce({ data: { deleted: true } });

    render(<Dashboard onVideoSelect={onVideoSelect} onLaunchDemo={onLaunchDemo} />);
    await flushMicrotasks();
    expect(api.get).toHaveBeenCalledTimes(1);

    // Start background poll
    await advanceTimersAndFlush(2500);
    expect(api.get).toHaveBeenCalledTimes(2);

    // Delete v1 while stalePoll is still in flight
    fireEvent.click(screen.getByRole('button', { name: 'Delete old-clip.mp4' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete delivery' }));
    await flushMicrotasks();

    // Must not overlap stalePoll while it is still pending
    expect(api.delete).toHaveBeenCalledWith('/videos/v1');
    expect(api.get).toHaveBeenCalledTimes(2);

    // Once stalePoll settles, one sequential post-delete refresh runs
    stalePoll.resolve({ data: { videos: [readyVideo, processingVideo] } });
    await flushMicrotasks();

    expect(api.get).toHaveBeenCalledTimes(3);
    expect(screen.queryByText('old-clip.mp4')).not.toBeInTheDocument();
    expect(screen.getByText('active-clip.mp4')).toBeInTheDocument();
  });
});
