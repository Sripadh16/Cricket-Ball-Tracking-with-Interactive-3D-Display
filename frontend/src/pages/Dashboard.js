import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, Chip, Skeleton, TextField, InputAdornment, Tooltip, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, Dialog, LinearProgress, Fab
} from '@mui/material';
import {
  CloudUpload, Videocam, Refresh, Delete,
  Close, Stop, PlayArrow,
  FlipCameraIos, SportsCricket, ArrowForward, Search, VideoLibrary
} from '@mui/icons-material';
import api, { ensureGuestSession, MAX_UPLOAD_SIZE_MB } from '../api/client';

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
    if (!stream || countdownIntervalRef.current) return;

    let remaining = 3;
    setCountdown(remaining);
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
        beginRecording();
      }
    }, 1000);
  };

  const beginRecording = () => {
    // stopCamera() stops the stream tracks and clears the countdown interval/state.
    const failRecording = (message) => {
      mediaRecorderRef.current = null;
      stopCamera();
      setRecording(false);
      setCameraError(message);
    };
    if (!stream || typeof MediaRecorder === 'undefined') {
      failRecording('Recording is not supported in this browser.');
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported?.('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    let mediaRecorder;
    try {
      mediaRecorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      failRecording(`Recording could not start: ${err.message || 'unsupported video format'}.`);
      return;
    }
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

    try {
      mediaRecorder.start();
    } catch (err) {
      failRecording(`Recording could not start: ${err.message || 'recorder error'}.`);
      return;
    }
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
              bgcolor: 'error.main',
              color: '#1c0606',
              fontWeight: 700,
              animation: 'pulse 1s infinite'
            }}
          />
        )}
      </Box>
    </Dialog>
  );
}


function Dashboard({ onVideoSelect, onLaunchDemo }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [libraryError, setLibraryError] = useState(false);
  const [showRecorder, setShowRecorder] = useState(false);
  const [reprocessingId, setReprocessingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const loadVideos = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      await ensureGuestSession();
      const requestVideos = () => api.get('/videos/', { timeout: 8000 });
      const response = await requestVideos().catch(async err => {
        if (err.response?.status !== 401) throw err;
        await ensureGuestSession();
        return requestVideos();
      });
      setVideos(response.data.videos || []);
      setLibraryError(false);
    } catch {
      setLibraryError(true);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);
  const hasProcessing = videos.some(v => v.status === 'processing' || v.status === 'uploaded') || reprocessingId !== null;
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => loadVideos(false), 2500);
    return () => clearInterval(timer);
  }, [hasProcessing, loadVideos]);

  const uploadVideo = async (file) => {
    if (uploading) return;
    if (!/\.(mp4|mov|avi|mkv|webm)$/i.test(file.name)) {
      setError('Choose an MP4, MOV, AVI, MKV or WebM video.');
      return;
    }
    if (file.size > MAX_UPLOAD_SIZE_MB * 1024 * 1024) {
      setError('This clip exceeds the ' + MAX_UPLOAD_SIZE_MB + ' MB limit. Choose a smaller file.');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError('');
    const formData = new FormData();
    formData.append('file', file);
    try {
      await ensureGuestSession();
      const res = await api.post('/videos/upload', formData, { onUploadProgress: e => {
        if (e.total) setUploadProgress(Math.min(100, Math.round(e.loaded * 100 / e.total)));
      }});
      if (res.data?.id) {
        onVideoSelect(res.data);
      } else {
        await loadVideos(false);
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Upload failed. Your clip was not added. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleReprocess = async (video) => {
    setReprocessingId(video.id);
    setError('');
    try {
      await api.post('/videos/' + video.id + '/reprocess', null, { params: { sync: false } });
      await loadVideos(false);
    } catch (err) {
      setError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : 'Could not reprocess this delivery. Please try again.');
    } finally { setReprocessingId(null); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete('/videos/' + deleteTarget.id);
      setDeleteTarget(null);
      await loadVideos(false);
    } catch (err) { setError('Could not delete this delivery. Please try again.'); }
    finally { setDeleting(false); }
  };

  const visibleVideos = videos.filter(v => (v.original_filename || v.filename || '').toLowerCase().includes(query.toLowerCase()));
  const readyCount = videos.filter(v => v.status === 'processed').length;
  const formatSize = bytes => bytes == null ? 'Size unavailable' : (bytes / 1024 / 1024).toFixed(1) + ' MB';

  return (
    <div className="studio">
      <nav className="studio-nav" aria-label="Workspace navigation">
        <a href="#main-content" className="wordmark">
          <span className="brand-symbol"><SportsCricket sx={{ fontSize: 18 }} /></span>
          <span>crease<span className="brand-divider">/</span>lab</span>
        </a>
        <div className="nav-links">
          <a href="#deliveries">Delivery library</a>
          <Button variant="outlined" color="inherit" onClick={() => fileInputRef.current?.click()}
            disabled={uploading} startIcon={<CloudUpload fontSize="small" />}>Upload clip</Button>
        </div>
      </nav>
      <main id="main-content" className="studio-main" tabIndex={-1}>
        <header className="studio-hero">
          <div className="studio-hero-copy">
            <span className="eyebrow">Cricket ball tracking &amp; DRS</span>
            <h1>Every delivery,<br /><em>in detail.</em></h1>
            <p>Follow the ball from release to wicket. Replay a simulated delivery in 3D or track the ball in your own footage.</p>
            <Button variant="contained" size="large" onClick={onLaunchDemo} startIcon={<PlayArrow />}>
              Launch simulation
            </Button>
          </div>
          <figure className="studio-hero-visual">
            <img src={process.env.PUBLIC_URL + '/delivery-preview.webp'} width="1280" height="853"
              alt="Illustrated ball path bouncing on a cricket pitch and curving toward the stumps" />
            <figcaption>Trajectory illustration</figcaption>
          </figure>
        </header>
        <section className={'upload-panel' + (dragging ? ' is-dragging' : '')} aria-labelledby="upload-heading"
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
          onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) uploadVideo(file); }}>
          <div className="upload-icon"><CloudUpload /></div>
          <div className="upload-copy">
            <h2 id="upload-heading">Analyse a delivery</h2>
            <p>Drop a clip here or choose a file. Use a fixed camera and keep the ball in view.</p>
            <span className="upload-formats">H.264 MP4 or WebM recommended · up to {MAX_UPLOAD_SIZE_MB} MB</span>
          </div>
          <div className="upload-actions">
            <Button variant="outlined" color="inherit" startIcon={<Videocam fontSize="small" />} disabled={uploading} onClick={() => setShowRecorder(true)}>
              Record clip
            </Button>
            <Button variant="contained" disabled={uploading} onClick={() => fileInputRef.current.click()} endIcon={<ArrowForward fontSize="small" />}>
              Choose file
            </Button>
          </div>
          <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.mkv,.webm" hidden aria-label="Choose cricket video" onChange={e => { const file = e.target.files?.[0]; if (file) uploadVideo(file); e.target.value = ''; }} />
          {uploading && <Box className="upload-progress" role="status"><Typography variant="caption">{uploadProgress < 100 ? 'Uploading clip · ' + uploadProgress + '%' : 'Upload received · preparing analysis…'}</Typography><LinearProgress sx={{ mt: 1 }} variant={uploadProgress < 100 ? 'determinate' : 'indeterminate'} value={uploadProgress} /></Box>}
        </section>
        {error && <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>{error}</Alert>}
        <section id="deliveries" className="delivery-library" aria-labelledby="library-heading">
          <div className="library-heading">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 id="library-heading">Your deliveries</h2><span className="library-count">{loading || libraryError ? '—' : readyCount + ' ready / ' + videos.length + ' total'}</span></div>
            <div className="library-tools"><TextField size="small" placeholder="Find a delivery" value={query} onChange={e => setQuery(e.target.value)} inputProps={{ 'aria-label': 'Search deliveries' }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} /><Tooltip title="Refresh deliveries"><span><IconButton onClick={() => loadVideos()} aria-label="Refresh deliveries" disabled={loading}><Refresh fontSize="small" /></IconButton></span></Tooltip></div>
          </div>
          {loading ? <Box aria-label="Loading deliveries" role="status">{[0, 1, 2].map(i => <Skeleton key={i} variant="rounded" height={72} sx={{ mb: 1 }} />)}</Box> : libraryError ? (
            <Alert severity="warning" action={<Button size="small" color="inherit" onClick={() => loadVideos()}>Retry</Button>}>
              Could not load the delivery library. Check the analysis server connection.
            </Alert>
          ) : visibleVideos.length === 0 ? (
            <div className="empty-library"><VideoLibrary sx={{ color: 'var(--accent)', fontSize: 30 }} /><h3>{query ? 'No matching deliveries.' : 'No deliveries yet'}</h3><p>{query ? 'Try another filename or clear your search.' : 'Your clips and analysis appear here after upload.'}</p><Button variant="outlined" onClick={() => query ? setQuery('') : fileInputRef.current.click()}>{query ? 'Clear search' : 'Choose your first clip'}</Button></div>
          ) : <div className="library-list">{visibleVideos.map(video => {
            const name = video.original_filename || video.filename;
            const busy = video.status === 'processing' || reprocessingId === video.id;
            const ready = video.status === 'processed' && !busy;
            const failed = video.status === 'error' || video.status === 'failed';
            return <article key={video.id} className="delivery-row">
              <div className="delivery-thumb" aria-hidden="true">{busy ? <CircularProgress size={18} /> : <Videocam fontSize="small" />}</div>
              <div style={{ minWidth: 0 }}><button className="delivery-name" onClick={() => onVideoSelect(video)} disabled={uploading} title={name}>{name}</button><div className="delivery-meta">{formatSize(video.file_size)}{(video.created_at || video.upload_date) ? ' · ' + new Date(video.created_at || video.upload_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</div></div>
              <div className="delivery-status status-label" style={{ color: busy ? 'var(--warn)' : ready ? (video.ball_detected === false ? 'var(--warn)' : 'var(--good)') : failed ? 'var(--bad)' : 'var(--muted)' }}><span className="status-dot" /><span>{busy ? 'Analysing' : ready ? (video.ball_detected === false ? 'No ball detected' : 'Ready to review') : failed ? 'Needs attention' : 'Uploaded'}</span></div>
              <div className="delivery-actions"><Tooltip title="Reprocess clip"><span><IconButton aria-label={'Reprocess ' + name} disabled={busy} onClick={() => handleReprocess(video)}><Refresh fontSize="small" /></IconButton></span></Tooltip><Tooltip title="Delete clip"><span><IconButton aria-label={'Delete ' + name} disabled={busy} onClick={() => setDeleteTarget(video)}><Delete sx={{ fontSize: 18 }} /></IconButton></span></Tooltip><Tooltip title={ready ? 'Open analysis' : 'Open source video'}><IconButton aria-label={'Open analysis for ' + name} onClick={() => onVideoSelect(video)} sx={{ color: 'primary.main' }}><ArrowForward sx={{ fontSize: 18 }} /></IconButton></Tooltip></div>
            </article>;
          })}</div>}
        </section>
      </main>
      <VideoRecorder open={showRecorder} onClose={() => setShowRecorder(false)} onRecorded={blob => uploadVideo(new File([blob], 'delivery-' + Date.now() + '.webm', { type: 'video/webm' }))} />
      <Dialog open={!!deleteTarget} onClose={() => { if (!deleting) setDeleteTarget(null); }} aria-labelledby="delete-delivery-title" maxWidth="xs" fullWidth>
        <DialogTitle id="delete-delivery-title">Delete this delivery?</DialogTitle><DialogContent><Typography variant="body2" color="text.secondary">{deleteTarget?.original_filename || deleteTarget?.filename} and its analysis will be permanently removed.</Typography></DialogContent><DialogActions sx={{ p: 2 }}><Button onClick={() => setDeleteTarget(null)} disabled={deleting} color="inherit">Keep delivery</Button><Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete delivery'}</Button></DialogActions>
      </Dialog>
    </div>
  );
}

export default Dashboard;
