import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Dashboard from './pages/Dashboard';
import AuthPage from './pages/AuthPage';
import api from './api/client';

const DRSReview = lazy(() => import('./pages/DRSReview'));

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#8ab4ff', contrastText: '#101318' },
    secondary: { main: '#a8bba7' },
    background: { default: '#101318', paper: '#181d25' },
    text: { primary: '#f2f5f9', secondary: '#adb8c7' },
    divider: '#343e4b',
    error: { main: '#e89583' },
    warning: { main: '#dfbd83' },
    success: { main: '#b5ce93' },
  },
  typography: {
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    button: { textTransform: 'none', fontWeight: 600 },
    h1: { fontWeight: 500 },
    h2: { fontWeight: 500 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { minHeight: 40, padding: '9px 18px', borderRadius: 6 }, sizeSmall: { minHeight: 32, padding: '5px 12px' } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiOutlinedInput: { styleOverrides: { root: { fontSize: 14, borderRadius: 6 } } },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontSize: 13, minHeight: 46 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 5, fontWeight: 500, fontSize: 11 } } },
    MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', fontSize: 13, minHeight: 44 } } },
    MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
    MuiCssBaseline: { styleOverrides: { body: { fontVariantNumeric: 'tabular-nums' } } },
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
    activeVideoFetchId.current++;
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

  useEffect(() => {
    if (!selectedVideo || trajectoryError !== 'not_processed') return;
    const fetchId = activeVideoFetchId.current;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const progress = await api.get(`/videos/${selectedVideo.id}/progress`);
        if (cancelled || fetchId !== activeVideoFetchId.current) return;
        if (['error', 'failed'].includes(progress.data.status)) {
          setTrajectoryError('processing_failed');
          return;
        }
        if (progress.data.status === 'processed') {
          const response = await api.get(`/videos/${selectedVideo.id}/trajectory`);
          if (cancelled || fetchId !== activeVideoFetchId.current) return;
          setTrajectoryData(response.data);
          setTrajectoryError(null);
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch {
        if (!cancelled && fetchId === activeVideoFetchId.current) setTrajectoryError('load_error');
      }
    };
    timer = setTimeout(poll, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedVideo, trajectoryError]);

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
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#101318'
        }}>
          <div className="loading-spinner" style={{ width: 48, height: 48, borderWidth: 4 }} />
        </div>
      </ThemeProvider>
    );
  }

  if (!isAuthenticated && currentView !== 'review') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <a className="skip-link" href="#main-content">Skip to account access</a>
        <AuthPage onAuthSuccess={handleAuthSuccess} onExploreDemo={handleLaunchDemo} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      {currentView === 'dashboard' ? (
        <Dashboard
          onVideoSelect={handleVideoSelect}
          onLaunchDemo={handleLaunchDemo}
          onLogout={handleLogout}
        />
      ) : (
        <Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening review workspace…</div>}>
        <DRSReview
          video={selectedVideo}
          trajectoryData={trajectoryData}
          trajectoryLoading={trajectoryLoading}
          trajectoryError={trajectoryError}
          onBack={handleBackToDashboard}
        />
        </Suspense>
      )}
    </ThemeProvider>
  );
}

export default App;
