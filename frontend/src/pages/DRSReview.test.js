import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import DRSReview from './DRSReview';

jest.mock('@mui/icons-material', () => new Proxy({ __esModule: true }, {
  get: (_, key) => key === '__esModule' ? true : () => null
}));
jest.mock('../components/HawkEyeViewer', () => () => <div>3D viewer</div>);
jest.mock('../components/DRSCommentary', () => () => null);
jest.mock('../components/DecisionFlowHUD', () => () => null);
jest.mock('../components/MatchReportCard', () => () => null);
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() }, API_BASE_URL: 'http://localhost:8000' }));

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  global.ResizeObserver = class { observe() {} disconnect() {} };
  window.scrollTo = jest.fn();
});
afterEach(() => localStorage.clear());

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

test('displays Hawk-Eye predictive trajectory card when drs_evaluation and extrapolated_points are provided', () => {
  const trajectoryData = {
    ball_detected: true,
    points: [{ t: 0.1, x: 0, y: 0, z: 1 }],
    extrapolated_points: [{ t: 0.8, x: 0.01, y: 10.06, z: 0.45 }],
    stump_plane_target: { x: 0.01, y: 10.06, z: 0.45, hit_stump: 'Middle Stump' },
    drs_evaluation: {
      decision: 'OUT',
      pitching: 'IN LINE',
      impact: 'IN LINE',
      wickets: 'HITTING',
      hit_stump: 'Middle Stump'
    }
  };
  render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }} trajectoryData={trajectoryData} onBack={() => {}} />);
  expect(screen.getByText('Hawk-Eye Predicted Trajectory')).toBeInTheDocument();
  expect(screen.getByText('Pitching')).toBeInTheDocument();
  expect(screen.getAllByText('IN LINE')).toHaveLength(2);
  expect(screen.getByText('Wickets')).toBeInTheDocument();
  expect(screen.getByText('HITTING (Middle Stump)')).toBeInTheDocument();
  expect(screen.getByText('OUT')).toBeInTheDocument();
});

test('derives Hawk-Eye predicted path when extrapolated_points are present without explicit drs_evaluation', () => {
  const trajectoryData = {
    ball_detected: true,
    points: [{ t: 0.1, x: 0, y: 0, z: 1 }],
    bounce_point: { x: 0.02, y: 5.5, z: 0.02 },
    extrapolated_points: [{ t: 0.8, x: 0.02, y: 10.06, z: 0.50 }],
    stump_plane_target: { x: 0.02, y: 10.06, z: 0.50, hit_stump: 'Off Stump' }
  };
  render(<DRSReview video={{ id: 'clip', filename: 'delivery.mp4' }} trajectoryData={trajectoryData} onBack={() => {}} />);
  expect(screen.getByText('Hawk-Eye Predicted Trajectory')).toBeInTheDocument();
  expect(screen.getByText('HAWK-EYE PREDICTED')).toBeInTheDocument();
  expect(screen.getByText('Predicted path to wickets')).toBeInTheDocument();
  expect(screen.getByText('HITTING (Off Stump)')).toBeInTheDocument();
  expect(screen.getByText('OUT')).toBeInTheDocument();
});
