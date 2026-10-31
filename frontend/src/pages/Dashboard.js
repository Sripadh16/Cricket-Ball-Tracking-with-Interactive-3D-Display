import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, Paper, Grid, Chip, 
  CircularProgress, Alert, Dialog, LinearProgress, Fab
} from '@mui/material';
import {
  CloudUpload, Videocam, PlayArrow, Refresh, Delete, Logout,
  CheckCircle, Error as ErrorIcon, Schedule, Close, Stop,
  CameraAlt, FlipCameraIos, SportsCricket
} from '@mui/icons-material';
import api from '../api/client';

function VideoRecorder({ open, onClose, onRecorded }) {
  const videoRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [countdown, setCountdown] = useState(0);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      stopCamera();
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Camera error:', err);
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open) startCamera();
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  const startRecording = () => {
    if (!stream) return;
    
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          beginRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const beginRecording = () => {
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    mediaRecorderRef.current = mediaRecorder;
    const recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      onRecorded(blob);
      handleClose();
    };

    mediaRecorder.start();
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const flipCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleClose = () => {
    stopCamera();
    setRecording(false);
    setCountdown(0);
    onClose();
  };

  return (
    <Dialog fullScreen open={open} onClose={handleClose}>
      <Box sx={{ height: '100%', bgcolor: 'black', position: 'relative' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {countdown > 0 && (
          <Box sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.5)'
          }}>
            <Typography variant="h1" sx={{ color: 'white', fontWeight: 700 }}>
              {countdown}
            </Typography>
          </Box>
        )}

        {/* Controls */}
        <Box sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 3,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
          display: 'flex',
          justifyContent: 'space-around',
          alignItems: 'center'
        }}>
          <IconButton onClick={handleClose} sx={{ color: 'white' }}>
            <Close sx={{ fontSize: 32 }} />
          </IconButton>

          <Fab
            color={recording ? 'error' : 'primary'}
            onClick={recording ? stopRecording : startRecording}
            sx={{ width: 72, height: 72 }}
          >
            {recording ? <Stop sx={{ fontSize: 36 }} /> : <Videocam sx={{ fontSize: 36 }} />}
          </Fab>

          <IconButton onClick={flipCamera} sx={{ color: 'white' }} disabled={recording}>
            <FlipCameraIos sx={{ fontSize: 32 }} />
          </IconButton>
        </Box>

        {recording && (
          <Chip
            label="REC"
            size="small"
            sx={{
              position: 'absolute',
              top: 16,
              right: 16,
              bgcolor: '#e63946',
              color: 'white',
              fontWeight: 700,
              animation: 'pulse 1s infinite'
            }}
          />
        )}
      </Box>
    </Dialog>
  );
}

function Dashboard({ onVideoSelect, onLaunchDemo, onLogout }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async () => {
    setLoading(true);
    try {
      const response = await api.get('/videos');
      setVideos(response.data.videos || []);
    } catch (err) {
      setError('Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  const uploadVideo = async (file) => {
    setUploading(true);
    setUploadProgress(0);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      await api.post('/videos/upload', formData, {
        onUploadProgress: (e) => {
          setUploadProgress(Math.round((e.loaded * 100) / e.total));
        }
      });
      await loadVideos();
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadVideo(file);
    e.target.value = '';
  };

  const handleRecorded = (blob) => {
    const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'video/webm' });
    uploadVideo(file);
  };

  const handleDelete = async (videoId, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this video?')) return;
    
    try {
      await api.delete(`/videos/${videoId}`);
      await loadVideos();
    } catch (err) {
      setError('Failed to delete video');
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processed': return <CheckCircle sx={{ color: '#4ade80', fontSize: 18 }} />;
      case 'processing': return <Schedule sx={{ color: '#fbbf24', fontSize: 18 }} />;
      case 'error': return <ErrorIcon sx={{ color: '#ef4444', fontSize: 18 }} />;
      default: return <Schedule sx={{ color: '#94a3b8', fontSize: 18 }} />;
    }
  };

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#f8f9fa' }}>
      {/* Header */}
      <Box sx={{ 
        bgcolor: '#1a472a', 
        color: 'white', 
        p: 2,
        pt: 'calc(env(safe-area-inset-top) + 16px)'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Cricket DRS
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Ball Tracking System
            </Typography>
          </Box>
          <IconButton onClick={onLogout} sx={{ color: 'white' }}>
            <Logout />
          </IconButton>
        </Box>
      </Box>

      {/* Featured 3D Hawk-Eye Simulator Card */}
      <Box sx={{ px: 2, pt: 2 }}>
        <Paper
          sx={{
            p: 2.5,
            background: 'linear-gradient(135deg, #0a1626 0%, #172d4a 100%)',
            color: 'white',
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SportsCricket sx={{ color: '#e63946', fontSize: 28 }} />
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.05rem' }}>
                Interactive 3D Hawk-Eye Simulator
              </Typography>
            </Box>
            <Chip
              label="CV + CG Demo"
              size="small"
              sx={{ bgcolor: '#e63946', color: 'white', fontWeight: 700, fontSize: '0.72rem' }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#cbd5e1', mb: 2, fontSize: '0.85rem', lineHeight: 1.5 }}>
            Explore physics-modeled 3D deliveries (Inswinger LBW, Off-Cutter Bowled, Bouncer, Leg Spin), segmented trajectory arcs (pre/post bounce, impact & stumps extrapolation), multi-angle cameras (Chase Cam, Batsman POV, Umpire), and DRS verdicts.
          </Typography>
          <Button
            variant="contained"
            fullWidth
            onClick={onLaunchDemo}
            startIcon={<SportsCricket />}
            sx={{
              bgcolor: '#e63946',
              py: 1.2,
              fontWeight: 700,
              fontSize: '0.9rem',
              '&:hover': { bgcolor: '#c1121f' }
            }}
          >
            Launch Interactive 3D Simulator
          </Button>
        </Paper>
      </Box>

      {/* Action Buttons */}
      <Box sx={{ p: 2, display: 'flex', gap: 1.5 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<CloudUpload />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          sx={{ bgcolor: '#1a472a', py: 1.5 }}
        >
          Upload Video
        </Button>
        <Button
          fullWidth
          variant="outlined"
          startIcon={<Videocam />}
          onClick={() => setShowRecorder(true)}
          disabled={uploading}
          sx={{ borderColor: '#1a472a', color: '#1a472a', py: 1.5 }}
        >
          Record Live
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          hidden
          onChange={handleFileSelect}
        />
      </Box>

      {/* Upload Progress */}
      {uploading && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Uploading & Processing... {uploadProgress}%
            </Typography>
            <LinearProgress variant="determinate" value={uploadProgress} />
          </Paper>
        </Box>
      )}

      {/* Error Alert */}
      {error && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        </Box>
      )}

      {/* Videos List */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, pb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Your Videos ({videos.length})
          </Typography>
          <IconButton onClick={loadVideos} size="small">
            <Refresh />
          </IconButton>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : videos.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center' }}>
            <CameraAlt sx={{ fontSize: 48, color: '#94a3b8', mb: 2 }} />
            <Typography variant="body1" color="textSecondary">
              No videos yet. Upload or record a cricket video to get started.
            </Typography>
          </Paper>
        ) : (
          <Grid container spacing={2}>
            {videos.map((video) => (
              <Grid item xs={12} sm={6} md={4} key={video.id}>
                <Paper
                  onClick={() => video.status === 'processed' && onVideoSelect(video)}
                  sx={{
                    p: 2,
                    cursor: video.status === 'processed' ? 'pointer' : 'default',
                    transition: 'all 0.2s',
                    '&:hover': video.status === 'processed' ? {
                      transform: 'translateY(-2px)',
                      boxShadow: 3
                    } : {}
                  }}
                >
                  {/* Thumbnail */}
                  <Box sx={{
                    height: 120,
                    bgcolor: '#1a472a',
                    borderRadius: 1,
                    mb: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    overflow: 'hidden'
                  }}>
                    {video.status === 'processed' ? (
                      <PlayArrow sx={{ color: 'white', fontSize: 48 }} />
                    ) : video.status === 'processing' ? (
                      <CircularProgress size={32} sx={{ color: 'white' }} />
                    ) : (
                      <ErrorIcon sx={{ color: '#ef4444', fontSize: 36 }} />
                    )}
                  </Box>

                  {/* Info */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontWeight: 600, 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis', 
                          whiteSpace: 'nowrap' 
                        }}
                      >
                        {video.original_filename || video.filename}
                      </Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                        {getStatusIcon(video.status)}
                        <Typography variant="caption" color="textSecondary">
                          {video.status === 'processed' ? 'Ready' : video.status}
                        </Typography>
                      </Box>
                    </Box>
                    <IconButton 
                      size="small" 
                      onClick={(e) => handleDelete(video.id, e)}
                      sx={{ ml: 1 }}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Box>
                </Paper>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      {/* Video Recorder Dialog */}
      <VideoRecorder
        open={showRecorder}
        onClose={() => setShowRecorder(false)}
        onRecorded={handleRecorded}
      />
    </Box>
  );
}

export default Dashboard;
