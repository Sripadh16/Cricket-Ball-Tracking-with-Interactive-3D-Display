import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Dashboard from './pages/Dashboard';
import AuthPage from './pages/AuthPage';
import DRSReview from './pages/DRSReview';
import api from './api/client';

const theme = createTheme({
  palette: {
    primary: { main: '#1a472a', light: '#2d6a4f' },
    secondary: { main: '#d4a574' },
    error: { main: '#e63946' },
    background: { default: '#f8f9fa', paper: '#ffffff' },
  },
  typography: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          padding: '12px 24px',
          minHeight: 48,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
  },
});

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [trajectoryData, setTrajectoryData] = useState(null);
  // trajectoryLoading: true while the /trajectory API call is in-flight
  const [trajectoryLoading, setTrajectoryLoading] = useState(false);
  // trajectoryError: 'not_processed' | 'load_error' | null
  const [trajectoryError, setTrajectoryError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    setIsAuthenticated(!!token);
    setLoading(false);
  }, []);

  const handleAuthSuccess = useCallback(() => {
    setIsAuthenticated(true);
    setCurrentView('dashboard');
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
    setCurrentView('dashboard');
  }, []);

  // Ref to cancel/ignore stale async trajectory fetches when user rapidly switches videos
  const activeVideoFetchId = useRef(0);

  const handleVideoSelect = useCallback(async (video) => {
    const fetchId = ++activeVideoFetchId.current;
    // Navigate immediately so user sees the video panel while trajectory loads
    setSelectedVideo(video);
    setTrajectoryData(null);
    setTrajectoryLoading(true);
    setTrajectoryError(null);
    setCurrentView('review');

    try {
      const response = await api.get(`/videos/${video.id}/trajectory`);
      if (fetchId !== activeVideoFetchId.current) return;
      setTrajectoryData(response.data);
    } catch (err) {
      if (fetchId !== activeVideoFetchId.current) return;
      console.error('Failed to load trajectory:', err);
      setTrajectoryData(null);
      // 404 = video not yet processed; anything else = real error
      setTrajectoryError(err.response?.status === 404 ? 'not_processed' : 'load_error');
    } finally {
      if (fetchId === activeVideoFetchId.current) {
        setTrajectoryLoading(false);
      }
    }
  }, []);

  const handleLaunchDemo = useCallback(() => {
    activeVideoFetchId.current++;
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
    setCurrentView('review');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    activeVideoFetchId.current++;
    setCurrentView('dashboard');
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
  }, []);

  if (loading) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#1a472a'
        }}>
          <div className="loading-spinner" style={{ width: 48, height: 48, borderWidth: 4 }} />
        </div>
      </ThemeProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthPage onAuthSuccess={handleAuthSuccess} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {currentView === 'dashboard' ? (
        <Dashboard
          onVideoSelect={handleVideoSelect}
          onLaunchDemo={handleLaunchDemo}
          onLogout={handleLogout}
        />
      ) : (
        <DRSReview
          video={selectedVideo}
          trajectoryData={trajectoryData}
          trajectoryLoading={trajectoryLoading}
          trajectoryError={trajectoryError}
          onBack={handleBackToDashboard}
        />
      )}
    </ThemeProvider>
  );
}

export default App;
