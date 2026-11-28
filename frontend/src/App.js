import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import Dashboard from './pages/Dashboard';
import api from './api/client';

const DRSReview = lazy(() => import('./pages/DRSReview'));

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#c9ef83', light: '#ddf9ac', dark: '#aed864', contrastText: '#151e10' },
    secondary: { main: '#e8c790' },
    background: { default: '#101715', paper: '#161f1b' },
    text: { primary: '#f6f5eb', secondary: '#a6b7ac' },
    divider: '#26352d',
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
        containedPrimary: { '&:hover': { backgroundColor: '#ddf9ac' } },
        outlined: { borderColor: '#405347' },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiDialog: { styleOverrides: { paper: { backgroundColor: '#1b2721', border: '1px solid #405347', borderRadius: 14 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { fontSize: 14, borderRadius: 8, backgroundColor: 'rgba(17,26,22,0.6)' },
        notchedOutline: { borderColor: '#405347' },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontSize: 13, minHeight: 46 } } },
    MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 600, fontSize: 11 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none', fontSize: 13, minHeight: 36, borderColor: '#405347',
          '&.Mui-selected': { color: '#c9ef83', backgroundColor: 'rgba(201,239,131,0.14)' },
          '&.Mui-selected:hover': { backgroundColor: 'rgba(201,239,131,0.22)' },
        },
      },
    },
    MuiIconButton: { styleOverrides: { root: { minWidth: 40, minHeight: 40 } } },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: { backgroundColor: '#233129', border: '1px solid #405347', color: '#f6f5eb', fontSize: 12, fontWeight: 500, padding: '6px 10px' },
        arrow: { color: '#233129' },
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
  const [trackingProgress, setTrackingProgress] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState(null);
  const [watchAnalysis, setWatchAnalysis] = useState(false);

  // Ref to cancel/ignore stale async trajectory fetches when user rapidly switches videos
  const activeVideoFetchId = useRef(0);
  const retryInFlight = useRef(null);
  const [retrySubmitting, setRetrySubmitting] = useState(false);
  const [retryError, setRetryError] = useState('');

  const handleVideoSelect = useCallback(async (video) => {
    const fetchId = ++activeVideoFetchId.current;
    // Navigate immediately so user sees the video panel while trajectory loads
    retryInFlight.current = null;
    setRetrySubmitting(false);
    setRetryError('');
    setSelectedVideo(video);
    setTrajectoryData(null);
    setTrajectoryLoading(true);
    setTrajectoryError(null);
    setTrackingProgress(null);
    setAnalysisStatus(null);
    setWatchAnalysis(['processing', 'uploaded'].includes(video.status));
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
      if (err.response?.status === 404) setWatchAnalysis(true);
    } finally {
      if (fetchId === activeVideoFetchId.current) {
        setTrajectoryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedVideo || !watchAnalysis) return;
    const fetchId = activeVideoFetchId.current;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const progress = await api.get(`/videos/${selectedVideo.id}/progress`);
        if (cancelled || fetchId !== activeVideoFetchId.current) return;
        setTrackingProgress(progress.data.progress);
        setAnalysisStatus(progress.data);
        if (progress.data.job_state === 'failed' || ['error', 'failed'].includes(progress.data.status)) {
          if (!progress.data.has_previous_result) setTrajectoryError('processing_failed');
          setWatchAnalysis(false);
          return;
        }
        if (progress.data.status === 'processed') {
          const response = await api.get(`/videos/${selectedVideo.id}/trajectory`);
          if (cancelled || fetchId !== activeVideoFetchId.current) return;
          setTrajectoryData(response.data);
          setTrajectoryError(null);
          setWatchAnalysis(false);
          return;
        }
        timer = setTimeout(poll, 2500);
      } catch {
        if (!cancelled && fetchId === activeVideoFetchId.current) {
          setAnalysisStatus({ connection_error: true });
          timer = setTimeout(poll, 5000);
        }
      }
    };
    timer = setTimeout(poll, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedVideo, watchAnalysis]);

  const handleRetryAnalysis = useCallback(async () => {
    if (!selectedVideo || watchAnalysis || retryInFlight.current !== null) return;
    const fetchId = activeVideoFetchId.current;
    retryInFlight.current = fetchId;
    setRetrySubmitting(true);
    setRetryError('');
    try {
      await api.post(`/videos/${selectedVideo.id}/reprocess?sync=false`);
      if (fetchId !== activeVideoFetchId.current) return;
      setAnalysisStatus(null);
      setTrackingProgress(0);
      setTrajectoryError(trajectoryData ? null : 'not_processed');
      setWatchAnalysis(true);
    } catch (err) {
      if (fetchId !== activeVideoFetchId.current) return;
      if (err.response?.status === 409) {
        setWatchAnalysis(true);
      } else {
        setRetryError('Could not start analysis. Check your connection and try again.');
      }
    } finally {
      if (retryInFlight.current === fetchId) retryInFlight.current = null;
      if (fetchId === activeVideoFetchId.current) setRetrySubmitting(false);
    }
  }, [selectedVideo, watchAnalysis, trajectoryData]);

  const handleLaunchDemo = useCallback(() => {
    activeVideoFetchId.current++;
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
    setWatchAnalysis(false);
    setAnalysisStatus(null);
    setCurrentView('review');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    activeVideoFetchId.current++;
    setCurrentView('dashboard');
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
    setWatchAnalysis(false);
    setAnalysisStatus(null);
  }, []);

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
          trackingProgress={trackingProgress}
          analysisStatus={analysisStatus}
          analysisPending={watchAnalysis}
          retrySubmitting={retrySubmitting}
          retryError={retryError}
          onRetryAnalysis={handleRetryAnalysis}
          onBack={handleBackToDashboard}
        />
        </Suspense>
      )}
    </ThemeProvider>
  );
}

export default App;
