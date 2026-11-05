import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box, IconButton, Typography, Chip, Slider, ToggleButton, ToggleButtonGroup,
  Paper, Button, Select, MenuItem, FormControl, Divider, CircularProgress
} from '@mui/material';
import {
  ArrowBack, PlayArrow, Pause, Replay, Speed, Gavel, SkipPrevious, SkipNext
} from '@mui/icons-material';
import HawkEyeViewer from '../components/HawkEyeViewer';
import api, { API_BASE_URL } from '../api/client';

const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1];

const PRESET_DELIVERIES = [
  { id: 'inswinger_lbw', label: 'Fast Inswinger - LBW Out (142 km/h)', decision: 'OUT' },
  { id: 'offcutter_bowled', label: 'Good Length Off-Cutter - Bowled (132 km/h)', decision: 'OUT' },
  { id: 'bouncer_missing', label: 'Sharp Bouncer - Missing Stumps (148 km/h)', decision: 'NOT OUT' },
  { id: 'legspin_umpires_call', label: "Leg Break - Umpire's Call (88 km/h)", decision: "UMPIRE'S CALL" }
];

export default function DRSReview({
  video,
  trajectoryData: initialTrajectory,
  trajectoryLoading = false,
  trajectoryError = null,
  onBack
}) {
  const videoRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1.5);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [viewMode, setViewMode] = useState(video?.filename ? 'split' : '3d');
  const [currentDeliveryType, setCurrentDeliveryType] = useState(video ? 'video' : 'inswinger_lbw');
  const [activeTrajectory, setActiveTrajectory] = useState(initialTrajectory);
  const [loadingPreset, setLoadingPreset] = useState(false);

  // --- Sync activeTrajectory when parent updates (e.g., user switches clips) ---
  useEffect(() => {
    if (currentDeliveryType === 'video') {
      setActiveTrajectory(initialTrajectory);
    }
  }, [initialTrajectory, currentDeliveryType]);

  // Load preset delivery data
  const loadPresetDelivery = useCallback(async (deliveryType) => {
    setLoadingPreset(true);
    try {
      const response = await api.get(`/videos/presets/${deliveryType}`);
      setActiveTrajectory(response.data);
      setDuration(response.data.video_duration || 1.5);
      setCurrentTime(0);
      setIsPlaying(true);
    } catch (err) {
      console.error('Failed to load preset delivery:', err);
    } finally {
      setLoadingPreset(false);
    }
  }, []);

  // Handle switching delivery presets
  const handleDeliveryChange = (newType) => {
    setCurrentDeliveryType(newType);
    if (newType === 'video') {
      setActiveTrajectory(initialTrajectory);
      if (videoRef.current) {
        setDuration(videoRef.current.duration || 1.5);
      }
      setViewMode('split');
    } else {
      loadPresetDelivery(newType);
      setViewMode('3d');
    }
  };

  // Only load default preset if there's no video and no trajectory loading in flight
  useEffect(() => {
    if (!video && !initialTrajectory && !trajectoryLoading) {
      loadPresetDelivery('inswinger_lbw');
    }
  }, [video, initialTrajectory, trajectoryLoading, loadPresetDelivery]);

  // Video event listeners — re-attached when viewMode changes (element may remount)
  useEffect(() => {
    if (currentDeliveryType !== 'video') return;
    const vid = videoRef.current;
    if (!vid) return;

    const onTimeUpdate = () => setCurrentTime(vid.currentTime);
    const onLoadedMetadata = () => setDuration(vid.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('loadedmetadata', onLoadedMetadata);
    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);

    return () => {
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('loadedmetadata', onLoadedMetadata);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
    };
  }, [currentDeliveryType, viewMode]); // viewMode added so listeners reattach after remount

  // Simulated animation clock for 3D physics presets
  useEffect(() => {
    if (currentDeliveryType === 'video') return;

    const updateSimulation = (timestamp) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const delta = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      if (isPlaying) {
        setCurrentTime((prev) => {
          const next = prev + delta * playbackRate;
          if (next >= duration) {
            return 0; // Loop simulation
          }
          return next;
        });
      }
      animFrameRef.current = requestAnimationFrame(updateSimulation);
    };

    animFrameRef.current = requestAnimationFrame(updateSimulation);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      lastTimeRef.current = null;
    };
  }, [isPlaying, playbackRate, duration, currentDeliveryType]);

  // Handle play/pause — wrap play() in catch to handle browser rejection
  const togglePlay = () => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(err => {
          console.warn('Video play rejected:', err.name);
        });
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (_, value) => {
    setCurrentTime(value);
    if (currentDeliveryType === 'video' && videoRef.current) {
      videoRef.current.currentTime = value;
    }
  };

  const handleRateChange = (rate) => {
    setPlaybackRate(rate);
    if (currentDeliveryType === 'video' && videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const restart = () => {
    setCurrentTime(0);
    if (currentDeliveryType === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  };

  // Step one frame forward/back (for video mode)
  const stepFrame = (direction) => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      const fps = 30; // assume 30fps for manual stepping
      const step = direction / fps;
      const clamped = Math.max(0, Math.min(duration, videoRef.current.currentTime + step));
      videoRef.current.currentTime = clamped;
    } else {
      // For simulation: step by ~1 frame at 60fps
      const step = direction / 60;
      setCurrentTime(prev => Math.max(0, Math.min(duration, prev + step)));
    }
  };

  const formatTime = (t) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const videoUrl = video?.filename
    ? `${API_BASE_URL}/uploads/${encodeURIComponent(video.filename)}`
    : '';

  const drs = activeTrajectory?.drs_evaluation;
  const isVideoMode = currentDeliveryType === 'video';
  const isSimulation = !isVideoMode;

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#060d17', color: 'white' }}>
      {/* Top Header Bar */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5,
        px: 2,
        py: 1.2,
        bgcolor: '#0a1626',
        borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <IconButton
            onClick={onBack}
            sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.06)' }}
            aria-label="Back to dashboard"
          >
            <ArrowBack fontSize="small" />
          </IconButton>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Cricket DRS Review Console
            </Typography>
            <Typography variant="caption" sx={{ color: '#94a3b8' }}>
              Computer Vision &amp; Interactive 3D Hawk-Eye Display
            </Typography>
          </Box>
        </Box>

        {/* Delivery Selector Dropdown & View Mode */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 260 } }}>
            <Select
              disabled={loadingPreset}
              value={currentDeliveryType}
              onChange={(e) => handleDeliveryChange(e.target.value)}
              sx={{
                color: 'white',
                bgcolor: 'rgba(255,255,255,0.08)',
                borderRadius: 2,
                fontSize: '0.85rem',
                fontWeight: 600,
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.2)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#e63946' },
                '& .MuiSvgIcon-root': { color: 'white' }
              }}
            >
              {video && <MenuItem value="video">Uploaded Video ({video.original_filename || video.filename})</MenuItem>}
              {PRESET_DELIVERIES.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* View Mode Toggle */}
          <ToggleButtonGroup
            size="small"
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            sx={{
              bgcolor: 'rgba(255,255,255,0.05)',
              '& .MuiToggleButton-root': {
                color: '#cbd5e1',
                borderColor: 'rgba(255,255,255,0.15)',
                fontSize: '0.75rem',
                px: 1.5
              },
              '& .Mui-selected': {
                bgcolor: 'rgba(230,57,70,0.85) !important',
                color: 'white !important'
              }
            }}
          >
            {video && <ToggleButton value="video" aria-label="Video only">Video</ToggleButton>}
            {video && <ToggleButton value="split" aria-label="Split view">Split</ToggleButton>}
            <ToggleButton value="3d" aria-label="3D Hawk-Eye">3D Hawk-Eye</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Main Review Area */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        overflow: { xs: 'auto', md: 'hidden' }
      }}>
        {/* Video Panel (only if video available & viewMode is video or split) */}
        {video && (viewMode === 'video' || viewMode === 'split') && (
          <Box sx={{
            flex: viewMode === 'split' ? 1 : 'auto',
            height: { xs: 240, md: 'auto' },
            minHeight: { xs: 200, md: 'auto' },
            position: 'relative',
            bgcolor: 'black',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: { xs: 'none', md: '1px solid rgba(255,255,255,0.1)' },
            borderBottom: { xs: '1px solid rgba(255,255,255,0.1)', md: 'none' }
          }}>
            <video
              ref={videoRef}
              src={videoUrl}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              playsInline
            />
            {playbackRate !== 1 && (
              <Chip
                label={`${playbackRate}x`}
                size="small"
                sx={{
                  position: 'absolute',
                  top: 14,
                  left: 14,
                  bgcolor: '#e63946',
                  color: 'white',
                  fontWeight: 700
                }}
              />
            )}
          </Box>
        )}

        {/* 3D Hawk-Eye View Panel */}
        {(viewMode === '3d' || viewMode === 'split') && (
          <Box sx={{
            flex: 1.3,
            height: { xs: 340, md: 'auto' },
            minHeight: { xs: 280, md: 'auto' },
            position: 'relative',
            bgcolor: '#08121e'
          }}>
            <HawkEyeViewer
              trajectoryData={activeTrajectory}
              currentTime={currentTime}
            />
          </Box>
        )}

        {/* Broadcast DRS Decision & Telemetry Sidebar */}
        <Box sx={{
          width: { xs: '100%', md: 320 },
          flexShrink: 0,
          bgcolor: '#0a1626',
          borderLeft: { xs: 'none', md: '1px solid rgba(255,255,255,0.1)' },
          borderTop: { xs: '1px solid rgba(255,255,255,0.1)', md: 'none' },
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflowY: 'auto'
        }}>
          {/* Header Card */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Gavel sx={{ color: '#e63946', fontSize: 24 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              DRS Decision Readout
            </Typography>
          </Box>

          {/* Loading state for uploaded video trajectory */}
          {isVideoMode && trajectoryLoading && (
            <Paper sx={{ p: 2, bgcolor: '#0f2137', textAlign: 'center', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#38bdf8' }} />
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                Loading trajectory analysis…
              </Typography>
            </Paper>
          )}

          {/* Error state */}
          {isVideoMode && trajectoryError && !trajectoryLoading && (
            <Paper sx={{ p: 2, bgcolor: '#0f2137', textAlign: 'center', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ color: trajectoryError === 'not_processed' ? '#fbbf24' : '#f87171' }}>
                {trajectoryError === 'not_processed'
                  ? '⚠ Video not yet processed. Go back and reprocess.'
                  : '⚠ Failed to load trajectory data.'}
              </Typography>
            </Paper>
          )}

          {/* 3-Box Official DRS Evaluation */}
          {!trajectoryLoading && (
            <>
              {drs ? (
                <Paper sx={{
                  p: 2,
                  bgcolor: '#0f2137',
                  borderRadius: 2,
                  border: '1px solid rgba(255,255,255,0.12)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5
                }}>
                  {/* Pitching */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                      Pitching
                    </Typography>
                    <Chip
                      label={drs.pitching}
                      size="small"
                      sx={{
                        bgcolor: drs.pitching === 'IN LINE' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                        color: drs.pitching === 'IN LINE' ? '#4ade80' : '#f87171',
                        border: `1px solid ${drs.pitching === 'IN LINE' ? '#22c55e' : '#ef4444'}`,
                        fontWeight: 700,
                        fontSize: '0.72rem'
                      }}
                    />
                  </Box>

                  {/* Impact */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                      Impact
                    </Typography>
                    <Chip
                      label={drs.impact}
                      size="small"
                      sx={{
                        bgcolor: drs.impact === 'IN LINE' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                        color: drs.impact === 'IN LINE' ? '#4ade80' : '#f87171',
                        border: `1px solid ${drs.impact === 'IN LINE' ? '#22c55e' : '#ef4444'}`,
                        fontWeight: 700,
                        fontSize: '0.72rem'
                      }}
                    />
                  </Box>

                  {/* Wickets */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                      Wickets
                    </Typography>
                    <Chip
                      label={drs.wickets}
                      size="small"
                      sx={{
                        bgcolor: drs.wickets === 'HITTING'
                          ? 'rgba(239,68,68,0.2)'
                          : drs.wickets === "UMPIRE'S CALL"
                          ? 'rgba(245,158,11,0.2)'
                          : 'rgba(34,197,94,0.2)',
                        color: drs.wickets === 'HITTING'
                          ? '#f87171'
                          : drs.wickets === "UMPIRE'S CALL"
                          ? '#fbbf24'
                          : '#4ade80',
                        border: `1px solid ${
                          drs.wickets === 'HITTING'
                            ? '#ef4444'
                            : drs.wickets === "UMPIRE'S CALL"
                            ? '#f59e0b'
                            : '#22c55e'
                        }`,
                        fontWeight: 700,
                        fontSize: '0.72rem'
                      }}
                    />
                  </Box>

                  <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)', my: 0.5 }} />

                  {/* Final Big Decision Banner */}
                  <Box sx={{
                    textAlign: 'center',
                    py: 1.2,
                    borderRadius: 1.5,
                    bgcolor: drs.decision.includes('OUT') && !drs.decision.includes('NOT')
                      ? '#e63946'
                      : drs.decision.includes('UMPIRE')
                      ? '#f59e0b'
                      : '#2a9d8f'
                  }}>
                    <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: 1.5, color: 'white' }}>
                      {drs.decision.split(' ')[0]} {drs.decision.split(' ')[1] || ''}
                    </Typography>
                  </Box>

                  {/* Source label for video mode */}
                  {isVideoMode && (
                    <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.68rem', textAlign: 'center' }}>
                      ⚠ Illustrative estimate — uncalibrated single-camera footage
                    </Typography>
                  )}
                </Paper>
              ) : (
                !trajectoryError && (
                  <Paper sx={{ p: 2, bgcolor: '#0f2137', textAlign: 'center', borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                      {isVideoMode ? 'No trajectory data available.' : 'Upload a video or pick a preset to view DRS evaluation.'}
                    </Typography>
                  </Paper>
                )
              )}
            </>
          )}

          {/* Delivery Telemetry */}
          <Paper sx={{
            p: 2,
            bgcolor: '#0f2137',
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.2
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Speed sx={{ color: '#38bdf8', fontSize: 20 }} />
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase' }}>
                Ball Telemetry
              </Typography>
              {/* Label: SIMULATION vs ILLUSTRATIVE */}
              <Chip
                label={isSimulation ? 'SIMULATION' : 'ILLUSTRATIVE'}
                size="small"
                sx={{
                  ml: 'auto',
                  bgcolor: isSimulation ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                  color: isSimulation ? '#4ade80' : '#fbbf24',
                  border: `1px solid ${isSimulation ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`,
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  height: 18,
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Release Speed</Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'white' }}>
                {activeTrajectory?.release_speed_kmh != null
                  ? `${activeTrajectory.release_speed_kmh} km/h (${(activeTrajectory.release_speed_kmh * 0.621371).toFixed(1)} mph)`
                  : '—'}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Bounce Speed</Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'white' }}>
                {activeTrajectory?.bounce_speed_kmh != null
                  ? `${activeTrajectory.bounce_speed_kmh} km/h`
                  : '—'}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Length Zone</Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#e9c46a' }}>
                {activeTrajectory?.length_zone != null
                  ? activeTrajectory.length_zone
                  : (isVideoMode ? '—' : 'Good Length')}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>Stump Target</Typography>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#f72585' }}>
                {activeTrajectory?.stump_plane_target?.hit_stump || '—'}
              </Typography>
            </Box>
          </Paper>

          {/* Interactive Instructions Card */}
          <Box sx={{ mt: 'auto', p: 1.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5, fontWeight: 600 }}>
              💡 Interactive Graphics Controls
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', display: 'block', fontSize: '0.7rem' }}>
              • Drag left mouse to orbit 360°
              <br />• Scroll wheel to zoom in/out
              <br />• Switch cameras (Chase Cam, Batsman POV, Umpire)
              <br />• Click trajectory markers for telemetry
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Bottom Timeline Controls */}
      <Paper sx={{
        borderRadius: 0,
        bgcolor: '#0a1626',
        px: 3,
        py: 1.5,
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        {/* Timeline Slider */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Typography variant="caption" sx={{ color: '#94a3b8', minWidth: 60, fontFamily: 'monospace' }}>
            {formatTime(currentTime)}
          </Typography>
          <Slider
            value={currentTime}
            min={0}
            max={duration || 1.5}
            step={0.01}
            onChange={handleSeek}
            sx={{
              color: '#e63946',
              '& .MuiSlider-thumb': { width: 14, height: 14 },
              '& .MuiSlider-track': { height: 4 },
              '& .MuiSlider-rail': { height: 4, bgcolor: 'rgba(255,255,255,0.2)' }
            }}
          />
          <Typography variant="caption" sx={{ color: '#94a3b8', minWidth: 60, fontFamily: 'monospace' }}>
            {formatTime(duration)}
          </Typography>
        </Box>

        {/* Playback & Speed Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton onClick={restart} sx={{ color: 'white' }} aria-label="Restart">
              <Replay fontSize="small" />
            </IconButton>
            <IconButton
              onClick={() => stepFrame(-1)}
              sx={{ color: '#94a3b8' }}
              aria-label="Previous frame"
              size="small"
            >
              <SkipPrevious fontSize="small" />
            </IconButton>
            <IconButton
              onClick={togglePlay}
              sx={{
                color: 'white',
                bgcolor: '#e63946',
                '&:hover': { bgcolor: '#c1121f' },
                width: 38,
                height: 38
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause fontSize="small" /> : <PlayArrow fontSize="small" />}
            </IconButton>
            <IconButton
              onClick={() => stepFrame(1)}
              sx={{ color: '#94a3b8' }}
              aria-label="Next frame"
              size="small"
            >
              <SkipNext fontSize="small" />
            </IconButton>
          </Box>

          {/* Speed Buttons */}
          <Box sx={{ display: 'flex', gap: 0.8 }}>
            {PLAYBACK_RATES.map((rate) => (
              <Button
                key={rate}
                size="small"
                variant={playbackRate === rate ? 'contained' : 'outlined'}
                onClick={() => handleRateChange(rate)}
                sx={{
                  minWidth: 42,
                  py: 0.3,
                  fontSize: '0.75rem',
                  color: 'white',
                  borderColor: 'rgba(255,255,255,0.25)',
                  bgcolor: playbackRate === rate ? '#e63946' : 'transparent',
                  '&:hover': {
                    bgcolor: playbackRate === rate ? '#c1121f' : 'rgba(255,255,255,0.1)'
                  }
                }}
              >
                {rate === 1 ? '1x' : `${rate}x`}
              </Button>
            ))}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
