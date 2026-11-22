import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Dashboard from './pages/Dashboard';
import api from './api/client';

const DRSReview = lazy(() => import('./pages/DRSReview'));

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#38bdf8', light: '#7dd3fc', dark: '#0ea5e9', contrastText: '#06111f' },
    secondary: { main: '#a78bfa' },
    background: { default: '#0a1220', paper: '#101b2d' },
    text: { primary: '#eef4fb', secondary: '#93a4bd' },
    divider: '#1f2d45',
    error: { main: '#f87171' },
    warning: { main: '#fbbf24' },
    success: { main: '#4ade80' },
  },
  typography: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
    h1: { fontWeight: 700 },
    h2: { fontWeight: 650 },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 10 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 40, padding: '8px 18px', borderRadius: 8 },
        sizeSmall: { minHeight: 32, padding: '5px 12px' },
        containedPrimary: { '&:hover': { backgroundColor: '#7dd3fc' } },
        outlined: { borderColor: '#2b3d5c' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiDialog: { styleOverrides: { paper: { backgroundColor: '#12203a', border: '1px solid #2b3d5c', borderRadius: 14 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { fontSize: 14, borderRadius: 8, backgroundColor: 'rgba(11,21,39,0.6)' },
        notchedOutline: { borderColor: '#2b3d5c' },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontSize: 13, minHeight: 46 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 600, fontSize: 11 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontSize: 13, minHeight: 36, borderColor: '#2b3d5c',
          '&.Mui-selected': { color: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.14)' },
          '&.Mui-selected:hover': { backgroundColor: 'rgba(56,189,248,0.22)' },
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: 40, minHeight: 40 } } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: { backgroundColor: '#162744', border: '1px solid #2b3d5c', color: '#eef4fb', fontSize: 12, fontWeight: 500, padding: '6px 10px' },
        arrow: { color: '#162744' },
      },
    },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiSwitch: { styleOverrides: { root: { marginRight: 2 } } },
    MuiCssBaseline: { styleOverrides: { body: { fontVariantNumeric: 'tabular-nums' } } },
  },
});

function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [trajectoryData, setTrajectoryData] = useState(null);
  // trajectoryLoading: true while the /trajectory API call is in-flight
  const [trajectoryLoading, setTrajectoryLoading] = useState(false);
  // trajectoryError: 'not_processed' | 'load_error' | null
  const [trajectoryError, setTrajectoryError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ensureAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        try {
          const res = await api.post('/auth/guest');
          if (res.data?.access_token) {
            localStorage.setItem('token', res.data.access_token);
          }
        } catch (err) {
          console.warn('Could not provision guest session:', err);
        }
      }
      setLoading(false);
    };
    ensureAuth();
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
          background: 'var(--bg)'
        }}>
          <div className="loading-spinner" style={{ width: 48, height: 48, borderWidth: 4 }} />
        </div>
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
