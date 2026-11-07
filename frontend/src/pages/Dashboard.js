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
  const countdownIntervalRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [stream, setStream] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [countdown, setCountdown] = useState(0);
  const [cameraError, setCameraError] = useState(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStream(null);
    }
    // Clear any pending countdown
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setCountdown(0);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      stopCamera();
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false   // audio not needed for ball tracking
      });
      streamRef.current = mediaStream;
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      // Surface camera errors so the user knows what's wrong
      const msg = err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow camera access and try again.'
        : err.name === 'NotFoundError'
        ? 'No camera found on this device.'
        : `Camera error: ${err.message}`;
      setCameraError(msg);
    }
  }, [facingMode, stopCamera]);

  useEffect(() => {
    if (open) startCamera();
    return () => stopCamera();
  }, [open, startCamera, stopCamera]);

  const startRecording = () => {
    if (!stream) return;

    setCountdown(3);
    countdownIntervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownIntervalRef.current);
          countdownIntervalRef.current = null;
          beginRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const beginRecording = () => {
    if (!stream) return;
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = mediaRecorder;
    const recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType });
      onRecorded(blob);
      handleClose();
    };

    mediaRecorder.start();
    setRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const flipCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleClose = () => {
    if (recording) stopRecording();
    stopCamera();
    setRecording(false);
    setCameraError(null);
    onClose();
  };

  return (
    <Dialog fullScreen open={open} onClose={handleClose}>
      <Box sx={{ height: '100%', bgcolor: 'black', position: 'relative' }}>
        {cameraError ? (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, gap: 2 }}>
            <Typography sx={{ color: '#ef4444', textAlign: 'center' }}>{cameraError}</Typography>
            <Button variant="outlined" sx={{ color: 'white', borderColor: 'white' }} onClick={startCamera}>
              Retry
            </Button>
            <Button sx={{ color: '#94a3b8' }} onClick={handleClose}>Close</Button>
          </Box>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}

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
          <IconButton onClick={handleClose} sx={{ color: 'white' }} aria-label="Close recorder">
            <Close sx={{ fontSize: 32 }} />
          </IconButton>

          <Fab
            color={recording ? 'error' : 'primary'}
            onClick={recording ? stopRecording : startRecording}
            disabled={!stream || countdown > 0}
            sx={{ width: 72, height: 72 }}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
          >
            {recording ? <Stop sx={{ fontSize: 36 }} /> : <Videocam sx={{ fontSize: 36 }} />}
          </Fab>

          <IconButton onClick={flipCamera} sx={{ color: 'white' }} disabled={recording} aria-label="Flip camera">
            <FlipCameraIos sx={{ fontSize: 32 }} />
          </IconButton>
        </Box>

        {recording && (
          <Chip
            label="● REC"
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
  const [reprocessingId, setReprocessingId] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadVideos();
  }, []);

  const loadVideos = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await api.get('/videos');
      setVideos(response.data.videos || []);
    } catch (err) {
      if (showSpinner) setError('Failed to load videos');
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  // Poll video status automatically when any video is processing in the background
  useEffect(() => {
    const hasProcessing = videos.some(v => v.status === 'processing') || reprocessingId !== null;
    if (!hasProcessing) return;

    const timer = setInterval(() => {
      loadVideos(false);
    }, 2500);

    return () => clearInterval(timer);
  }, [videos, reprocessingId]);

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
    if (!window.confirm('Delete this video and its trajectory data?')) return;

    try {
      await api.delete(`/videos/${videoId}`);
      await loadVideos();
    } catch (err) {
      setError('Failed to delete video');
    }
  };

  const handleReprocess = async (videoId, e) => {
    e.stopPropagation();
    setReprocessingId(videoId);
    setError(null);
    try {
      await api.post(`/videos/${videoId}/reprocess`);
      await loadVideos();
    } catch (err) {
      setError(err.response?.data?.detail || 'Reprocess failed');
    } finally {
      setReprocessingId(null);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'processed': return <CheckCircle sx={{ color: '#4ade80', fontSize: 18 }} />;
      case 'processing': return <Schedule sx={{ color: '#fbbf24', fontSize: 18 }} />;
      case 'error':
      case 'failed':   return <ErrorIcon sx={{ color: '#ef4444', fontSize: 18 }} />;
      default: return <Schedule sx={{ color: '#94a3b8', fontSize: 18 }} />;
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
              Ball Tracking — CV + 3D Graphics Demo
            </Typography>
          </Box>
          <IconButton onClick={onLogout} sx={{ color: 'white' }} aria-label="Log out">
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
                Physics Simulation — Explore 3D Trajectories
              </Typography>
            </Box>
            <Chip
              label="SIMULATION"
              size="small"
              sx={{ bgcolor: 'rgba(34,197,94,0.3)', color: '#4ade80', fontWeight: 700, fontSize: '0.72rem', border: '1px solid rgba(34,197,94,0.5)' }}
            />
          </Box>
          <Typography variant="body2" sx={{ color: '#cbd5e1', mb: 2, fontSize: '0.85rem', lineHeight: 1.5 }}>
            Explore physics-modeled 3D deliveries — inswinger LBW, off-cutter, bouncer, leg break. 
            Segmented trajectory arcs, multi-angle cameras and DRS intersections. 
            <strong style={{ color: '#fbbf24' }}> Simulated data only — not CV output.</strong>
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
          aria-label="Upload video file"
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
          aria-label="Record from camera"
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

      {/* Capture instructions */}
      <Box sx={{ px: 2, pb: 1 }}>
        <Typography variant="caption" sx={{ color: '#64748b', lineHeight: 1.6, display: 'block' }}>
          💡 <strong>Best results:</strong> stationary camera, good contrast between ball and background, 
          one delivery per clip (max 300 frames analysed). MP4/MOV/AVI/MKV/WebM supported (up to 500 MB).
        </Typography>
      </Box>

      {/* Upload Progress */}
      {uploading && (
        <Box sx={{ px: 2, pb: 2 }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Uploading &amp; Processing… {uploadProgress}%
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
          <IconButton onClick={loadVideos} size="small" aria-label="Refresh video list">
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
            <Typography variant="body1" color="textSecondary" gutterBottom>
              No videos yet.
            </Typography>
            <Typography variant="body2" color="textSecondary">
              Upload or record a cricket clip to analyse ball tracking. 
              Use the simulator above to explore 3D trajectory physics without uploading.
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
                  {/* Thumbnail placeholder */}
                  <Box sx={{
                    height: 100,
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
                    ) : video.status === 'processing' || reprocessingId === video.id ? (
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
                          {video.file_size ? ` · ${formatSize(video.file_size)}` : ''}
                        </Typography>
                      </Box>
                    </Box>

                    {/* Action buttons */}
                    <Box sx={{ display: 'flex', gap: 0.3 }}>
                      {(video.status === 'processed' || video.status === 'error' || video.status === 'failed') && (
                        <IconButton
                          size="small"
                          onClick={(e) => handleReprocess(video.id, e)}
                          disabled={reprocessingId === video.id}
                          aria-label={`Reprocess ${video.original_filename || video.filename}`}
                          title="Reprocess video"
                        >
                          <Refresh fontSize="small" />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={(e) => handleDelete(video.id, e)}
                        aria-label={`Delete ${video.original_filename || video.filename}`}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Box>
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
