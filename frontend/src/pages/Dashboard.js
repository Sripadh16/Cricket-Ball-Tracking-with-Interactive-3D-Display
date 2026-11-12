import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, Chip, Skeleton, TextField, InputAdornment, Tooltip, DialogTitle, DialogContent, DialogActions,
  CircularProgress, Alert, Dialog, LinearProgress, Fab
} from '@mui/material';
import {
  CloudUpload, Videocam, Refresh, Delete, Logout,
  Close, Stop,
  FlipCameraIos, SportsCricket, ArrowForward, Search, InfoOutlined, VideoLibrary
} from '@mui/icons-material';
import api, { API_BASE_URL, MAX_UPLOAD_SIZE_MB } from '../api/client';
import PitchDiagram from '../components/PitchDiagram';

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
  const [error, setError] = useState('');
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
      const response = await api.get('/videos/');
      setVideos(response.data.videos || []);
      setError('');
    } catch (err) {
      setError(err.response?.status === 401 ? 'Your session has expired. Sign in again to access your clips.' : 'Could not load your deliveries. Check the connection and refresh.');
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
      await api.post('/videos/upload', formData, { onUploadProgress: e => {
        if (e.total) setUploadProgress(Math.min(100, Math.round(e.loaded * 100 / e.total)));
      }});
      await loadVideos(false);
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
      await api.post('/videos/' + video.id + '/reprocess');
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
  const token = localStorage.getItem('token');

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <nav className="studio-nav" aria-label="Workspace navigation">
        <div className="wordmark"><span className="brand-symbol"><SportsCricket sx={{ fontSize: 17 }} /></span>crease<span className="muted" style={{ fontWeight: 400 }}>/ lab</span></div>
        <div className="nav-links">
          <span className="nav-active" aria-current="page">Workspace</span>
          <Button size="small" color="inherit" onClick={onLaunchDemo}>Simulation <ArrowForward sx={{ fontSize: 15, ml: 1 }} /></Button>
          <Tooltip title="Sign out"><IconButton onClick={onLogout} aria-label="Sign out"><Logout fontSize="small" /></IconButton></Tooltip>
        </div>
      </nav>
      <main id="main-content" className="studio-main" tabIndex={-1}>
        <header className="page-intro">
          <div><h1>Your delivery workspace</h1><p>Upload a clip, review the track, and inspect the evidence.</p></div>
          <span className="eyebrow nav-context" style={{ color: '#adb8c7' }}>Computer vision / 3D visualization</span>
        </header>
        <div className="workspace-grid">
          <section className={'upload-panel' + (dragging ? ' is-dragging' : '')} aria-labelledby="upload-heading"
            onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
            onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) uploadVideo(file); }}>
            <div className="upload-icon"><CloudUpload fontSize="small" /></div>
            <h2 id="upload-heading">Upload a delivery</h2><p>Drop a clip here, or choose a file to start tracking.<br />MP4, MOV, AVI, MKV, WebM · Up to {MAX_UPLOAD_SIZE_MB} MB</p>
            <div className="upload-actions"><Button variant="contained" onClick={() => fileInputRef.current.click()} disabled={uploading} startIcon={<CloudUpload fontSize="small" />}>Upload delivery</Button><Button color="inherit" startIcon={<Videocam fontSize="small" />} disabled={uploading} onClick={() => setShowRecorder(true)}>Record</Button></div>
            <input ref={fileInputRef} type="file" accept=".mp4,.mov,.avi,.mkv,.webm" hidden aria-label="Choose cricket video" onChange={e => { const file = e.target.files?.[0]; if (file) uploadVideo(file); e.target.value = ''; }} />
            {uploading && <Box sx={{ width: '100%', mt: 2 }} role="status"><Typography variant="caption">{uploadProgress < 100 ? 'Uploading clip · ' + uploadProgress + '%' : 'Upload received · preparing analysis…'}</Typography><LinearProgress sx={{ mt: 1 }} variant={uploadProgress < 100 ? 'determinate' : 'indeterminate'} value={uploadProgress} /></Box>}
          </section>
          <section className="simulation-panel" aria-labelledby="simulation-heading">
            <PitchDiagram />
            <div className="simulation-copy">
              <div className="simulation-copy-text">
                <h2 id="simulation-heading">Explore simulated deliveries in 3D</h2>
                <p>No upload needed. Four preset deliveries with physics simulation.</p>
              </div>
              <Button variant="outlined" size="small" endIcon={<ArrowForward />} onClick={onLaunchDemo} sx={{ flexShrink: 0 }}>Explore in 3D</Button>
            </div>
          </section>
        </div>
        <p className="capture-note"><InfoOutlined sx={{ fontSize: 16, mt: .2 }} /><span>For a clearer track: use a fixed camera, keep the ball visible, and capture one delivery per clip. Reconstructed 3D positions are approximate.</span></p>
        {error && <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError('')} action={<Button size="small" color="inherit" onClick={() => localStorage.getItem('token') ? loadVideos() : onLogout()}>{localStorage.getItem('token') ? 'Retry' : 'Sign in'}</Button>}>{error}</Alert>}
        <section aria-labelledby="library-heading">
          <div className="library-heading">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}><h2 id="library-heading">Your deliveries</h2><span className="muted mono" style={{ fontSize: 11 }}>{loading ? '—' : readyCount + ' ready / ' + videos.length + ' total'}</span></div>
            <div className="library-tools"><TextField size="small" placeholder="Find a delivery" value={query} onChange={e => setQuery(e.target.value)} inputProps={{ 'aria-label': 'Search deliveries' }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} /><Tooltip title="Refresh deliveries"><IconButton onClick={() => loadVideos()} aria-label="Refresh deliveries" disabled={loading}><Refresh fontSize="small" /></IconButton></Tooltip></div>
          </div>
          {loading ? <Box aria-label="Loading deliveries" role="status">{[0, 1, 2].map(i => <Skeleton key={i} variant="rounded" height={72} sx={{ mb: 1 }} />)}</Box> : visibleVideos.length === 0 ? (
            <div className="empty-library"><VideoLibrary sx={{ color: '#879c77', fontSize: 30 }} /><h3>{query ? 'No matching deliveries.' : 'Your first delivery starts here.'}</h3><p>{query ? 'Try another filename or clear your search.' : 'Upload a clip to build your library, or take a look around the simulation lab first.'}</p><Button variant="outlined" onClick={() => query ? setQuery('') : fileInputRef.current.click()}>{query ? 'Clear search' : 'Choose your first clip'}</Button></div>
          ) : <div className="library-list">{visibleVideos.map(video => {
            const name = video.original_filename || video.filename;
            const busy = video.status === 'processing' || reprocessingId === video.id;
            const ready = video.status === 'processed' && !busy;
            const failed = video.status === 'error' || video.status === 'failed';
            return <article key={video.id} className="delivery-row">
              <div className="delivery-thumb" aria-hidden="true">{ready ? <video src={API_BASE_URL + '/videos/' + video.id + '/stream?token=' + encodeURIComponent(token || '')} preload="metadata" muted playsInline /> : busy ? <CircularProgress size={18} /> : <Videocam fontSize="small" />}</div>
              <div style={{ minWidth: 0 }}><button className="delivery-name" onClick={() => onVideoSelect(video)} disabled={uploading} title={name}>{name}</button><div className="delivery-meta">{formatSize(video.file_size)}{(video.created_at || video.upload_date) ? ' · ' + new Date(video.created_at || video.upload_date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</div></div>
              <div className="delivery-status status-label" style={{ color: busy ? '#dfbd83' : ready ? '#8ab4ff' : failed ? '#e89583' : '#adb8c7' }}><span className="status-dot" />{busy ? 'Analyzing' : ready ? (video.ball_detected === false ? 'No ball detected' : 'Ready to review') : failed ? 'Needs attention' : 'Uploaded'}</div>
              <div className="delivery-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}><Tooltip title="Reprocess clip"><span><IconButton aria-label={'Reprocess ' + name} disabled={busy} onClick={() => handleReprocess(video)}><Refresh fontSize="small" /></IconButton></span></Tooltip><Tooltip title="Delete clip"><span><IconButton aria-label={'Delete ' + name} disabled={busy} onClick={() => setDeleteTarget(video)}><Delete sx={{ fontSize: 18 }} /></IconButton></span></Tooltip>{<Tooltip title={ready ? 'Open analysis' : 'Open source video'}><IconButton aria-label={'Open analysis for ' + name} onClick={() => onVideoSelect(video)} sx={{ color: 'primary.main' }}><ArrowForward sx={{ fontSize: 18 }} /></IconButton></Tooltip>}</div>
            </article>;
          })}</div>}
        </section>
        <footer className="studio-footer"><span>CREASE / LAB · COMPUTER VISION & GRAPHICS</span><span>Measured footage. Clearly labelled simulation.</span></footer>
      </main>
      <VideoRecorder open={showRecorder} onClose={() => setShowRecorder(false)} onRecorded={blob => uploadVideo(new File([blob], 'delivery-' + Date.now() + '.webm', { type: 'video/webm' }))} />
      <Dialog open={!!deleteTarget} onClose={() => { if (!deleting) setDeleteTarget(null); }} aria-labelledby="delete-delivery-title" maxWidth="xs" fullWidth>
        <DialogTitle id="delete-delivery-title">Delete this delivery?</DialogTitle><DialogContent><Typography variant="body2" color="text.secondary">{deleteTarget?.original_filename || deleteTarget?.filename} and its analysis will be permanently removed.</Typography></DialogContent><DialogActions sx={{ p: 2 }}><Button onClick={() => setDeleteTarget(null)} disabled={deleting} color="inherit">Keep delivery</Button><Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>{deleting ? 'Deleting…' : 'Delete delivery'}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

export default Dashboard;
