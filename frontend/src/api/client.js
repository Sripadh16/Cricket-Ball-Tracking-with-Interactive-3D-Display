import axios from 'axios';

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';
export const MAX_UPLOAD_SIZE_MB = parseInt(process.env.REACT_APP_MAX_UPLOAD_SIZE_MB || '500');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
});

let guestSession;

export function ensureGuestSession() {
  if (localStorage.getItem('token')) return Promise.resolve();
  if (!guestSession) {
    guestSession = api.post('/auth/guest', null, { timeout: 8000 })
      .then(({ data }) => {
        if (!data.access_token) throw new Error('Guest session did not return a token');
        if (!localStorage.getItem('token')) localStorage.setItem('token', data.access_token);
      })
      .finally(() => { guestSession = undefined; });
  }
  return guestSession;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const token = localStorage.getItem('token');
    if (error.response?.status === 401 && token && error.config?.headers?.Authorization === `Bearer ${token}`) {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
      }
    }
    return Promise.reject(error);
  }
);

export default api;
