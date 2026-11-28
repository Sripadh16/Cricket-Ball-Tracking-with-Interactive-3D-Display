import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AuthPage from './AuthPage';
import api from '../api/client';

jest.mock('@mui/icons-material', () => new Proxy({ __esModule: true }, {
  get: (_, key) => key === '__esModule' ? true : () => null
}));
jest.mock('../api/client', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

afterEach(() => { localStorage.clear(); jest.clearAllMocks(); });

test('guest access stores its session before opening the workspace', async () => {
  api.post.mockResolvedValue({ data: { access_token: 'guest-test-token' } });
  const onAuthSuccess = jest.fn();
  render(<AuthPage onAuthSuccess={onAuthSuccess} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open guest workspace' }));
  await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/auth/guest');
  expect(localStorage.getItem('token')).toBe('guest-test-token');
});

test('failed guest access stays on the access page with a recovery message', async () => {
  api.post.mockRejectedValue(new Error('offline'));
  const onAuthSuccess = jest.fn();
  render(<AuthPage onAuthSuccess={onAuthSuccess} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open guest workspace' }));
  expect(await screen.findByText(/Guest access could not connect/)).toBeInTheDocument();
  expect(onAuthSuccess).not.toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
});

test('sets credentials on the current guest before replacing its token', async () => {
  localStorage.setItem('token', 'guest-token');
  api.get.mockResolvedValue({ data: { is_guest: true } });
  api.post.mockResolvedValue({ data: { access_token: 'account-token' } });
  const onAuthSuccess = jest.fn();
  render(<AuthPage onAuthSuccess={onAuthSuccess} onCancel={() => {}} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Keep workspace' }));
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Reviewer' } });
  fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'reviewer@test.com' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'valid-password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Keep workspace' }));
  await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/auth/promote', {
    name: 'Reviewer', email: 'reviewer@test.com', password: 'valid-password123',
  }, expect.any(Object));
  expect(localStorage.getItem('token')).toBe('account-token');
});
