import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import {
  ThemeProvider, createTheme, CssBaseline, Alert, Button, Box,
  Paper, Typography, CircularProgress
} from '@mui/material';
import Dashboard from './pages/Dashboard';
import api from './api/client';

const DRSReview = lazy(() => import('./pages/DRSReview'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

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

const ROUTE_ERRORS = {
  auth: {
    severity: 'warning',
    title: 'Sign in to open this private delivery',
    message: 'This private delivery link requires an active session in the workspace that uploaded it.',
    guidance: 'Use the account that owns the delivery. Guest access is tied to the browser and expires after seven days for new sessions.',
  },
  missing: {
    severity: 'warning',
    title: 'Private delivery unavailable',
    message: 'This private delivery could not be found in your current workspace.',
    guidance: 'It may belong to a different workspace session or may have been deleted. Return to your dashboard to browse available clips, or launch the offline 3D simulation.',
    canRetry: false,
  },
  forbidden: {
    severity: 'warning',
    title: 'Private delivery unavailable',
    message: 'You do not have access to this private delivery in your current workspace.',
    guidance: 'Open this link in the workspace that owns the clip, or return to the dashboard or launch the offline 3D simulation.',
    canRetry: false,
  },
  error: {
    severity: 'error',
    title: 'Could not load private delivery',
    message: 'The delivery workspace could not be reached right now.',
    guidance: 'Check your connection to the analysis server and try again, or return to the dashboard or launch the offline 3D simulation.',
    canRetry: true,
  },
};

function getDeliveryIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('delivery')?.trim() || '';
}

function normalizeRouteUrl(clipId) {
  const params = new URLSearchParams(window.location.search);
  const target = clipId ? `/?delivery=${encodeURIComponent(clipId)}` : '/';
  const hasExtraParams = clipId
    ? Array.from(params.keys()).some(key => key !== 'delivery') || window.location.search !== `?delivery=${encodeURIComponent(clipId)}`
    : params.has('token') || params.has('access_token');
  if (hasExtraParams) {
    window.history.replaceState(null, '', target);
  }
}

function App() {
  const [currentView, setCurrentView] = useState(() => {
    const clipId = getDeliveryIdFromUrl();
    if (!clipId) return 'dashboard';
    return localStorage.getItem('token') ? 'route-loading' : 'route-error';
  });
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
  const routeNavId = useRef(0);
  const routeAbortRef = useRef(null);
  const retryInFlight = useRef(null);
  const [retrySubmitting, setRetrySubmitting] = useState(false);
  const [retryError, setRetryError] = useState('');

  const [routeError, setRouteError] = useState(() => {
    const clipId = getDeliveryIdFromUrl();
    if (!clipId || localStorage.getItem('token')) return null;
    return ROUTE_ERRORS.auth;
  });

  const cancelRouteRestore = useCallback(() => {
    routeNavId.current += 1;
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
  }, []);

  const resetReviewState = useCallback(() => {
    activeVideoFetchId.current += 1;
    retryInFlight.current = null;
    setRetrySubmitting(false);
    setRetryError('');
    setSelectedVideo(null);
    setTrajectoryData(null);
    setTrajectoryLoading(false);
    setTrajectoryError(null);
    setTrackingProgress(null);
    setAnalysisStatus(null);
    setWatchAnalysis(false);
  }, []);

  const openVideoReview = useCallback(async (video, updateRoute = true) => {
    if (!video?.id) return;
    cancelRouteRestore();
    setRouteError(null);
    if (updateRoute) {
      window.history.pushState(null, '', `/?delivery=${encodeURIComponent(video.id)}`);
    } else {
      normalizeRouteUrl(video.id);
    }
    resetReviewState();
    const fetchId = activeVideoFetchId.current;
    const requestToken = localStorage.getItem('token');
    setSelectedVideo(video);
    setTrajectoryLoading(true);
    setWatchAnalysis(['processing', 'uploaded'].includes(video.status));
    setCurrentView('review');

    try {
      const response = await api.get(`/videos/${video.id}/trajectory`);
      if (fetchId !== activeVideoFetchId.current) return;
      setTrajectoryData(response.data);
    } catch (err) {
      if (fetchId !== activeVideoFetchId.current) return;
      const status = err.response?.status;
      if (status === 401) {
        if (localStorage.getItem('token') === requestToken) localStorage.removeItem('token');
        resetReviewState();
        setRouteError(ROUTE_ERRORS.auth);
        setCurrentView('route-error');
        return;
      }
      if (status === 403) {
        resetReviewState();
        setRouteError(ROUTE_ERRORS.forbidden);
        setCurrentView('route-error');
        return;
      }
      console.error('Failed to load trajectory:', err);
      setTrajectoryData(null);
      // 404 = video not yet processed; anything else = real error
      setTrajectoryError(status === 404 ? 'not_processed' : 'load_error');
      if (status === 404) setWatchAnalysis(true);
    } finally {
      if (fetchId === activeVideoFetchId.current) {
        setTrajectoryLoading(false);
      }
    }
  }, [cancelRouteRestore, resetReviewState]);

  const handleVideoSelect = useCallback((video) => openVideoReview(video, true), [openVideoReview]);

  useEffect(() => {
    if (!selectedVideo || !watchAnalysis) return;
    const fetchId = activeVideoFetchId.current;
    let cancelled = false;
    let timer;
    const poll = async () => {
      const requestToken = localStorage.getItem('token');
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
      } catch (err) {
        if (cancelled || fetchId !== activeVideoFetchId.current) return;
        const status = err?.response?.status;
        if ([401, 403, 404].includes(status)) {
          if (status === 401 && localStorage.getItem('token') === requestToken) localStorage.removeItem('token');
          resetReviewState();
          setRouteError(status === 401 ? ROUTE_ERRORS.auth : status === 403 ? ROUTE_ERRORS.forbidden : ROUTE_ERRORS.missing);
          setCurrentView('route-error');
          return;
        }
        setAnalysisStatus({ connection_error: true });
        timer = setTimeout(poll, 5000);
      }
    };
    timer = setTimeout(poll, 2500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedVideo, watchAnalysis, resetReviewState]);

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
    cancelRouteRestore();
    setRouteError(null);
    window.history.pushState(null, '', '/');
    resetReviewState();
    setCurrentView('review');
  }, [cancelRouteRestore, resetReviewState]);

  const handleBackToDashboard = useCallback(() => {
    cancelRouteRestore();
    setRouteError(null);
    window.history.pushState(null, '', '/');
    resetReviewState();
    setCurrentView('dashboard');
  }, [cancelRouteRestore, resetReviewState]);

  const restoreFromUrl = useCallback(async () => {
    cancelRouteRestore();
    const request = routeNavId.current;
    const clipId = getDeliveryIdFromUrl();
    normalizeRouteUrl(clipId);
    resetReviewState();

    if (!clipId) {
      setRouteError(null);
      setCurrentView('dashboard');
      return;
    }

    if (!localStorage.getItem('token')) {
      setRouteError(ROUTE_ERRORS.auth);
      setCurrentView('route-error');
      return;
    }

    setRouteError(null);
    setCurrentView('route-loading');
    const controller = new AbortController();
    const requestToken = localStorage.getItem('token');
    routeAbortRef.current = controller;

    try {
      const { data: clip } = await api.get(`/videos/${encodeURIComponent(clipId)}`, { signal: controller.signal, timeout: 8000 });
      if (controller.signal.aborted || request !== routeNavId.current) return;
      if (clip?.id !== clipId) {
        setRouteError(ROUTE_ERRORS.missing);
        setCurrentView('route-error');
        return;
      }
      openVideoReview(clip, false);
    } catch (err) {
      if (controller.signal.aborted || request !== routeNavId.current) return;
      const status = err?.response?.status;
      if (status === 401) {
        if (localStorage.getItem('token') === requestToken) localStorage.removeItem('token');
        setRouteError(ROUTE_ERRORS.auth);
      } else if (status === 403) {
        setRouteError(ROUTE_ERRORS.forbidden);
      } else if (status === 404) {
        setRouteError(ROUTE_ERRORS.missing);
      } else {
        setRouteError(ROUTE_ERRORS.error);
      }
      setCurrentView('route-error');
    } finally {
      if (routeAbortRef.current === controller) {
        routeAbortRef.current = null;
      }
    }
  }, [cancelRouteRestore, resetReviewState, openVideoReview]);

  useEffect(() => {
    let mounted = true;
    const handlePopState = () => {
      if (mounted) restoreFromUrl();
    };
    const handleUnauthorized = () => {
      if (!mounted) return;
      const clipId = getDeliveryIdFromUrl();
      if (clipId) {
        cancelRouteRestore();
        resetReviewState();
        setRouteError(ROUTE_ERRORS.auth);
        setCurrentView('route-error');
      }
    };
    restoreFromUrl();
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      mounted = false;
      cancelRouteRestore();
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [restoreFromUrl, cancelRouteRestore, resetReviewState]);

  const openAccount = () => {
    cancelRouteRestore();
    setCurrentView('account');
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <a className="skip-link" href="#main-content">Skip to workspace</a>
      {currentView === 'account' ? (
        <Suspense fallback={<div role="status">Opening account access…</div>}>
          <AuthPage
            privateDelivery={Boolean(getDeliveryIdFromUrl())}
            onAuthSuccess={restoreFromUrl}
            onCancel={restoreFromUrl}
            onExploreDemo={handleLaunchDemo}
          />
        </Suspense>
      ) : currentView === 'route-loading' ? (
        <Box component="main" id="main-content" tabIndex={-1} sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3 }}>
          <Paper variant="outlined" sx={{ maxWidth: 480, width: '100%', p: 4, borderRadius: 3 }}>
            <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
              Crease / Lab · Private delivery
            </Typography>
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <CircularProgress size={20} />
              <Typography component="h1" variant="h5">Opening private delivery…</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Checking your workspace access and loading delivery details.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              <Button variant="outlined" onClick={handleBackToDashboard}>Return to dashboard</Button>
              <Button variant="text" onClick={handleLaunchDemo}>Launch offline simulation</Button>
            </Box>
          </Paper>
        </Box>
      ) : currentView === 'route-error' ? (
        <Box component="main" id="main-content" tabIndex={-1} sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3 }}>
          <Paper variant="outlined" sx={{ maxWidth: 520, width: '100%', p: 4, borderRadius: 3 }}>
            <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
              Crease / Lab · Private delivery
            </Typography>
            <Typography component="h1" variant="h5" sx={{ mb: 1.5 }}>
              {routeError?.title || ROUTE_ERRORS.error.title}
            </Typography>
            <Alert severity={routeError?.severity || 'warning'} sx={{ mb: 2 }}>
              {routeError?.message || ROUTE_ERRORS.error.message}
            </Alert>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {routeError?.guidance || ROUTE_ERRORS.error.guidance}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {routeError === ROUTE_ERRORS.auth && <Button variant="contained" onClick={openAccount}>Sign in</Button>}
              <Button variant="outlined" onClick={handleBackToDashboard}>Return to dashboard</Button>
              <Button variant="outlined" onClick={handleLaunchDemo}>Launch offline simulation</Button>
              {routeError?.canRetry && (
                <Button variant="text" onClick={restoreFromUrl}>Try again</Button>
              )}
            </Box>
          </Paper>
        </Box>
      ) : currentView === 'dashboard' ? (
        <Dashboard
          onVideoSelect={handleVideoSelect}
          onLaunchDemo={handleLaunchDemo}
          onOpenAccount={openAccount}
        />
      ) : (
        <Suspense fallback={<div role="status" style={{ padding: 32 }}>Opening review workspace…</div>}>
        <DRSReview
          key={selectedVideo?.id || 'simulation'}
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
