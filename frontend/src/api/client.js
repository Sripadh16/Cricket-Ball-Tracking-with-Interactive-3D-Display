import axios from 'axios';

export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'http://localhost:8000';
export const MAX_UPLOAD_SIZE_MB = parseInt(process.env.REACT_APP_MAX_UPLOAD_SIZE_MB || '500');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
});

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
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
    }
    return Promise.reject(error);
  }
);

export default api;
