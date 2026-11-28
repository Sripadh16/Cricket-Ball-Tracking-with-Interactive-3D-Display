import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';
import api from './api/client';

jest.mock('./pages/Dashboard', () => props => <button onClick={() => props.onVideoSelect({ id: 'clip', filename: 'clip.webm', status: 'processing' })}>Open clip</button>);
jest.mock('./pages/AuthPage', () => () => null);
jest.mock('./pages/DRSReview', () => props => <div>{props.trajectoryData ? 'Analysis ready' : 'Waiting for analysis'}<span>{props.trajectoryData?.version}</span><span>{props.analysisPending ? 'Retry running' : 'Retry stopped'}</span><span>{props.analysisStatus?.job_state}</span></div>);
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
