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
