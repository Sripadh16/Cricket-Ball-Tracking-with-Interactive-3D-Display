import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import api from './api/client';

jest.mock('./pages/Dashboard', () => props => <button onClick={() => props.onVideoSelect({ id: 'clip', filename: 'clip.webm', status: 'processing' })}>Open clip</button>);
jest.mock('./pages/AuthPage', () => () => null);
jest.mock('./pages/DRSReview', () => props => <div>{props.trajectoryData ? 'Analysis ready' : 'Waiting for analysis'}</div>);
jest.mock('./api/client', () => ({ __esModule: true, default: { get: jest.fn() } }));

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
