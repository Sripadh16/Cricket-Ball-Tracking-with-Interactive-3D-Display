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
