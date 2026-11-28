import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DRSReview from './DRSReview';
import api from '../api/client';

jest.mock('@mui/icons-material', () => new Proxy({ __esModule: true }, {
  get: (_, key) => key === '__esModule' ? true : () => null
}));
jest.mock('../components/HawkEyeViewer', () => () => <div>3D viewer</div>);
jest.mock('../components/DRSCommentary', () => () => null);
jest.mock('../components/DecisionFlowHUD', () => () => null);
jest.mock('../components/MatchReportCard', () => () => null);
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, API_BASE_URL: 'http://localhost:8000' }));

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  api.post.mockImplementation(() => new Promise(() => {}));
  global.ResizeObserver = class { observe() {} disconnect() {} };
  window.scrollTo = jest.fn();
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
});
afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

function seekTo(container, time) {
  const media = container.querySelector('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 2 });
  media.currentTime = time;
  act(() => { fireEvent(media, new Event('seeked')); });
}

test('an upload with incomplete analysis remains usable without invented metrics or a default verdict', () => {
  render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }} trajectoryData={{ points: [], ball_detected: false, drs_evaluation: {} }} onBack={() => {}} />);
  expect(screen.getByText(/No ball detected/)).toBeInTheDocument();
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  expect(screen.queryByText('142.4')).not.toBeInTheDocument();
  expect(screen.queryByText('86% Hitting')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewer assessment' }));
  expect(screen.getByRole('button', { name: 'Save Decision' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Decision outcome' })).toHaveTextContent('Select your assessment');
});

test('uploaded videos use clip-scoped playback URLs', async () => {
  api.post.mockResolvedValueOnce({ data: { stream_url: '/videos/clip/stream?ticket=clip-only' } });
  render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }} onBack={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Uploaded delivery video')).toHaveAttribute('src', 'http://localhost:8000/videos/clip/stream?ticket=clip-only'));
});

test('media decode failure offers a recovery message without removing source controls', () => {
  const { container } = render(<DRSReview video={{ id: 'clip', filename: 'delivery.avi' }} onBack={() => {}} />);
  fireEvent.error(container.querySelector('video'));
  expect(screen.getByText(/This video could not be played/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back to workspace' })).toBeInTheDocument();
});

test('partial clip coverage offers a direct jump to its first tracked source frame', () => {
  const { container } = render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }}
    trajectoryData={{ ball_detected: true, points: [{ t: 0.92, x: 0, y: 0, z: 1, pixel_x: 343, pixel_y: 332 }] }} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to first tracked frame (0.92s)' }));
  expect(container.querySelector('video').currentTime).toBe(0.92);
});

test('shows a qualified wicket projection while withholding a real-upload LBW verdict', () => {
  const trajectoryData = {
    ball_detected: true,
    reconstruction_method: 'camera_ballistic_fit',
    points: [{ t: 0.1, x: 0, y: 0, z: 1 }],
    wicket_projection: { wickets: 'HITTING', hit_stump: 'Middle Stump' },
    drs_evaluation: { decision: 'OUT' },
  };
  const { container } = render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }} trajectoryData={trajectoryData} />);
  seekTo(container, 1.0);
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
  expect(screen.getByText(/Pad contact could not be verified/)).toBeInTheDocument();
  expect(screen.getByText('Wicket projection')).toBeInTheDocument();
  expect(screen.getByText('HITTING')).toBeInTheDocument();
  expect(screen.queryByText('OUT')).not.toBeInTheDocument();
});

test('keeps a 2D-only track seekable without accepting an old inferred verdict', () => {
  const trajectoryData = {
    ball_detected: true,
    reconstruction_method: '2d_track_only',
    points: [],
    pixel_track: [{ t: 0.92, pixel_x: 343, pixel_y: 332 }, { t: 1.08, pixel_x: 380, pixel_y: 360 }],
    extrapolated_points: [{ t: 1.3, x: 0.01, y: 10.06, z: 0.45 }],
    stump_plane_target: { x: 0.01, y: 10.06, z: 0.45 },
  };
  const { container } = render(<DRSReview video={{ id: 'clip' }} trajectoryData={trajectoryData} />);
  fireEvent.click(screen.getByRole('button', { name: 'Jump to first tracked frame (0.92s)' }));
  expect(container.querySelector('video').currentTime).toBe(0.92);
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
  expect(screen.getByText(/pitching and impact lines could not be measured/)).toBeInTheDocument();
  expect(screen.queryByText('OUT')).not.toBeInTheDocument();
});

test('cues the first detection, steps across real samples, and offers a quarter-speed replay', () => {
  const trajectoryData = { ball_detected: true, reconstruction_method: '2d_track_only', pixel_track: [
    { t: 0.32, pixel_x: 40, pixel_y: 100 }, { t: 0.56, pixel_x: 80, pixel_y: 130 }, { t: 0.84, pixel_x: 90, pixel_y: 140 },
  ] };
  const { container } = render(<DRSReview video={{ id: 'clip' }} trajectoryData={trajectoryData} />);
  const media = container.querySelector('video');
  Object.defineProperty(media, 'duration', { configurable: true, value: 2 });
  fireEvent.loadedMetadata(media);
  expect(media.currentTime).toBe(0.32);
  seekTo(container, 0.32);
  fireEvent.click(screen.getByRole('button', { name: 'Next detection' }));
  expect(media.currentTime).toBe(0.56);
  seekTo(container, 0.56);
  fireEvent.click(screen.getByRole('button', { name: 'Previous detection' }));
  expect(media.currentTime).toBe(0.32);
  fireEvent.click(screen.getByRole('button', { name: 'Replay detections at ¼ speed' }));
  expect(media.playbackRate).toBe(0.25);
  expect(media.currentTime).toBe(0.32);
  expect(media.play).toHaveBeenCalled();
});

test('opens pitch recovery and displays the returned camera fit', async () => {
  const track = { ball_detected: true, reconstruction_method: '2d_track_only', can_refit_camera: true,
    video_info: { width: 640, height: 480 }, pixel_track: [{ t: 0.32, pixel_x: 40, pixel_y: 100 }] };
  api.put.mockResolvedValueOnce({});
  api.get.mockResolvedValueOnce({ data: { ...track, reconstruction_method: 'camera_ballistic_fit',
    wicket_projection: { wickets: 'HITTING' } } });
  render(<DRSReview video={{ id: 'clip' }} trajectoryData={track} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mark pitch corners' }));
  const corners = [[100, 100], [200, 100], [300, 400], [0, 400]];
  ['Bowler left', 'Bowler right', 'Batter right', 'Batter left'].forEach((corner, i) => {
    ['X', 'Y'].forEach((axis, j) => fireEvent.change(screen.getByLabelText(`${corner} ${axis}`), { target: { value: corners[i][j] } }));
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refit ball flight' }));
  await waitFor(() => expect(screen.getByText('Wicket projection')).toBeInTheDocument());
  expect(api.put).toHaveBeenCalledWith('/videos/clip/calibration', { corners });
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
});

test('opens a standard replay without requesting the simulation API', () => {
  api.get.mockClear();
  render(<DRSReview onBack={() => {}} />);
  expect(screen.getByRole('heading', { name: '3D replay studio' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  expect(screen.getByText('DECISION PENDING')).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

test('an extrapolated line without a stump-plane measurement does not produce a verdict', () => {
  const trajectoryData = {
    points: [{ t: 0.1, x: 0, y: 0, z: 1 }],
    extrapolated_points: [{ t: 0.8, x: 0.01, y: 10.06, z: 0.45 }],
  };
  const { container } = render(<DRSReview video={{ id: 'clip' }} trajectoryData={trajectoryData} />);
  seekTo(container, 1);
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
  expect(screen.queryByText('OUT')).not.toBeInTheDocument();
});


test('labels source-only evidence and exposes retry without inventing coverage', () => {
  const retry = jest.fn();
  render(<DRSReview video={{ id: 'clip' }} trajectoryData={{ points: [], ball_detected: false }} onRetryAnalysis={retry} />);
  expect(screen.getByText('Source only')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry analysis' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/source frames have candidates/)).not.toBeInTheDocument();
});

test('candidate coverage counts distinct source frames and event jump seeks source media', () => {
  const { container } = render(<DRSReview video={{ id: 'clip' }} trajectoryData={{
    ball_detected: true, reconstruction_method: '2d_track_only', video_info: { frame_count: 100 },
    pixel_track: [{ t: 0.2, frame_idx: 5, pixel_x: 10, pixel_y: 20 },
      { t: 0.4, frame_idx: 10, pixel_x: 20, pixel_y: 30 }]
  }} />);
  expect(screen.getByText('Candidate track')).toBeInTheDocument();
  expect(screen.getByText(/2 of 100 source frames have candidates/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Last candidate · 0.40s' }));
  expect(container.querySelector('video').currentTime).toBe(0.4);
});

test('lazy-loads clip-scoped human assessment history when expanded while keeping automated evidence distinct', async () => {
  api.get.mockReset();
  render(<DRSReview video={{ id: 'clip-42', filename: 'delivery.mp4' }} trajectoryData={{ ball_detected: true, points: [], drs_evaluation: {} }} onBack={() => {}} />);

  expect(api.get).not.toHaveBeenCalled();
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Saved reviewer assessments' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  api.get.mockResolvedValueOnce({
    data: [
      {
        id: 'rev-1',
        video_id: 'clip-42',
        created_at: '2026-05-10T12:00:00Z',
        decisions: [{ type: 'LBW', outcome: 'OUT', timestamp: 0.92 }],
        notes: 'Pitched in line on replay'
      },
      {
        id: 'rev-other',
        video_id: 'other-clip',
        created_at: '2026-05-09T12:00:00Z',
        decisions: [{ type: 'LBW', outcome: 'NOT OUT', timestamp: 0.5 }],
        notes: 'Other clip note'
      }
    ]
  });

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(api.get).toHaveBeenCalledWith('/reviews/', expect.objectContaining({ params: { video_id: 'clip-42' } }));

  await waitFor(() => expect(screen.getByText('Pitched in line on replay')).toBeInTheDocument());
  expect(screen.getByText('OUT')).toBeInTheDocument();
  expect(screen.getByText('LBW')).toBeInTheDocument();
  expect(screen.getByText(/May.*10.*2026|10.*May.*2026/)).toBeInTheDocument();
  expect(screen.queryByText('Other clip note')).not.toBeInTheDocument();
  expect(screen.getByText('NO VERDICT')).toBeInTheDocument();
});

test('shows loading, empty, and recoverable error states in saved assessment history', async () => {
  api.get.mockReset();
  let resolveFirst;
  api.get.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));

  render(<DRSReview video={{ id: 'clip-empty', filename: 'delivery.mp4' }} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved reviewer assessments' }));
  expect(screen.getByText('Loading saved assessments…')).toBeInTheDocument();

  await act(async () => { resolveFirst({ data: [] }); });
  await waitFor(() => expect(screen.getByText('No reviewer assessments saved for this clip yet.')).toBeInTheDocument());

  api.get.mockRejectedValueOnce(new Error('Network error'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByText('Could not load saved reviewer assessments.')).toBeInTheDocument());

  api.get.mockResolvedValueOnce({
    data: [{
      id: 'rev-2',
      video_id: 'clip-empty',
      created_at: null,
      decisions: [{ type: 'Bowled', outcome: 'OUT', timestamp: 1.1 }],
      notes: 'Clipped off stump'
    }]
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByText('Clipped off stump')).toBeInTheDocument());
  expect(screen.getByText('Date unavailable')).toBeInTheDocument();
});

test('ignores stale assessment history responses when switching clips', async () => {
  api.get.mockReset();
  let resolveClip1;
  api.get.mockReturnValueOnce(new Promise((resolve) => { resolveClip1 = resolve; }));

  const { rerender } = render(<DRSReview video={{ id: 'clip-1', filename: 'clip1.mp4' }} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved reviewer assessments' }));

  rerender(<DRSReview video={{ id: 'clip-2', filename: 'clip2.mp4' }} onBack={() => {}} />);
  const toggle = screen.getByRole('button', { name: 'Saved reviewer assessments' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  api.get.mockResolvedValueOnce({
    data: [{
      id: 'rev-c2',
      video_id: 'clip-2',
      created_at: '2026-05-11T12:00:00Z',
      decisions: [{ type: 'LBW', outcome: 'NOT OUT', timestamp: 0.4 }],
      notes: 'Clip 2 fresh note'
    }]
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(screen.getByText('Clip 2 fresh note')).toBeInTheDocument());

  await act(async () => {
    resolveClip1({
      data: [{
        id: 'rev-c1',
        video_id: 'clip-1',
        created_at: '2026-05-10T12:00:00Z',
        decisions: [{ type: 'LBW', outcome: 'OUT', timestamp: 0.8 }],
        notes: 'Stale clip 1 note'
      }]
    });
  });

  expect(screen.queryByText('Stale clip 1 note')).not.toBeInTheDocument();
  expect(screen.getByText('Clip 2 fresh note')).toBeInTheDocument();
});

test('refreshes saved assessment history after saving a decision while the panel is open', async () => {
  api.get.mockReset();
  api.post.mockImplementation((url) => (
    url === '/reviews/'
      ? Promise.resolve({ data: { id: 'rev-new-1234', video_id: 'clip-9' } })
      : new Promise(() => {})
  ));
  api.get
    .mockResolvedValueOnce({ data: [] })
    .mockResolvedValueOnce({
      data: [{
        id: 'rev-new-1234',
        video_id: 'clip-9',
        created_at: '2026-05-12T12:00:00Z',
        decisions: [{ type: 'LBW', outcome: 'NOT OUT', timestamp: 0 }],
        notes: 'Bat involved first',
        analysis_revision: 'first-analysis',
      }]
    });

  render(<DRSReview video={{ id: 'clip-9', filename: 'clip9.mp4' }}
    trajectoryData={{ points: [], analysis_revision: 'first-analysis' }} onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Saved reviewer assessments' }));
  await waitFor(() => expect(screen.getByText('No reviewer assessments saved for this clip yet.')).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: 'Save reviewer assessment' }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Decision outcome' }));
  fireEvent.click(screen.getByRole('option', { name: 'NOT OUT' }));
  fireEvent.change(screen.getByLabelText('Review notes'), { target: { value: 'Bat involved first' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Decision' }));

  const revisionLabel = await screen.findByText('Current analysis');
  expect(revisionLabel.closest('li')).toHaveTextContent('Bat involved first');
  expect(api.post).toHaveBeenCalledWith('/reviews/', expect.objectContaining({
    video_id: 'clip-9',
    notes: 'Bat involved first',
    analysis_revision: 'first-analysis',
  }));
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenNthCalledWith(2, '/reviews/', expect.objectContaining({ params: { video_id: 'clip-9' } }));
});
