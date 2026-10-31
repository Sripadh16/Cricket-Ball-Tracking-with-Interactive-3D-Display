import React, { useState, useEffect, useCallback } from 'react';
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
    setCurrentView('dashboard');
  }, []);

  const handleVideoSelect = useCallback(async (video) => {
    setSelectedVideo(video);
    setCurrentView('review');
    
    try {
      const response = await api.get(`/videos/${video.id}/trajectory`);
      setTrajectoryData(response.data);
    } catch (err) {
      console.error('Failed to load trajectory:', err);
      setTrajectoryData(null);
    }
  }, []);

  const handleLaunchDemo = useCallback(() => {
    setSelectedVideo(null);
    setTrajectoryData(null);
    setCurrentView('review');
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setCurrentView('dashboard');
    setSelectedVideo(null);
    setTrajectoryData(null);
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
          onBack={handleBackToDashboard}
        />
      )}
    </ThemeProvider>
  );
}

export default App;
