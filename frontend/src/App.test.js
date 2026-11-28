import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import api from './api/client';

jest.mock('./pages/Dashboard', () => props => <button onClick={() => props.onVideoSelect({ id: 'clip', filename: 'clip.webm', status: 'processing' })}>Open clip</button>);
jest.mock('./pages/AuthPage', () => props => (
  <button onClick={() => {
    localStorage.setItem('token', 'signed-in');
    props.onAuthSuccess();
  }}>Complete sign-in</button>
));
jest.mock('./pages/DRSReview', () => props => (
  <div>
    <span>{props.video ? `Clip:${props.video.id}` : 'Simulation mode'}</span>
    {props.trajectoryData ? 'Analysis ready' : 'Waiting for analysis'}
    <span>{props.trajectoryData?.version}</span>
    <span>{props.analysisPending ? 'Retry running' : 'Retry stopped'}</span>
    <span>{props.analysisStatus?.job_state}</span>
    <button onClick={props.onBack}>Back to dashboard</button>
  </div>
));
jest.mock('./api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  api.get.mockReset();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  localStorage.clear();
  jest.useRealTimers();
});

test('an open processing clip receives its own completed analysis without leaving the review', async () => {
  jest.useFakeTimers();
  localStorage.setItem('token', 'test-token');
  api.get.mockRejectedValueOnce({ response: { status: 404 } })
    .mockResolvedValueOnce({ data: { status: 'processed' } })
    .mockResolvedValueOnce({ data: { video_id: 'clip', points: [] } });
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const view = render(<App />);
  try {
    await act(async () => fireEvent.click(screen.getByText('Open clip')));
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByText('Analysis ready')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/videos/clip/trajectory');
  } finally {
    view.unmount();
    log.mockRestore();
    localStorage.clear();
    jest.useRealTimers();
  }
});

test.each(['completed', 'failed'])('keeps saved evidence during a retry that ends %s', async (state) => {
  jest.useFakeTimers();
  api.get.mockReset();
  api.get.mockResolvedValueOnce({ data: { video_id: 'clip', version: 'Saved result' } })
    .mockResolvedValueOnce({ data: { status: 'processing', job_state: 'running', progress: 50, has_previous_result: true } })
    .mockResolvedValueOnce({ data: { status: 'processed', job_state: state, has_previous_result: true } })
    .mockResolvedValueOnce({ data: { video_id: 'clip', version: 'New result' } });
  const view = render(<App />);
  try {
    await act(async () => fireEvent.click(screen.getByText('Open clip')));
    expect(screen.getByText('Saved result')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByText('Retry running')).toBeInTheDocument();
    expect(screen.getByText('Saved result')).toBeInTheDocument();
    await act(async () => { jest.advanceTimersByTime(2500); });
    expect(screen.getByText('Retry stopped')).toBeInTheDocument();
    expect(screen.getByText(state)).toBeInTheDocument();
    expect(screen.getByText(state === 'completed' ? 'New result' : 'Saved result')).toBeInTheDocument();
  } finally {
    view.unmount();
    jest.useRealTimers();
  }
});

test('restores a private delivery with a single clip lookup before requesting its analysis', async () => {
  localStorage.setItem('token', 'workspace-token');
  window.history.replaceState(null, '', '/?delivery=clip-1&token=should-strip');
  const videosReq = deferred();
  api.get.mockReturnValueOnce(videosReq.promise)
    .mockResolvedValueOnce({ data: { video_id: 'clip-1', version: 'Restored flight', points: [] } });

  render(<App />);
  expect(screen.getByText(/Opening private delivery/i)).toBeInTheDocument();
  expect(screen.queryByText('Open clip')).not.toBeInTheDocument();
  expect(window.location.search).toBe('?delivery=clip-1');

  await act(async () => {
    videosReq.resolve({ data: { id: 'clip-1', filename: 'clip-1.mp4', status: 'processed' } });
  });

  expect(await screen.findByText('Clip:clip-1')).toBeInTheDocument();
  expect(screen.getByText('Restored flight')).toBeInTheDocument();
  expect(api.get).toHaveBeenNthCalledWith(1, '/videos/clip-1', expect.objectContaining({ timeout: 8000 }));
  expect(api.get).toHaveBeenNthCalledWith(2, '/videos/clip-1/trajectory');
  expect(window.location.search).toBe('?delivery=clip-1');
});

test('blocks private deep link when token is missing without mounting Dashboard and allows simulation or dashboard return', async () => {
  window.history.replaceState(null, '', '/?delivery=clip-1');
  const view = render(<App />);

  expect(screen.getByText(/Sign in to open this private delivery/i)).toBeInTheDocument();
  expect(screen.queryByText('Open clip')).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Launch offline simulation' }));
  expect(await screen.findByText('Simulation mode')).toBeInTheDocument();
  expect(window.location.search).toBe('');

  view.unmount();

  window.history.replaceState(null, '', '/?delivery=clip-1');
  render(<App />);
  expect(screen.getByText(/Sign in to open this private delivery/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Return to dashboard' }));
  expect(screen.getByText('Open clip')).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

test('blocks private deep link on expired token 401 without mounting Dashboard', async () => {
  localStorage.setItem('token', 'expired-token');
  window.history.replaceState(null, '', '/?delivery=clip-1');
  api.get.mockRejectedValueOnce({ response: { status: 401 } });

  render(<App />);
  expect(await screen.findByText(/Sign in to open this private delivery/i)).toBeInTheDocument();
  expect(screen.queryByText('Open clip')).not.toBeInTheDocument();
  expect(localStorage.getItem('token')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Return to dashboard' }));
  expect(screen.getByText('Open clip')).toBeInTheDocument();
});

test('resumes a private link after signing in without opening the library', async () => {
  window.history.replaceState(null, '', '/?delivery=clip-1');
  api.get.mockResolvedValueOnce({ data: { id: 'clip-1', status: 'processed' } })
    .mockResolvedValueOnce({ data: { points: [] } });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Complete sign-in' }));
  expect(await screen.findByText('Clip:clip-1')).toBeInTheDocument();
  expect(api.get).toHaveBeenNthCalledWith(1, '/videos/clip-1', expect.any(Object));
});

test('shows unavailable error screen when deep-linked clip is missing from workspace', async () => {
  localStorage.setItem('token', 'workspace-token');
  window.history.replaceState(null, '', '/?delivery=missing-clip');
  api.get.mockRejectedValueOnce({ response: { status: 404 } });

  render(<App />);
  expect(await screen.findByText(/Private delivery unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText('Open clip')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
});

test('ignores delayed stale route response after manual navigation to simulation or popstate', async () => {
  localStorage.setItem('token', 'workspace-token');
  window.history.replaceState(null, '', '/?delivery=slow-clip');
  const slowReq = deferred();
  api.get.mockReturnValueOnce(slowReq.promise);

  const view = render(<App />);
  expect(screen.getByText(/Opening private delivery/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Launch offline simulation' }));
  expect(await screen.findByText('Simulation mode')).toBeInTheDocument();
  expect(window.location.search).toBe('');

  await act(async () => {
    slowReq.resolve({ data: { id: 'slow-clip', filename: 'slow.mp4', status: 'processed' } });
  });

  expect(screen.getByText('Simulation mode')).toBeInTheDocument();
  expect(screen.queryByText('Clip:slow-clip')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(1);
  view.unmount();

  api.get.mockReset();
  const popReqA = deferred();
  const popReqB = deferred();
  api.get
    .mockReturnValueOnce(popReqA.promise)
    .mockReturnValueOnce(popReqB.promise)
    .mockResolvedValueOnce({ data: { video_id: 'clip-b', version: 'Clip B flight', points: [] } });

  render(<App />);
  expect(screen.getByText('Open clip')).toBeInTheDocument();

  await act(async () => {
    window.history.pushState(null, '', '/?delivery=clip-a');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => {
    window.history.pushState(null, '', '/?delivery=clip-b');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => {
    popReqB.resolve({ data: { id: 'clip-b', filename: 'b.mp4', status: 'processed' } });
  });
  expect(await screen.findByText('Clip:clip-b')).toBeInTheDocument();

  await act(async () => {
    popReqA.resolve({ data: { id: 'clip-a', filename: 'a.mp4', status: 'processed' } });
  });
  expect(screen.getByText('Clip:clip-b')).toBeInTheDocument();
  expect(screen.queryByText('Clip:clip-a')).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/videos/clip-a/trajectory');
});
