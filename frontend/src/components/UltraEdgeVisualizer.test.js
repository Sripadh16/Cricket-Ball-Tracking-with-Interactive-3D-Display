import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UltraEdgeVisualizer from './UltraEdgeVisualizer';

beforeEach(() => {
  global.ResizeObserver = class { observe() {} disconnect() {} };
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => jest.restoreAllMocks());

test('missing uploaded audio stays unavailable until the user explicitly opens the demo', () => {
  render(<UltraEdgeVisualizer isSimulation={false} />);
  expect(screen.getByText('Source audio inspection')).toBeInTheDocument();
  expect(screen.getByText('No source audio is available.')).toBeInTheDocument();
  expect(screen.queryByText('Simulated audio demonstration')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Switch to demo' }));
  expect(screen.getByText('Simulated audio demonstration')).toBeInTheDocument();
});

test('decode failure releases its audio context and never claims contact evidence', async () => {
  const originalFetch = global.fetch;
  const originalContext = window.AudioContext;
  const close = jest.fn().mockResolvedValue();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  window.AudioContext = jest.fn(() => ({ state: 'suspended', close, decodeAudioData: async () => { throw new Error('unsupported'); } }));
  try {
    render(<UltraEdgeVisualizer sourceAudioUrl="/test-clip" isSimulation={false} />);
    await waitFor(() => expect(screen.getByText(/No decodable audio track/)).toBeInTheDocument());
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/BAT CONTACT|EDGE POINT/)).not.toBeInTheDocument();
  } finally { global.fetch = originalFetch; window.AudioContext = originalContext; }
});
