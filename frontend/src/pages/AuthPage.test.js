import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuthPage from './AuthPage';
import api from '../api/client';

jest.mock('@mui/icons-material', () => new Proxy({ __esModule: true }, {
  get: (_, key) => key === '__esModule' ? true : () => null
}));
jest.mock('../api/client', () => ({ __esModule: true, default: { post: jest.fn() } }));

afterEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('shared guest access stores its session before opening the workspace', async () => {
  api.post.mockResolvedValue({ data: { access_token: 'guest-test-token' } });
  const onAuthSuccess = jest.fn();
  render(<AuthPage onAuthSuccess={onAuthSuccess} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open shared guest workspace' }));
  await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/auth/guest');
  expect(localStorage.getItem('token')).toBe('guest-test-token');
});

test('failed guest access stays on the access page with a recovery message', async () => {
  api.post.mockRejectedValue(new Error('offline'));
  const onAuthSuccess = jest.fn();
  render(<AuthPage onAuthSuccess={onAuthSuccess} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open shared guest workspace' }));
  expect(await screen.findByText(/Guest access could not connect/)).toBeInTheDocument();
  expect(onAuthSuccess).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
});
