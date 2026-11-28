import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  Box, IconButton, Typography, Chip, Slider, ToggleButton, ToggleButtonGroup,
  Paper, Button, Select, MenuItem, FormControl, Divider, CircularProgress, LinearProgress,
  Switch, FormControlLabel,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert,
  Tooltip, useMediaQuery
} from '@mui/material';
import {
  ArrowBack, PlayArrow, Pause, Replay, Speed, Gavel, SkipPrevious, SkipNext,
  Assessment,
  DataObject, TableChart, CameraAlt, Visibility, VisibilityOff,
  TrendingUp, Timeline, AccountTree, Article
} from '@mui/icons-material';
import HawkEyeViewer from '../components/HawkEyeViewer';
import DRSCommentary from '../components/DRSCommentary';
import DecisionFlowHUD from '../components/DecisionFlowHUD';
import MatchReportCard from '../components/MatchReportCard';
import PitchCalibration from '../components/PitchCalibration';
import SwingAnalysisCard from '../components/SwingAnalysisCard';
import api, { API_BASE_URL } from '../api/client';
import { prepareTrajectory, sampleTrajectoryAtTime, containRect } from '../utils/trajectory';
import { subscribeMediaClock } from '../utils/mediaClock';
import standardDeliveries from '../utils/standardDeliveries.json';

const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1];
const STANDARD_PITCH = 'standard_hard';
const PRESET_SPIN = 'preset';
const DEFAULT_DELIVERY = 'inswinger_lbw';

const PRESET_DELIVERIES = [
  { id: 'inswinger_lbw', label: 'Fast inswinger (142 km/h)', decision: 'OUT' },
  { id: 'offcutter_bowled', label: 'Good length off-cutter (132 km/h)', decision: 'OUT' },
  { id: 'bouncer_missing', label: 'Sharp bouncer (148 km/h)', decision: 'NOT OUT' },
  { id: 'legspin_umpires_call', label: 'Leg break (88 km/h)', decision: "UMPIRE'S CALL" }
];

// Broadcast convention: red supports OUT, green supports NOT OUT, amber is umpire's call.
function verdictTone(kind, value) {
  const text = String(value || '').toUpperCase();
  if (text === 'UNAVAILABLE' || text.includes('NOT MEASURED')) return 'neutral';
  if (text.includes('UMPIRE')) return 'umpire';
  if (kind === 'pitching') return text.includes('OUTSIDE LEG') ? 'notout' : 'out';
  if (kind === 'impact') return text.includes('OUTSIDE') ? 'notout' : 'out';
  if (kind === 'wickets') return text.includes('HITTING') ? 'out' : 'notout';
  return 'neutral';
}

function decisionTone(decision) {
  const text = String(decision || '').toUpperCase();
  if (text.includes('LINE NOT MEASURED')) return 'neutral';
  if (text.includes('NOT OUT')) return 'notout';
  if (text.includes('UMPIRE')) return 'umpire';
  return text.includes('OUT') ? 'out' : 'neutral';
}

export default function DRSReview({
  video,
  trajectoryData: initialTrajectory,
  trajectoryLoading = false,
  trajectoryError = null,
  trackingProgress = null,
  analysisStatus = null,
  analysisPending = false,
  retrySubmitting = false,
  retryError = '',
  onRetryAnalysis,
  onBack
}) {
  const smallScreen = useMediaQuery('(max-width:767px)');
  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(null);
  const sourceTouched = useRef(false);
  const layoutChosen = useRef(false);
  const guidedEnd = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video ? 1.5 : standardDeliveries[DEFAULT_DELIVERY].video_duration);
  const [playbackRate, setPlaybackRate] = useState(video ? 1 : 0.5);
  const [viewMode, setViewMode] = useState(video ? 'video' : '3d');
  const [currentDeliveryType, setCurrentDeliveryType] = useState(video ? 'video' : DEFAULT_DELIVERY);
  const [activeTrajectory, setActiveTrajectory] = useState(video ? initialTrajectory : standardDeliveries[DEFAULT_DELIVERY]);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [presetError, setPresetError] = useState(false);
  const [showCvOverlay, setShowCvOverlay] = useState(true);
  const [showCvTrail, setShowCvTrail] = useState(true);
  const [pickingCorner, setPickingCorner] = useState(null);
  const [pickedPoint, setPickedPoint] = useState(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [playback, setPlayback] = useState(null);
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const videoId = video?.id;
  const currentPlayback = playback?.videoId === videoId ? playback : null;
  useEffect(() => {
    if (!videoId) return;
    const controller = new AbortController();
    async function authorizePlayback() {
      try {
        const { data } = await api.post(`/videos/${videoId}/playback`, null, { signal: controller.signal, timeout: 8000 });
        if (!data.stream_url?.startsWith(`/videos/${videoId}/stream?ticket=`)) throw new Error('Invalid playback URL');
        if (!controller.signal.aborted) setPlayback({ videoId, url: `${API_BASE_URL}${data.stream_url}` });
      } catch {
        if (!controller.signal.aborted) setPlayback({ videoId, error: true });
      }
    }
    authorizePlayback();
    return () => controller.abort();
  }, [videoId, playbackAttempt]);
  useEffect(() => { setPickedPoint(null); setPickingCorner(null); }, [video?.id]);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [video?.id]);

  // Official DRS Review Session State
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewOutcome, setReviewOutcome] = useState('');
  const [reviewType, setReviewType] = useState('LBW');
  const [reviewNotes, setReviewNotes] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [savedReviewId, setSavedReviewId] = useState(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState('');

  // 2D Video Tracking Reticle & Broadcast HUD Controls
  const [mediaError, setMediaError] = useState('');
  const [videoRect, setVideoRect] = useState(null);
  const [showBroadcastHUD, setShowBroadcastHUD] = useState(false);
  const [hudMinimized, setHudMinimized] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [actionError, setActionError] = useState('');
  const [showCommentary, setShowCommentary] = useState(false);

  // TV Broadcast Decision Flow HUD & Match Delivery report states
  const [flowHUDOpen, setFlowHUDOpen] = useState(false);
  const [reportCardOpen, setReportCardOpen] = useState(false);

  const handleSaveReview = async () => {
    if (!video?.id || !reviewOutcome || !localStorage.getItem('token')) return;
    setActionError('');
    setSavingReview(true);
    try {
      const payload = {
        video_id: video.id,
        decisions: [
          {
            type: reviewType,
            outcome: reviewOutcome,
            timestamp: currentTime,
            confidence: activeTrajectory?.confidence_score ?? null
          }
        ],
        notes: reviewNotes || `Reviewer assessment: ${reviewOutcome} (${reviewType})`
      };
      const res = await api.post('/reviews/', payload);
      setSavedReviewId(res.data.id);
      setReviewSuccessMsg(`Review session #${res.data.id.substring(0, 8)} saved successfully!`);
      setReviewDialogOpen(false);
    } catch (err) {
      console.error('Failed to save review session:', err);
      setActionError(typeof err.response?.data?.detail === 'string' ? err.response.data.detail : 'Could not save this review. Please try again.');
    } finally {
      setSavingReview(false);
    }
  };

  // Sync activeTrajectory when the parent's trajectory prop updates
  useEffect(() => {
    if (currentDeliveryType === 'video') {
      setActiveTrajectory(initialTrajectory);
    }
  }, [initialTrajectory, currentDeliveryType]);

  const [pitchType, setPitchType] = useState(STANDARD_PITCH);
  const [spinRPM, setSpinRPM] = useState(PRESET_SPIN);

  const applyPreset = useCallback(data => {
    setActiveTrajectory(data);
    setDuration(data.video_duration || 1.5);
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    if (video) return;
    setPresetError(false);
    if (pitchType === STANDARD_PITCH && spinRPM === PRESET_SPIN) {
      applyPreset(standardDeliveries[currentDeliveryType]);
      setLoadingPreset(false);
      return;
    }

    const controller = new AbortController();
    setLoadingPreset(true);
    setActiveTrajectory(null);
    setCurrentTime(0);
    setIsPlaying(false);
    api.get(`/videos/presets/${currentDeliveryType}`, {
      params: { pitch_type: pitchType, rpm: spinRPM === PRESET_SPIN ? undefined : spinRPM },
      signal: controller.signal,
      timeout: 8000,
    }).then(({ data }) => {
      if (!controller.signal.aborted) applyPreset(data);
    }).catch(() => {
      if (!controller.signal.aborted) setPresetError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingPreset(false);
    });
    return () => controller.abort();
  }, [video, pitchType, spinRPM, currentDeliveryType, applyPreset]);

  // Keep the mounted media element authoritative across layout changes.
  useEffect(() => {
    const media = videoRef.current;
    if (!media || currentDeliveryType !== 'video') return;
    setMediaError('');
    return subscribeMediaClock(media, (time, fromFrame) => {
      if (guidedEnd.current !== null && time >= guidedEnd.current) {
        guidedEnd.current = null;
        media.pause();
        return;
      }
      const update = () => { setCurrentTime(time); setIsSeeking(false); };
      // Native video presentation must not wait for a deferred React render.
      if (fromFrame) flushSync(update);
      else update();
    }, setIsPlaying, setDuration,
      () => setMediaError('This video could not be played. Try an MP4 encoded with H.264, or return to your deliveries to choose another clip.'));
  }, [video, currentDeliveryType]);

  useEffect(() => {
    const media = videoRef.current;
    const container = videoContainerRef.current;
    if (!media || !container) return;
    const update = () => setVideoRect(containRect(container.clientWidth, container.clientHeight,
      media.videoWidth || initialTrajectory?.video_info?.width,
      media.videoHeight || initialTrajectory?.video_info?.height));
    const observer = new ResizeObserver(update);
    observer.observe(container);
    media.addEventListener('loadedmetadata', update);
    update();
    return () => { observer.disconnect(); media.removeEventListener('loadedmetadata', update); };
  }, [video, initialTrajectory, viewMode]);

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
            return duration;
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
  useEffect(() => {
    if (currentDeliveryType !== 'video' && currentTime >= duration) setIsPlaying(false);
  }, [currentDeliveryType, currentTime, duration]);

  // Authoritative Play/Pause control (works in 3D-only, Split, and Video view modes)
  const togglePlay = () => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      sourceTouched.current = true;
      guidedEnd.current = null;
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play().catch(err => {
          setMediaError('Playback could not start. Press Play to try again.');
        });
      }
    } else {
      if (!isPlaying && currentTime >= duration) setCurrentTime(0);
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (_, value) => {
    setIsSeeking(true);
    if (currentDeliveryType === 'video' && videoRef.current) {
      sourceTouched.current = true;
      guidedEnd.current = null;
      videoRef.current.currentTime = value;
    } else { setCurrentTime(value); setIsSeeking(false); }
  };

  const handleRateChange = (rate) => {
    guidedEnd.current = null;
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const restart = () => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      handleSeek(null, 0);
      videoRef.current.play().catch(() => setMediaError('Playback could not start. Press Play to try again.'));
    } else {
      setCurrentTime(0);
      setIsPlaying(true);
    }
  };

  // Accurate frame step using source video FPS when available
  const stepFrame = (direction) => {
    videoRef.current?.pause();
    setIsPlaying(false);
    const fps = activeTrajectory?.video_info?.fps || 30;
    if (currentDeliveryType === 'video' && videoRef.current) {
      const step = direction / fps;
      const clamped = Math.max(0, Math.min(duration, videoRef.current.currentTime + step));
      handleSeek(null, clamped);
    } else {
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

  const videoUrl = currentPlayback?.url;

  const isVideoMode = currentDeliveryType === 'video';
  const isSimulation = !isVideoMode;
  const projection = isVideoMode ? activeTrajectory?.wicket_projection : null;
  const has3DFlight = isSimulation || ['camera_ballistic_fit', 'stump_plane_fit'].includes(activeTrajectory?.reconstruction_method);
  const canMarkPitch = isVideoMode && activeTrajectory?.can_refit_camera && !mediaError && !analysisPending && !retrySubmitting;
  const cutBeforeTrackEnd = activeTrajectory?.debug_info?.camera_cut_before_track_end;
  useEffect(() => {
    if (isVideoMode && !layoutChosen.current) setViewMode(has3DFlight && !smallScreen ? 'split' : 'video');
  }, [has3DFlight, isVideoMode, smallScreen]);
  const noVerdictReason = !activeTrajectory?.ball_detected
    ? 'No consistent ball track could be identified in this clip.'
    : !has3DFlight && cutBeforeTrackEnd
      ? 'The clip changes shots during the review window. Try an uncut delivery from a fixed camera.'
    : !has3DFlight
      ? 'The detector found a candidate ball track. The pitching and impact lines could not be measured.'
      : projection
        ? 'The flight supports a wicket projection. Pad contact could not be verified.'
        : 'The reconstructed flight does not provide enough evidence to verify pitching, impact and the wicket projection.';

  const drs = useMemo(() => {
    const raw = activeTrajectory?.drs_evaluation;
    if (!isSimulation || typeof raw?.decision !== 'string') return null;
    return { ...raw, isPredicted: Boolean(activeTrajectory.extrapolated_points?.length || raw.is_predicted) };
  }, [activeTrajectory, isSimulation]);
  // Real-time DRS reveal: each verdict appears only once playback reaches the event it depends on.
  const drsReveal = useMemo(() => {
    const at = (value) => (Number.isFinite(value) ? value : -Infinity);
    const ext = activeTrajectory?.extrapolated_points;
    const pts = activeTrajectory?.points;
    const lastExt = Array.isArray(ext) && ext.length ? ext[ext.length - 1].t : null;
    const lastPt = Array.isArray(pts) && pts.length ? pts[pts.length - 1].t : null;
    const bounceT = at(activeTrajectory?.bounce_point?.t);
    const impactT = at(activeTrajectory?.impact_point?.t ?? lastPt);
    const wicketsT = at(lastExt ?? activeTrajectory?.impact_point?.t ?? lastPt);
    const now = currentTime + 1e-3;
    return {
      pitching: now >= bounceT,
      impact: now >= impactT,
      wickets: now >= wicketsT,
      decision: now >= wicketsT,
    };
  }, [activeTrajectory, currentTime]);

  const debugInfo = activeTrajectory?.debug_info;
  const videoInfo = activeTrajectory?.video_info;
  // ---------------------------------------------------------------------------
  // TELEMETRY COMPUTATIONS (Speed, Seam Deviation, Length Zone, LBW Impact)
  // ---------------------------------------------------------------------------
  const releaseSpeed = useMemo(() => {
    if (!isVideoMode) {
      // Simulation: use provided value or fallback
      if (activeTrajectory?.release_speed_kmh != null) {
        return Number(activeTrajectory.release_speed_kmh.toFixed(1));
      }
      const pts = activeTrajectory?.points;
      if (pts && pts.length > 0 && pts[0].speed_kmh != null) {
        return Number(pts[0].speed_kmh.toFixed(1));
      }
      return 142.4; // simulation fallback only
    }
    return activeTrajectory?.release_speed_kmh ?? null;
  }, [activeTrajectory, isVideoMode]);

  const bounceSpeed = useMemo(() => {
    if (activeTrajectory?.bounce_speed_kmh != null) {
      return Number(activeTrajectory.bounce_speed_kmh.toFixed(1));
    }
    const bp = activeTrajectory?.bounce_point;
    if (bp && bp.speed_kmh != null) {
      return Number(bp.speed_kmh.toFixed(1));
    }
    // This ratio belongs only to the illustrative simulation.
    if (!isVideoMode && releaseSpeed != null) {
      return Number((releaseSpeed * 0.83).toFixed(1));
    }
    return null; // unknown for real uploads without speed data
  }, [activeTrajectory, releaseSpeed, isVideoMode]);

  const speedLossPct = useMemo(() => {
    if (releaseSpeed == null || bounceSpeed == null) return null;
    const loss = ((releaseSpeed - bounceSpeed) / releaseSpeed) * 100;
    return Number(Math.max(0, loss).toFixed(1));
  }, [releaseSpeed, bounceSpeed]);

  const deviationAngle = useMemo(() => {
    if (activeTrajectory?.deviation_angle_deg != null) {
      return Number(activeTrajectory.deviation_angle_deg.toFixed(1));
    }
    if (activeTrajectory?.seam_deviation_deg != null) {
      return Number(activeTrajectory.seam_deviation_deg.toFixed(1));
    }

    const pre = activeTrajectory?.pre_bounce_points;
    const post = activeTrajectory?.post_bounce_points;
    if (pre && pre.length >= 2 && post && post.length >= 2) {
      const p0 = pre[pre.length - 2];
      const p1 = pre[pre.length - 1];
      const q0 = post[0];
      const q1 = post[post.length > 2 ? 2 : 1];
      const anglePre = Math.atan2(p1.x - p0.x, p1.y - p0.y);
      const anglePost = Math.atan2(q1.x - q0.x, q1.y - q0.y);
      let diffDeg = ((anglePost - anglePre) * 180) / Math.PI;
      if (Math.abs(diffDeg) > 0.05) {
        return Number(diffDeg.toFixed(1));
      }
    }

    if (isVideoMode) return null;
    const id = activeTrajectory?.id || currentDeliveryType || '';
    if (id.includes('inswinger')) return 3.2;
    if (id.includes('offcutter')) return -3.4;
    if (id.includes('legspin')) return 4.6;
    if (id.includes('bouncer')) return 0.5;
    return 2.4;
  }, [activeTrajectory, currentDeliveryType, isVideoMode]);

  const deviationLabel = useMemo(() => {
    if (deviationAngle == null) return 'Unavailable';
    if (deviationAngle > 0.5) {
      return `+${deviationAngle}° Seam Away / Leg Break`;
    } else if (deviationAngle < -0.5) {
      return `${deviationAngle}° Seam In / Off Cutter`;
    }
    return `${deviationAngle >= 0 ? '+' : ''}${deviationAngle}° Straight (Seam Held)`;
  }, [deviationAngle]);

  const lengthZone = useMemo(() => {
    if (activeTrajectory?.length_zone) return activeTrajectory.length_zone;
    const bp = activeTrajectory?.bounce_point;
    if (bp?.y != null) {
      const distFromStumps = 10.06 - bp.y;
      if (distFromStumps < 2.0) return 'Yorker';
      if (distFromStumps < 4.0) return 'Full Pitch';
      if (distFromStumps < 6.5) return 'Good Length';
      if (distFromStumps < 8.5) return 'Short Pitch';
      return 'Bouncer';
    }
    if (isVideoMode) return null;
    const id = activeTrajectory?.id || currentDeliveryType || '';
    if (id.includes('bouncer')) return 'Bouncer';
    if (id.includes('offcutter')) return 'Good Length';
    if (id.includes('inswinger')) return 'Full Pitch';
    return 'Good Length';
  }, [activeTrajectory, currentDeliveryType, isVideoMode]);

  const lengthZoneColor = useMemo(() => {
    switch (lengthZone) {
      case 'Yorker': return '#ef4444';
      case 'Full Pitch': return '#f59e0b';
      case 'Good Length': return '#10b981';
      case 'Short Pitch': return '#6366f1';
      case 'Bouncer': return '#ec4899';
      default: return '#10b981';
    }
  }, [lengthZone]);

  const lbwProbability = Number.isFinite(activeTrajectory?.lbw_probability)
    ? Math.round(activeTrajectory.lbw_probability) : null;

  const lbwColor = useMemo(() => {
    if (!Number.isFinite(lbwProbability)) return 'var(--muted)';
    if (lbwProbability >= 70) return '#ef4444';
    if (lbwProbability >= 35) return '#f59e0b';
    return '#10b981';
  }, [lbwProbability]);

  const preparedPoints = useMemo(() => {
    const pixels = activeTrajectory?.pixel_track;
    const points = prepareTrajectory(pixels?.length ? pixels.map(p => ({ ...p, x: 0, y: 0, z: 0 })) : activeTrajectory?.points);
    return !isVideoMode ? points : points.filter(p => Number.isFinite(p.pixel_x) && Number.isFinite(p.pixel_y) && !p.is_predicted);
  }, [activeTrajectory, isVideoMode]);
  const firstDetection = preparedPoints[0]?.t;
  const lastDetection = preparedPoints[preparedPoints.length - 1]?.t;
  const sourceFrameCount = activeTrajectory?.video_info?.frame_count;
  const candidateFrames = new Set(preparedPoints.filter(p => Number.isInteger(p.frame_idx) && p.frame_idx >= 0 && p.frame_idx < sourceFrameCount).map(p => p.frame_idx));
  const coverage = Number.isInteger(sourceFrameCount) && sourceFrameCount > 0 && candidateFrames.size > 0
    ? candidateFrames.size / sourceFrameCount * 100 : null;
  const evidenceKind = isSimulation ? 'Simulation' : has3DFlight ? 'Fitted 3D flight'
    : preparedPoints.length ? 'Candidate track' : 'Source only';
  const eventJumps = [
    { label: 'First candidate', time: firstDetection, allowed: isVideoMode },
    { label: isSimulation ? 'Bounce' : 'Fitted bounce', time: activeTrajectory?.bounce_point?.t, allowed: has3DFlight },
    { label: 'Simulated impact', time: activeTrajectory?.impact_point?.t, allowed: isSimulation },
    { label: 'Last candidate', time: lastDetection, allowed: isVideoMode }
  ].filter(event => event.allowed && Number.isFinite(event.time) && event.time >= 0 && event.time <= duration);
  useEffect(() => {
    const media = videoRef.current;
    if (!isVideoMode || !media || !Number.isFinite(firstDetection)) return;
    const cue = () => {
      if (sourceTouched.current || !media.paused || media.currentTime !== 0 || firstDetection >= media.duration) return;
      sourceTouched.current = true;
      media.currentTime = firstDetection;
    };
    if (media.readyState >= 1) cue();
    else media.addEventListener('loadedmetadata', cue, { once: true });
    return () => media.removeEventListener('loadedmetadata', cue);
  }, [firstDetection, isVideoMode]);
  const previousDetection = preparedPoints.findLast(p => p.t < currentTime - 0.001);
  const nextDetection = preparedPoints.find(p => p.t > currentTime + 0.001);
  const seekDetection = (time) => {
    videoRef.current?.pause();
    setIsPlaying(false);
    handleSeek(null, time);
  };
  const playTrackedFlight = () => {
    const media = videoRef.current;
    if (!media || !Number.isFinite(firstDetection) || lastDetection <= firstDetection) return;
    if (viewMode === '3d') setViewMode('video');
    handleRateChange(0.25);
    handleSeek(null, firstDetection);
    guidedEnd.current = lastDetection;
    media.play().catch(() => {
      guidedEnd.current = null;
      setMediaError('Playback could not start. Press Play to try again.');
    });
  };
  const currentTrackPoint = useMemo(() => sampleTrajectoryAtTime(preparedPoints, currentTime), [preparedPoints, currentTime]);
  const recentTrail = useMemo(() => preparedPoints.filter(point => point.t <= currentTime && point.t >= currentTime - 0.3
    && Number.isFinite(point.pixel_x) && Number.isFinite(point.pixel_y)), [preparedPoints, currentTime]);
  // The on-video marker exists only while the ball is actually in tracked flight (not parked at either end).
  const ballOnScreen = Boolean(currentTrackPoint && !currentTrackPoint.is_post_delivery && !currentTrackPoint.is_at_release
    && Number.isFinite(currentTrackPoint.pixel_x) && Number.isFinite(currentTrackPoint.pixel_y));
  const candidateExport = isVideoMode ? preparedPoints.map(({ t, frame_idx, pixel_x, pixel_y, confidence, is_interpolated, interpolated }) =>
    ({ t, frame_idx, pixel_x, pixel_y, confidence, is_interpolated, interpolated })) : [];
  const exportPoints = has3DFlight ? activeTrajectory?.points || [] : candidateExport;

  // ---------------------------------------------------------------------------
  // TRAJECTORY EXPORT (JSON & CSV & 3D Screenshot)
  // ---------------------------------------------------------------------------
  const handleExportJSON = () => {
    if (!activeTrajectory) {
      setActionError('Load a delivery before exporting its data.');
      return;
    }

    const exportPayload = {
      metadata: {
        application: 'Cricket Ball Tracking & Interactive 3D Display',
        module: 'Hawk-Eye DRS Review Console',
        export_timestamp: new Date().toISOString(),
        delivery_type: currentDeliveryType,
        source_video: video?.filename || null,
        simulation: isSimulation,
        evidence_kind: evidenceKind,
        coordinate_space: has3DFlight ? 'pitch_metric_xyz' : 'source_pixels',
        timing_source: activeTrajectory.timing_source ?? null,
        calibration_status: activeTrajectory.calibration_status ?? null,
        reconstruction_method: activeTrajectory.reconstruction_method ?? null,
        video_duration_seconds: duration,
        confidence_score: activeTrajectory.confidence_score ?? null
      },
      drs_verdict: {
        decision: drs?.decision || 'N/A',
        pitching: drs?.pitching || 'N/A',
        impact: drs?.impact || 'N/A',
        wickets: drs?.wickets || 'N/A',
        hit_stump: drs?.hit_stump || 'N/A',
        lbw_probability_percent: lbwProbability
      },
      telemetry: {
        release_speed_kmh: releaseSpeed,
        bounce_speed_kmh: bounceSpeed,
        speed_decay_percent: speedLossPct,
        deviation_angle_deg: deviationAngle,
        deviation_classification: deviationLabel,
        length_zone: lengthZone,
        bounce_point: activeTrajectory.bounce_point || null,
        impact_point: activeTrajectory.impact_point || null,
        stump_plane_target: activeTrajectory.stump_plane_target || null
      },
      wicket_projection: projection,
      projected_points: isSimulation || projection ? activeTrajectory.extrapolated_points || [] : [],
      candidate_pixel_track: candidateExport,
      points_count: exportPoints.length,
      trajectory_points: exportPoints.map((pt, idx) => ({
        index: pt.frame_idx ?? idx,
        timestamp_s: pt.t ?? (activeTrajectory.timestamps ? activeTrajectory.timestamps[idx] : null),
        x_meters: pt.x != null ? Number(pt.x.toFixed(4)) : null,
        y_meters: pt.y != null ? Number(pt.y.toFixed(4)) : null,
        z_meters: pt.z != null ? Number(pt.z.toFixed(4)) : null,
        speed_kmh: pt.speed_kmh != null ? Number(pt.speed_kmh.toFixed(1)) : null,
        evidence_type: pt.is_predicted ? 'projected' : isSimulation ? 'simulation' : has3DFlight ? 'fitted' : 'candidate',
        phase: pt.phase || (pt.is_predicted ? 'extrapolated' : isSimulation ? 'simulation' : has3DFlight ? 'fitted' : 'candidate'),
        is_interpolated: Boolean(pt.is_predicted || pt.is_interpolated || pt.interpolated),
        confidence: pt.confidence != null ? Number(pt.confidence.toFixed(3)) : null,
        pixel_x: pt.pixel_x != null ? Number(pt.pixel_x.toFixed(1)) : null,
        pixel_y: pt.pixel_y != null ? Number(pt.pixel_y.toFixed(1)) : null
      }))
    };

    const jsonBlob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(jsonBlob);
    const link = document.createElement('a');
    const namePrefix = video?.filename ? video.filename.replace(/\.[^/.]+$/, '') : currentDeliveryType;
    link.href = url;
    link.download = `hawkeye_trajectory_${namePrefix}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setFeedbackMsg('Trajectory telemetry exported successfully as JSON!');
  };

  const handleExportCVDiagnostics = () => {
    const payload = {
      timestamp: new Date().toISOString(),
      video_id: video?.id || currentDeliveryType,
      video_info: videoInfo,
      debug_info: debugInfo,
      measured_points: debugInfo?.measured_points ?? 0,
      predicted_points: debugInfo?.predicted_points ?? 0,
      confidence_score: activeTrajectory?.confidence_score,
      drs_evaluation: drs,
      sample_points: (activeTrajectory?.pixel_track || exportPoints).map(p => ({
        t: p.t,
        pixel_x: p.pixel_x,
        pixel_y: p.pixel_y,
        is_predicted: p.is_predicted,
        confidence: p.confidence
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cv_diagnostics_${video?.id || currentDeliveryType}_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setFeedbackMsg('Observable CV diagnostics exported successfully as JSON!');
  };

  const handleExportCSV = () => {
    if (!activeTrajectory) {
      setActionError('Load a delivery before exporting its data.');
      return;
    }

    const lines = [];
    lines.push('# Crease / Lab trajectory evidence export');
    lines.push(`# Evidence: ${evidenceKind}`);
    lines.push(`# Coordinate space: ${has3DFlight ? 'pitch_metric_xyz' : 'source_pixels'}`);
    lines.push(`# Export Timestamp: ${new Date().toISOString()}`);
    lines.push(`# Delivery Preset / Video Source: ${currentDeliveryType}`);
    if (video?.filename) lines.push(`# Source Video Filename: ${video.filename}`);
    lines.push(`# DRS Decision: ${drs?.decision || 'N/A'}`);
    lines.push(`# Pitching: ${drs?.pitching || 'N/A'} | Impact: ${drs?.impact || 'N/A'} | Wickets: ${drs?.wickets || 'N/A'}`);
    lines.push(`# LBW Probability: ${lbwProbability != null ? `${lbwProbability}%` : 'N/A'}`);
    lines.push(`# Release Speed: ${releaseSpeed != null ? `${releaseSpeed} km/h` : 'N/A'} | Bounce Speed: ${bounceSpeed != null ? `${bounceSpeed} km/h` : 'N/A'} | Decay: ${speedLossPct != null ? `${speedLossPct}%` : 'N/A'}`);
    lines.push(`# Seam Deviation: ${deviationAngle != null ? `${deviationAngle}°` : 'N/A'} (${deviationLabel})`);
    lines.push(`# Pitch Length Zone: ${lengthZone || 'N/A'}`);
    lines.push('#');
    lines.push('frame_index,timestamp_s,x_meters,y_meters,z_meters,speed_kmh,phase,is_interpolated,confidence,pixel_x,pixel_y,evidence_type');

    exportPoints.forEach((pt, idx) => {
      const frameIdx = pt.frame_idx ?? idx;
      const t = pt.t != null ? pt.t.toFixed(4) : (activeTrajectory.timestamps?.[idx] ?? '');
      const x = pt.x != null ? pt.x.toFixed(4) : '';
      const y = pt.y != null ? pt.y.toFixed(4) : '';
      const z = pt.z != null ? pt.z.toFixed(4) : '';
      const speed = pt.speed_kmh != null ? pt.speed_kmh.toFixed(1) : '';
      const phase = pt.phase || (pt.is_predicted ? 'extrapolated' : isSimulation ? 'simulation' : has3DFlight ? 'fitted' : 'candidate');
      const isInterp = (pt.is_predicted || pt.is_interpolated || pt.interpolated) ? '1' : '0';
      const conf = pt.confidence != null ? pt.confidence.toFixed(3) : '';
      const px = pt.pixel_x != null ? pt.pixel_x.toFixed(1) : '';
      const py = pt.pixel_y != null ? pt.pixel_y.toFixed(1) : '';

      const evidenceType = pt.is_predicted ? 'projected' : isSimulation ? 'simulation' : has3DFlight ? 'fitted' : 'candidate';
      lines.push(`${frameIdx},${t},${x},${y},${z},${speed},${phase},${isInterp},${conf},${px},${py},${evidenceType}`);
    });

    const csvBlob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    const namePrefix = video?.filename ? video.filename.replace(/\.[^/.]+$/, '') : currentDeliveryType;
    link.href = url;
    link.download = `hawkeye_trajectory_${namePrefix}_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setFeedbackMsg('Trajectory telemetry exported successfully as CSV!');
  };

  const handleCaptureSnapshot = () => {
    try {
      const canvas = document.querySelector('.scene-panel canvas');
      if (!canvas) {
        setActionError('Open the 3D or Split view to capture the Hawk-Eye scene.');
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const namePrefix = video?.filename ? video.filename.replace(/\.[^/.]+$/, '') : currentDeliveryType;
      link.href = dataUrl;
      link.download = `hawkeye_3d_snapshot_${namePrefix}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setFeedbackMsg('High-resolution 3D pitch snapshot captured and downloaded!');
    } catch (err) {
      console.error('Failed to capture snapshot:', err);
      setActionError(`Could not capture the 3D view: ${err.message}`);
    }
  };


  return (
    <Box component="main" id="main-content" tabIndex={-1} className="review-workspace" sx={{ display: 'flex', flexDirection: 'column', bgcolor: 'var(--bg)', color: 'white' }}>
      <header className="review-header">
        <div className="review-header-line">
          <div className="review-heading">
            <Tooltip title="Back to workspace"><IconButton onClick={onBack} aria-label="Back to workspace"><ArrowBack fontSize="small" /></IconButton></Tooltip>
            <div>
              <span className="eyebrow">Crease / Lab</span>
              <h1>{isVideoMode ? 'Delivery analysis' : '3D replay studio'}</h1>
            </div>
          </div>
          <div className="review-controls">
            {!video && <FormControl size="small" sx={{ minWidth: { xs: 170, sm: 265 }, maxWidth: 360 }}>
              <Select value={currentDeliveryType} onChange={e => setCurrentDeliveryType(e.target.value)} inputProps={{ 'aria-label': 'Delivery source' }}>
                {PRESET_DELIVERIES.map(p => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
              </Select>
            </FormControl>}
            {video && <Typography className="review-filename" title={video.original_filename || video.filename} variant="body2">{video.original_filename || video.filename}</Typography>}
            {video && <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, value) => {
              if (value) { layoutChosen.current = true; setViewMode(value); }
            }} aria-label="Review layout">
              <ToggleButton value="video">Video</ToggleButton>{!smallScreen && <ToggleButton value="split">Split</ToggleButton>}<ToggleButton value="3d">3D</ToggleButton>
            </ToggleButtonGroup>}
          </div>
        </div>
        <details className="review-settings">
          <summary>Delivery settings & presentation tools</summary>
          <div className="settings-content">
            {!isVideoMode && <>
              <FormControl size="small" sx={{ minWidth: 180 }}><Select value={pitchType} onChange={e => setPitchType(e.target.value)} inputProps={{ 'aria-label': 'Pitch surface' }}>
                <MenuItem value="standard_hard">Standard hard pitch</MenuItem><MenuItem value="green_seamer">Green seamer</MenuItem><MenuItem value="dry_dusty">Dry & dusty</MenuItem><MenuItem value="damp_clay">Damp clay</MenuItem>
              </Select></FormControl>
              <FormControl size="small" sx={{ minWidth: 138 }}><Select value={spinRPM} onChange={e => setSpinRPM(e.target.value)} inputProps={{ 'aria-label': 'Spin rate' }}>
                <MenuItem value={PRESET_SPIN}>Preset spin</MenuItem>
                {[1600, 2100, 2400, 2800].map(rpm => <MenuItem key={rpm} value={rpm}>{rpm.toLocaleString()} RPM</MenuItem>)}
              </Select></FormControl>
            </>}
            <FormControlLabel control={<Switch size="small" checked={showBroadcastHUD} onChange={e => setShowBroadcastHUD(e.target.checked)} />} label="Scene telemetry" />
            <FormControlLabel control={<Switch size="small" checked={showCommentary} onChange={e => setShowCommentary(e.target.checked)} />} label="Commentary" />
          </div>
        </details>
        {presetError && <Alert severity="warning" sx={{ mt: 1 }} action={
          <Button size="small" color="inherit" onClick={() => { setPitchType(STANDARD_PITCH); setSpinRPM(PRESET_SPIN); }}>
            Use standard settings
          </Button>
        }>Custom simulation settings require a connection to the analysis server.</Alert>}
        {loadingPreset && <Box role="status" sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={12} /><Typography variant="caption" color="text.secondary">Preparing the delivery…</Typography></Box>}
        {videoId && !currentPlayback && <Typography role="status" variant="body2" sx={{ mt: 1 }}>Opening source video…</Typography>}
        {(mediaError || currentPlayback?.error) && <Alert severity="error" sx={{ mt: 1 }} action={
          <Button color="inherit" size="small" onClick={() => {
            setPlayback(null);
            setMediaError('');
            setPlaybackAttempt(attempt => attempt + 1);
          }}>Retry playback</Button>
        }>{mediaError || 'Playback could not be authorized. Retry or return to your delivery library.'}</Alert>}
        {actionError && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setActionError('')}>{actionError}</Alert>}
      </header>

      {/* Main Review Area */}
      <Box className="review-stage" sx={{
        flex: 1,
        minHeight: 0,
        display: { xs: 'flex', lg: 'grid' },
        gridTemplateColumns: video && viewMode === 'split'
          ? 'minmax(0, 1.35fr) minmax(0, 1fr) var(--inspector-w)'
          : 'minmax(0, 1fr) var(--inspector-w)',
        gridTemplateRows: 'minmax(0, 1fr)',
        flexDirection: { xs: 'column', lg: 'row' },
        overflow: { xs: 'visible', lg: 'hidden' },
        position: 'relative'
      }}>
        {/* Video Panel: ALWAYS mounted in DOM to maintain authoritative playback clock across all view modes */}
        {video && (
          <Box
            ref={videoContainerRef}
            className={viewMode === '3d' ? 'source-panel is-hidden' : 'source-panel'}
            onClick={event => {
              const media = videoRef.current;
              if (!pickingCorner || !videoRect || !media?.videoWidth || media.seeking) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - bounds.left - videoRect.left) / videoRect.width;
              const y = (event.clientY - bounds.top - videoRect.top) / videoRect.height;
              if (x < 0 || x >= 1 || y < 0 || y >= 1) return;
              setPickedPoint({ index: pickingCorner.index,
                x: Math.min(Math.round(x * media.videoWidth), media.videoWidth - 1),
                y: Math.min(Math.round(y * media.videoHeight), media.videoHeight - 1) });
              setPickingCorner(null);
            }}
            sx={{
              flex: viewMode === 'split' ? 1 : (viewMode === 'video' ? 1.5 : 'none'),
              height: viewMode === '3d' ? 0 : { xs: 320, lg: 'auto' },
              minHeight: viewMode === '3d' ? 0 : { xs: 260, lg: 'auto' },
              width: viewMode === '3d' ? 0 : 'auto',
              overflow: 'hidden',
              visibility: viewMode === '3d' ? 'hidden' : 'visible',
              position: viewMode === '3d' ? 'absolute' : 'relative',
              pointerEvents: viewMode === '3d' ? 'none' : 'auto',
              bgcolor: 'black',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: { xs: 'none', lg: viewMode === '3d' ? 'none' : '1px solid var(--line)' },
              borderBottom: { xs: viewMode === '3d' ? 'none' : '1px solid var(--line)', lg: 'none' }
            }}
          >
            <video
              aria-label="Uploaded delivery video"
              ref={videoRef}
              src={videoUrl}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              playsInline
              preload="auto"
              muted
              crossOrigin="anonymous"
            />
            {pickingCorner && <Box sx={{ position: 'absolute', top: 50, left: 12, right: 12, bgcolor: 'background.paper', p: 1 }}>
              <Typography role="status">Mark corner {pickingCorner.index + 1} of 4 · {pickingCorner.label}</Typography>
              <Button onClick={event => { event.stopPropagation(); setPickingCorner(null); }}>Cancel picking</Button>
            </Box>}

            {videoRect && !pickingCorner && (showCvOverlay || showCvTrail) && (
              <svg aria-hidden="true" viewBox={`0 0 ${videoInfo?.width || videoRef.current?.videoWidth || 1280} ${videoInfo?.height || videoRef.current?.videoHeight || 720}`}
                style={{ position: 'absolute', pointerEvents: 'none', ...videoRect }}>
                <defs>
                  <radialGradient id="ballGlow">
                    <stop offset="0%" stopColor="#7df9ff" stopOpacity="0.95" />
                    <stop offset="55%" stopColor="#00e5ff" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#00e5ff" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* Comet trail: newest segments brightest and widest, fading out behind the ball */}
                {showCvTrail && ballOnScreen && recentTrail.slice(1).map((point, i) => {
                  const prev = recentTrail[i];
                  const k = (i + 1) / recentTrail.length;
                  return <line key={point.t} x1={prev.pixel_x} y1={prev.pixel_y} x2={point.pixel_x} y2={point.pixel_y}
                    stroke="#00e5ff" strokeOpacity={0.15 + 0.75 * k} strokeWidth={1 + 4 * k} strokeLinecap="round"
                    vectorEffect="non-scaling-stroke" />;
                })}
                {showCvOverlay && ballOnScreen && (
                  <g transform={`translate(${currentTrackPoint.pixel_x}, ${currentTrackPoint.pixel_y})`} style={{ pointerEvents: 'none' }}>
                    <circle r="18" fill="url(#ballGlow)" />
                    <circle r="11" fill="none" stroke={currentTrackPoint.is_predicted ? '#fbbf24' : '#e0fbff'} strokeWidth="1.5"
                      strokeOpacity="0.9" vectorEffect="non-scaling-stroke"
                      strokeDasharray={currentTrackPoint.is_predicted ? '3 3' : undefined} />
                    <circle r="2.5" fill="#ffffff" />
                  </g>
                )}
              </svg>
            )}

            <Box className="video-status" role="status" sx={{
              position: 'absolute',
              top: 'auto',
              bottom: 8,
              left: 8,
              right: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              bgcolor: 'rgba(10, 16, 26, 0.75)',
              backdropFilter: 'blur(8px)',
              px: 1.5,
              py: 0.6,
              borderRadius: 1.5,
              border: '1px solid rgba(255,255,255,0.1)'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: currentTrackPoint ? '#22c55e' : '#eab308' }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'white', letterSpacing: 0.5 }}>
                  {activeTrajectory?.delivery_name || 'Broadcast Video Feed'}
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                {ballOnScreen ? (currentTrackPoint.is_interpolated ? 'Interpolated from detections' : 'Candidate ball detection') : 'Source video'}
              </Typography>
            </Box>
          </Box>
        )}

        {/* 3D Hawk-Eye View Panel with Television Broadcast HUD */}
        {(viewMode === '3d' || viewMode === 'split') && (
          <Box className="scene-panel" sx={{
            flex: 1.3,
            height: { xs: 460, lg: 'auto' },
            minHeight: { xs: 420, lg: 0 },
            position: 'relative',
            overflow: 'hidden',
            bgcolor: 'var(--bg-deep)'
          }}>
            <HawkEyeViewer
              trajectoryData={has3DFlight ? activeTrajectory : null}
              isSimulation={isSimulation}
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              isSeeking={isSeeking || Boolean(videoRef.current?.seeking)}
              sourceAudioUrl={videoUrl}
              onSeek={(t) => handleSeek(null, t)}
              onOpenFlowHUD={() => setFlowHUDOpen(true)}
              onOpenReportCard={() => setReportCardOpen(true)}
            />

            {isVideoMode && activeTrajectory && !has3DFlight && (
              <Box sx={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%, -50%)', zIndex: 11,
                bgcolor: 'rgba(10, 22, 38, 0.9)', border: '1px solid rgba(245,158,11,0.5)', borderRadius: 2, p: 2, maxWidth: 380, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: '#fbbf24', fontWeight: 700 }}>3D flight not reconstructable</Typography>
                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                  {activeTrajectory.ball_detected
                    ? 'Use the video overlay to inspect the ball track. If both wicket lines are visible, try correcting the pitch landmarks.'
                    : 'Play the original clip or try a clearer delivery from a fixed camera.'}
                </Typography>
              </Box>
            )}

            {/* In-Viewer Television Delivery telemetry Overlay */}
            {showBroadcastHUD && (
              <Paper sx={{
                position: 'absolute',
                top: 14,
                left: 14,
                zIndex: 10,
                bgcolor: 'rgba(10, 22, 38, 0.88)',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                borderRadius: 2.5,
                p: 1.5,
                minWidth: 260,
                maxWidth: 320,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 16px rgba(56, 189, 248, 0.15)'
              }}>
                {/* Header with TV broadcast LIVE badge & minimize */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef4444', boxShadow: '0 0 8px #ef4444' }} />
                    <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.8, color: '#38bdf8', textTransform: 'uppercase', fontSize: '0.68rem' }}>
                      HAWK-EYE BROADCAST HUD
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    onClick={() => setHudMinimized(!hudMinimized)}
                    sx={{ color: '#94a3b8', p: 0.2 }}
                    aria-label="Toggle HUD details"
                  >
                    {hudMinimized ? <Visibility sx={{ fontSize: 16 }} /> : <VisibilityOff sx={{ fontSize: 16 }} />}
                  </IconButton>
                </Box>

                {!hudMinimized && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {/* Release & Bounce Speed */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem' }}>Speed (Rel / Bnc)</Typography>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.82rem' }}>
                        <span style={{ color: '#38bdf8' }}>{releaseSpeed ?? '—'}</span> km/h <span style={{ color: '#adb8c7' }}>|</span> {bounceSpeed ?? '—'} km/h
                      </Typography>
                    </Box>

                    {/* Deviation Angle */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem' }}>Deviation Angle</Typography>
                      <Chip
                        label={deviationAngle == null ? 'Unavailable' : `${deviationAngle >= 0 ? '+' : ''}${deviationAngle}°`}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          bgcolor: 'rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          border: '1px solid rgba(56, 189, 248, 0.35)'
                        }}
                      />
                    </Box>

                    {/* Length Zone */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem' }}>Length Zone</Typography>
                      <Chip
                        label={lengthZone || 'Unavailable'}
                        size="small"
                        sx={{
                          height: 20,
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          bgcolor: `${lengthZoneColor}25`,
                          color: lengthZoneColor,
                          border: `1px solid ${lengthZoneColor}80`
                        }}
                      />
                    </Box>

                    {/* LBW Impact Probability Bar */}
                    <Box sx={{ mt: 0.3 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                        <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>LBW Impact Meter</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 800, color: lbwColor, fontSize: '0.72rem' }}>
                          {lbwProbability != null ? `${lbwProbability}% Hitting` : 'Unavailable'}
                        </Typography>
                      </Box>
                      <Box sx={{ width: '100%', height: 6, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${lbwProbability ?? 0}%`,
                          height: '100%',
                          bgcolor: lbwColor,
                          boxShadow: `0 0 8px ${lbwColor}`,
                          transition: 'width 0.4s ease'
                        }} />
                      </Box>
                    </Box>
                  </Box>
                )}
              </Paper>
            )}
          </Box>
        )}

        {/* Broadcast DRS Decision & Telemetry Sidebar */}
        <Box component="aside" aria-label="Delivery evidence" className="review-inspector" sx={{
          width: '100%',
          flexShrink: 0,
          bgcolor: 'var(--surface)',
          borderLeft: { xs: 'none', lg: '1px solid var(--line)' },
          borderTop: { xs: '1px solid var(--line)', lg: 'none' },
          p: 2,
          overflowY: 'auto'
        }}>
          {/* Inspector heading */}
          <div className="inspector-head">
            <Gavel sx={{ color: 'var(--accent)', fontSize: 20 }} />
            <h2 className="inspector-title">Hawk-Eye review</h2>
            <span className={`pill ${isSimulation ? 'pill-violet' : 'pill-accent'}`}>{evidenceKind}</span>
          </div>

          {isVideoMode && <section className="inspector-card" aria-label="Evidence overview">
            <Typography component="h3" variant="subtitle1">Available evidence</Typography>
            <Typography variant="body2" color="text.secondary">
              {has3DFlight ? 'Physics-fitted 3D flight; not direct 3D measurements.'
                : preparedPoints.length ? 'Candidate pixels are not verified ball positions.'
                  : 'Original footage is available even without a usable ball track.'}
            </Typography>
            {activeTrajectory && <Typography variant="body2" sx={{ mt: 1 }}>
              {preparedPoints.length} candidate samples
              {Number.isFinite(firstDetection) && ` · ${firstDetection.toFixed(2)}–${lastDetection.toFixed(2)} s`}
            </Typography>}
            {coverage !== null && <Typography variant="caption" color="text.secondary">
              {candidateFrames.size} of {sourceFrameCount} source frames have candidates ({coverage.toFixed(1)}%). This is coverage, not accuracy.
            </Typography>}
            {onRetryAnalysis && <Button fullWidth variant="outlined" sx={{ mt: 1.5 }}
              disabled={analysisPending || retrySubmitting || trajectoryLoading} onClick={onRetryAnalysis}>
              {retrySubmitting ? 'Starting analysis…' : 'Retry analysis'}
            </Button>}
            {retryError && <Alert severity="error" sx={{ mt: 1 }}>{retryError}</Alert>}
          </section>}
          {eventJumps.length > 0 && <section className="inspector-card" aria-label="Flight event jumps">
            <Typography component="h3" variant="subtitle2">Jump to event</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              {eventJumps.map(event => <Button key={event.label} size="small" variant="outlined"
                onClick={() => seekDetection(event.time)}>{event.label} · {event.time.toFixed(2)}s</Button>)}
            </Box>
          </section>}

          {/* Loading state for uploaded video trajectory */}
          {isVideoMode && trajectoryLoading && (
            <div className="inspector-card is-centered" role="status">
              <CircularProgress size={16} sx={{ color: 'var(--accent)' }} />
              <Typography variant="body2" sx={{ color: 'var(--muted)' }}>
                Loading trajectory analysis…
              </Typography>
            </div>
          )}

          {isVideoMode && initialTrajectory && analysisPending && (
            <div className="inspector-card" role="status">
              <Typography variant="body2" fontWeight={700}>Reanalysing delivery</Typography>
              <Typography variant="body2" color="text.secondary">
                Previous analysis remains visible until the replacement is ready.
              </Typography>
              <LinearProgress aria-label="Reanalysis progress"
                variant={trackingProgress > 0 ? 'determinate' : 'indeterminate'}
                value={trackingProgress ?? 0} />
            </div>
          )}
          {isVideoMode && analysisStatus?.job_state === 'failed' && analysisStatus.has_previous_result && (
            <div className="inspector-card" role="status">
              <Typography variant="body2" color="warning.main">
                Reanalysis failed. Showing the previous saved analysis.
              </Typography>
            </div>
          )}
          {isVideoMode && analysisStatus?.connection_error && (
            <div className="inspector-card" role="status">
              Connection interrupted. Retrying status automatically.
            </div>
          )}

          {/* Error state */}
          {isVideoMode && trajectoryError === 'not_processed' && !trajectoryLoading && (
            <div className="inspector-card" role="status">
              <Typography variant="body2" fontWeight={700}>Analysing delivery</Typography>
              <Typography variant="body2" color="text.secondary">
                You can watch the clip while ball tracking runs.
              </Typography>
              <LinearProgress
                aria-label="Ball tracking progress"
                variant={trackingProgress > 0 ? 'determinate' : 'indeterminate'}
                value={trackingProgress ?? 0}
              />
            </div>
          )}
          {isVideoMode && trajectoryError && trajectoryError !== 'not_processed' && !trajectoryLoading && (
            <div className="inspector-card is-centered is-stacked">
              <Typography variant="body2" sx={{ color: 'var(--bad)' }}>
                {trajectoryError === 'processing_failed'
                  ? 'Tracking failed. Retry analysis here or try a clearer, fixed-camera clip.'
                  : 'Analysis could not be loaded. Return to your deliveries and try again.'}
              </Typography>
              <Button onClick={onBack} size="small">Back to deliveries</Button>
            </div>
          )}

          {/* Official DRS Evaluation Card (Only when verified event evidence exists) */}
          {!trajectoryLoading && !loadingPreset && !presetError && (
            <>
              {drs ? (
                <section className="inspector-card drs-card" aria-labelledby="drs-title">
                  {/* Card Header: Title & Predicted Trajectory Badge */}
                  <div className="card-head">
                    <div className="card-title-row">
                      <Timeline sx={{ color: 'var(--accent)', fontSize: 18 }} />
                      <h3 id="drs-title" className="card-title">{isSimulation ? 'Ball flight & decision' : 'Hawk-Eye Predicted Trajectory'}</h3>
                    </div>
                    {(!isSimulation || drs.isPredicted) && (
                      <span className="pill pill-accent">
                        {isSimulation ? 'PROJECTED FLIGHT' : drs.isPredicted ? 'HAWK-EYE PREDICTED' : 'RECONSTRUCTED'}
                      </span>
                    )}
                  </div>

                  <ol className="verdict-list" aria-live="polite">
                    {[
                      { key: 'pitching', label: 'Pitching', revealed: drsReveal.pitching, pending: 'TRACKING…', text: drs.pitching, tone: verdictTone('pitching', drs.pitching) },
                      { key: 'impact', label: 'Impact', revealed: drsReveal.impact, pending: 'TRACKING…', text: drs.impact, tone: verdictTone('impact', drs.impact) },
                      { key: 'wickets', label: 'Wickets', revealed: drsReveal.wickets, pending: 'PROJECTING…',
                        text: drs.hit_stump ? `${drs.wickets} (${drs.hit_stump})` : drs.wickets, tone: verdictTone('wickets', drs.wickets) },
                    ].map((row, index) => (
                      <li key={row.key} className={`verdict-row ${row.revealed ? 'is-revealed' : 'is-pending'}`}>
                        <span className="verdict-step" aria-hidden="true">{index + 1}</span>
                        <span className="verdict-label">{row.label}</span>
                        <span className={`verdict-chip ${row.revealed ? `tone-${row.tone}` : 'tone-pending'}`}>
                          {row.revealed ? row.text : row.pending}
                        </span>
                      </li>
                    ))}
                  </ol>

                  {/* Final Big Decision Banner */}
                  {!drsReveal.decision ? (
                    <div className="decision-banner tone-pending">
                      <span className="decision-text">DECISION PENDING</span>
                      <span className="decision-note">Play the delivery through to the stumps</span>
                    </div>
                  ) : (
                    <div className={`decision-banner tone-${decisionTone(drs.decision)}`} role="status">
                      <span className="decision-text">
                        {{ out: 'OUT', notout: 'NOT OUT', umpire: "UMPIRE'S CALL", neutral: 'NO VERDICT' }[decisionTone(drs.decision)]}
                      </span>
                      {drs.decision.includes('(') && (
                        <span className="decision-note">{drs.decision}</span>
                      )}
                      {activeTrajectory?.drs_evaluation?.height_at_stumps_m != null && (
                        <span className="decision-note">
                          Ball height at stumps: {Math.round(activeTrajectory.drs_evaluation.height_at_stumps_m * 100)} cm (stumps 71 cm)
                        </span>
                      )}
                    </div>
                  )}
                  {activeTrajectory?.drs_evaluation?.line_observable === false && activeTrajectory.drs_evaluation.note && (
                    <Typography variant="caption" sx={{ color: 'var(--muted)', fontSize: '0.7rem' }}>
                      {activeTrajectory.drs_evaluation.note}
                    </Typography>
                  )}
                </section>
              ) : (
                !trajectoryError && (isVideoMode ? activeTrajectory && (
                  <section className="inspector-card drs-card" aria-label="LBW evidence">
                    <div className="decision-banner tone-neutral" role="status">
                      <span className="decision-text">NO VERDICT</span>
                      <span className="decision-note">{noVerdictReason}</span>
                    </div>
                    {!has3DFlight && canMarkPitch && (
                      <Button fullWidth variant="outlined" sx={{ mt: 1.25 }} onClick={() => {
                        setCalibrationOpen(true);
                        document.getElementById('pitch-landmarks')?.scrollIntoView?.({ block: 'nearest' });
                      }}>Mark pitch corners</Button>
                    )}
                    {projection && (
                      <ol className="verdict-list">
                        <li className="verdict-row is-revealed">
                          <span className="verdict-label">Wicket projection</span>
                          <span className="verdict-chip">{projection.wickets}</span>
                        </li>
                      </ol>
                    )}
                  </section>
                ) : (
                  <div className="inspector-card is-centered">Pick a delivery preset above to view DRS evaluation.</div>
                ))
              )}
            </>
          )}

          {/* Automated Delivery Classification & Umpiring Card */}
          {activeTrajectory && has3DFlight && (
            <section className="inspector-card" aria-labelledby="kinematics-title">
              <div className="card-head">
                <h3 id="kinematics-title" className="card-title">Delivery measurements</h3>
                {(activeTrajectory.is_no_ball || activeTrajectory.is_wide ||
                  (activeTrajectory.is_no_ball === false && activeTrajectory.is_wide === false)) && (
                  <span className={`pill ${activeTrajectory.is_no_ball || activeTrajectory.is_wide ? 'pill-bad' : 'pill-good'}`}>
                    {activeTrajectory.is_no_ball ? 'NO BALL' : activeTrajectory.is_wide ? 'WIDE' : 'LEGAL BALL'}
                  </span>
                )}
              </div>

              <div className="card-lead">
                {activeTrajectory.delivery_name || activeTrajectory.base_delivery_name || (lengthZone ? `${lengthZone} delivery` : 'Delivery')}
              </div>

              {(activeTrajectory.no_ball_reason || activeTrajectory.wide_reason) && (
                <Alert severity="warning" sx={{ py: 0.2, px: 1, fontSize: '0.75rem', bgcolor: 'rgba(245,158,11,0.12)', color: 'var(--warn)' }}>
                  {activeTrajectory.no_ball_reason || activeTrajectory.wide_reason}
                </Alert>
              )}

              <Box className="stat-grid">
                {[
                  { label: 'Release speed', value: releaseSpeed != null ? `${releaseSpeed} km/h` : '—', tone: 'accent' },
                  { label: 'Length', value: lengthZone || '—', tone: 'good' },
                  { label: 'Pitched', value: activeTrajectory.bounce_point?.y != null ? `${(10.06 - activeTrajectory.bounce_point.y).toFixed(2)} m from stumps` : '—' },
                  { label: 'After bounce', value: bounceSpeed != null ? `${bounceSpeed} km/h` : '—' },
                ].map(stat => (
                  <Box key={stat.label} className={`stat-tile ${stat.tone || ''}`}>
                    <span className="stat-label">{stat.label}</span>
                    <span className="stat-value">{stat.value}</span>
                  </Box>
                ))}
              </Box>
            </section>
          )}

          {/* Swing calculator & delivery classifier (measured air swing, seam deviation, pace, type) */}
          {activeTrajectory && has3DFlight && <SwingAnalysisCard trajectory={activeTrajectory} />}

          {/* Evidence, timing & calibration (fine print after the verdict) */}
          <Box className="evidence-block">
          {isVideoMode && activeTrajectory && <Typography variant="body2" color="text.secondary">
            {!activeTrajectory.ball_detected ? 'No ball detected. The original video is still available; try a clearer, fixed-camera clip.'
              : has3DFlight ? 'Approximate 3D reconstruction. Review the original footage for evidence.'
              : preparedPoints.length > 0
                ? `${preparedPoints.length} track samples · ${preparedPoints[0].t.toFixed(2)}–${preparedPoints[preparedPoints.length - 1].t.toFixed(2)} s`
                : '2D geometry only.'}
          </Typography>}
          {isVideoMode && preparedPoints.length > 0 && !mediaError && <section className="detection-controls" aria-label="Tracked replay">
            <Button variant="contained" startIcon={<PlayArrow />} disabled={preparedPoints.length < 2} onClick={playTrackedFlight}>Replay detections at ¼ speed</Button>
            <Button onClick={() => seekDetection(firstDetection)}>Jump to first tracked frame ({firstDetection.toFixed(2)}s)</Button>
            <div className="button-pair">
              <Button variant="outlined" disabled={!previousDetection} onClick={() => seekDetection(previousDetection.t)}>Previous detection</Button>
              <Button variant="outlined" disabled={!nextDetection} onClick={() => seekDetection(nextDetection.t)}>Next detection</Button>
            </div>
          </section>}
          {isVideoMode && activeTrajectory && <>
            <Typography variant="caption" color="text.secondary">
              Timing: {activeTrajectory.timing_source === 'decoder_pts' ? 'decoder presentation timestamps' : 'approximate / unverified'}.
              {' '}Calibration: {activeTrajectory.calibration_status === 'auto_camera' ? `camera solved automatically from ${activeTrajectory.debug_info?.camera_source || 'pitch features'}; physics-fitted flight`
                : activeTrajectory.calibration_status === 'manual_landmarks' ? 'camera solved from your pitch landmarks; physics-fitted flight'
                : activeTrajectory.calibration_status === 'stump_scaled' ? 'scaled from both sets of stumps; gravity-fitted flight'
                : activeTrajectory.calibration_status === 'manual_pitch_plane' ? 'manual pitch plane; height unverified' : 'unverified'}.
            </Typography>
            {activeTrajectory.ball_detected && !cutBeforeTrackEnd && !mediaError && !analysisPending && !retrySubmitting && <PitchCalibration key={video.id} videoId={video.id} trajectory={activeTrajectory} onApply={(data) => {
              setActiveTrajectory(data);
              setCalibrationOpen(false);
              if (!smallScreen && data.reconstruction_method === 'camera_ballistic_fit') setViewMode('split');
            }} pickedPoint={pickedPoint}
              open={calibrationOpen} onOpenChange={setCalibrationOpen}
              onPick={(index, label) => {
                seekDetection(0);
                setViewMode('video');
                setPickingCorner({ index, label });
                videoContainerRef.current?.scrollIntoView?.({ block: 'center' });
              }} />}
          </>}
          </Box>

          <details className="inspector-details"><summary>Measurements</summary>
          {/* Delivery measurements */}
          <div className="inspector-card details-card">
            {/* Header with TV Live Badge */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Speed sx={{ color: '#38bdf8', fontSize: 20 }} />
              <Typography variant="caption" sx={{ fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Delivery telemetry
              </Typography>
              <Chip
                label={isSimulation ? 'SIMULATION' : 'TRACKED'}
                size="small"
                sx={{
                  ml: 'auto',
                  bgcolor: isSimulation ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
                  color: isSimulation ? '#4ade80' : '#fbbf24',
                  border: `1px solid ${isSimulation ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`,
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  height: 18
                }}
              />
            </Box>

            {/* 1. Release Speed Gauge & Bounce Speed */}
            {releaseSpeed == null ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>Metric Speed</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'white' }}>— (Uncalibrated)</Typography>
                </Box>
                {activeTrajectory?.release_speed_px_per_sec != null && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="caption" sx={{ color: '#94a3b8' }}>Pixel Speed</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#38bdf8' }}>
                      {activeTrajectory.release_speed_px_per_sec} px/s
                    </Typography>
                  </Box>
                )}
              </Box>
            ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Release Speed
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 900, color: 'white', fontFamily: 'monospace' }}>
                  <span style={{ fontSize: '1.15rem', color: releaseSpeed >= 140 ? '#f87171' : releaseSpeed >= 120 ? '#fbbf24' : '#38bdf8' }}>
                    {releaseSpeed}
                  </span>
                  {' km/h '}
                  <span style={{ color: '#adb8c7', fontSize: '0.72rem' }}>
                    ({(releaseSpeed * 0.621371).toFixed(1)} mph)
                  </span>
                </Typography>
              </Box>

              {/* Speed Bar Gauge (0 to 160 km/h) */}
              <Box sx={{ position: 'relative', width: '100%', height: 8, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                <Box sx={{
                  width: `${Math.min(100, Math.max(0, (releaseSpeed / 160) * 100))}%`,
                  height: '100%',
                  bgcolor: releaseSpeed >= 140 ? '#ef4444' : releaseSpeed >= 120 ? '#f59e0b' : '#06b6d4',
                  boxShadow: `0 0 10px ${releaseSpeed >= 140 ? '#ef4444' : releaseSpeed >= 120 ? '#f59e0b' : '#06b6d4'}`,
                  transition: 'width 0.5s ease'
                }} />
              </Box>

              {/* Bounce Speed & Deceleration */}
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.4 }}>
                <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                  Bounce Speed:
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace' }}>
                  {bounceSpeed ?? '—'} km/h{' '}
                  {speedLossPct != null && <span style={{ color: '#f87171', fontSize: '0.65rem' }}>(-{speedLossPct}% decay)</span>}
                </Typography>
              </Box>
            </Box>
            )}

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            {/* 2. Deviation Angle in Degrees After Pitch Contact */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Pitch Deviation
                </Typography>
                <Chip
                  icon={<TrendingUp sx={{ fontSize: '13px !important', color: '#38bdf8 !important' }} />}
                  label={deviationAngle == null ? 'Unavailable' : `${deviationAngle >= 0 ? '+' : ''}${deviationAngle}°`}
                  size="small"
                  sx={{
                    fontWeight: 800,
                    fontSize: '0.72rem',
                    bgcolor: 'rgba(56, 189, 248, 0.18)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.4)',
                    height: 22
                  }}
                />
              </Box>
              <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem', fontWeight: 600 }}>
                {deviationLabel}
              </Typography>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            {/* 3. Length Zone Chip & Visual Pitch Representation */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Length Zone
                </Typography>
                <Chip
                  label={lengthZone || 'Unavailable'}
                  size="small"
                  sx={{
                    bgcolor: `${lengthZoneColor}25`,
                    color: lengthZoneColor,
                    border: `1px solid ${lengthZoneColor}80`,
                    fontWeight: 800,
                    fontSize: '0.72rem',
                    height: 22
                  }}
                />
              </Box>

              {/* Mini Segmented Pitch Length Map */}
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4, height: 6 }}>
                {[
                  { name: 'Yorker', color: '#ef4444' },
                  { name: 'Full Pitch', color: '#f59e0b' },
                  { name: 'Good Length', color: '#10b981' },
                  { name: 'Short Pitch', color: '#6366f1' },
                  { name: 'Bouncer', color: '#ec4899' }
                ].map((z) => {
                  const isActive = (lengthZone != null && (lengthZone.includes(z.name) || z.name.includes(lengthZone)));
                  return (
                    <Tooltip key={z.name} title={z.name} arrow>
                      <Box sx={{
                        flex: 1,
                        bgcolor: isActive ? z.color : 'rgba(255,255,255,0.1)',
                        borderRadius: 1,
                        boxShadow: isActive ? `0 0 8px ${z.color}` : 'none',
                        transition: 'all 0.3s'
                      }} />
                    </Tooltip>
                  );
                })}
              </Box>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            {/* 4. LBW Probability / Impact Meter */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  LBW Impact Probability
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 900, color: lbwProbability != null ? lbwColor : '#94a3b8', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {lbwProbability != null ? `${lbwProbability}% Hitting` : '— (Unavailable)'}
                </Typography>
              </Box>

              {lbwProbability != null ? (
                <>
                  <Box sx={{ width: '100%', height: 8, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
                    <Box sx={{
                      width: `${lbwProbability}%`,
                      height: '100%',
                      bgcolor: lbwColor,
                      boxShadow: `0 0 10px ${lbwColor}`,
                      transition: 'width 0.4s ease'
                    }} />
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.2 }}>
                    <Typography variant="caption" sx={{ color: '#adb8c7', fontSize: '0.68rem' }}>Target Plane</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#f72585', fontSize: '0.72rem' }}>
                      {activeTrajectory?.stump_plane_target?.hit_stump || (isSimulation ? 'Middle Stump Hit' : '—')}
                    </Typography>
                  </Box>
                </>
              ) : (
                <Typography variant="caption" sx={{ color: '#adb8c7', fontSize: '0.72rem' }}>
                  Single-camera footage — geometric reconstruction required for LBW analysis
                </Typography>
              )}
            </Box>
          </div>

          </details>
          {/* Save review notes Action */}
          <Box className="inspector-actions">
            <Button
              variant="contained"
              startIcon={<Gavel />}
              disabled={!video || !localStorage.getItem('token')}
              onClick={() => {
                const dec = drs?.decision || '';
                if (dec.includes('OUT') && !dec.includes('NOT OUT')) setReviewOutcome('OUT');
                else if (dec.includes("UMPIRE'S CALL")) setReviewOutcome("UMPIRE'S CALL");
                else setReviewOutcome('');
                setReviewDialogOpen(true);
              }}
              fullWidth
              sx={{ fontWeight: 700, fontSize: '0.85rem', py: 1.1 }}
            >
              Save reviewer assessment
            </Button>

            {!video && <Typography variant="caption" color="text.secondary">Upload a delivery after signing in to save reviewer notes.</Typography>}
            {/* Broadcast Flow HUD & Match Certificate Shortcuts */}
            <Box className="button-pair">
              <Button
                variant="outlined"
                fullWidth
                startIcon={<AccountTree sx={{ fontSize: 15 }} />}
                onClick={() => setFlowHUDOpen(true)}
                sx={{ fontSize: '0.78rem' }}
              >
                Decision Flow
              </Button>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<Article sx={{ fontSize: 15 }} />}
                onClick={() => setReportCardOpen(true)}
                color="success"
                sx={{ fontSize: '0.78rem' }}
              >
                Delivery report
              </Button>
            </Box>
            {savedReviewId && (
              <Chip
                label={`Review Saved: #${savedReviewId.substring(0, 8)}`}
                color="success"
                size="small"
                sx={{ fontWeight: 600, py: 0.5 }}
              />
            )}
          </Box>

          <details className="inspector-details review-export"><summary>Export data & capture view</summary>
          {/* Trajectory Telemetry Export Section (Category E.2) */}
          <div className="inspector-card details-card">
            <Box className="button-pair">
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<DataObject />}
                onClick={handleExportJSON}
                sx={{
                  color: '#38bdf8',
                  borderColor: 'rgba(56, 189, 248, 0.4)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  py: 0.6,
                  '&:hover': { borderColor: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' }
                }}
              >
                Export JSON
              </Button>
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<TableChart />}
                onClick={handleExportCSV}
                sx={{
                  color: '#4ade80',
                  borderColor: 'rgba(74, 222, 128, 0.4)',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  py: 0.6,
                  '&:hover': { borderColor: '#4ade80', bgcolor: 'rgba(74, 222, 128, 0.1)' }
                }}
              >
                Export CSV
              </Button>

            </Box>

            <Button
              variant="outlined"
              size="small"
              fullWidth
              startIcon={<CameraAlt />}
              onClick={handleCaptureSnapshot}
              sx={{
                color: '#e2e8f0',
                borderColor: 'rgba(255,255,255,0.2)',
                fontSize: '0.72rem',
                fontWeight: 600,
                py: 0.5,
                '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.06)' }
              }}
            >
              Capture 3D View (PNG)
            </Button>
          </div>

          </details>
          {/* Observable Computer Vision Diagnostics Panel */}
          <details className="inspector-details">
            <summary>CV diagnostics</summary>
          <div className="inspector-card details-card">
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Assessment sx={{ color: '#a78bfa', fontSize: 20 }} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase' }}>
                  Observable CV Diagnostics
                </Typography>
              </Box>
              {video && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={showCvOverlay}
                        onChange={(e) => setShowCvOverlay(e.target.checked)}
                        sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#00e5ff' } }}
                      />
                    }
                    label={<Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.65rem' }}>Crosshair</Typography>}
                    sx={{ m: 0 }}
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={showCvTrail}
                        onChange={(e) => setShowCvTrail(e.target.checked)}
                        sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#a78bfa' } }}
                      />
                    }
                    label={<Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.65rem' }}>Trail</Typography>}
                    sx={{ m: 0 }}
                  />
                </Box>
              )}
            </Box>

            {debugInfo ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Frames Analyzed</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: 'white' }}>
                    {debugInfo.frames_processed ?? '—'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>CV Detections (Measured)</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#4ade80' }}>
                    {debugInfo.measured_points ?? debugInfo.ball_detections ?? '—'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>KF Gap Predictions</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#fbbf24' }}>
                    {debugInfo.predicted_points ?? 0}
                  </Typography>
                </Box>

                {/* Measured Detection Continuity Bar */}
                {debugInfo.frames_processed > 0 && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, my: 0.4 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>Detector Continuity</Typography>
                      <Typography variant="caption" sx={{ color: '#00e5ff', fontWeight: 700, fontSize: '0.68rem' }}>
                        {Math.round(((debugInfo.measured_points || debugInfo.ball_detections || 0) / Math.max(1, debugInfo.frames_processed)) * 100)}% Measured
                      </Typography>
                    </Box>
                    <Box sx={{ width: '100%', height: 5, bgcolor: 'rgba(255,255,255,0.08)', borderRadius: 2.5, overflow: 'hidden' }}>
                      <Box sx={{
                        width: `${Math.min(100, Math.round(((debugInfo.measured_points || debugInfo.ball_detections || 0) / Math.max(1, debugInfo.frames_processed)) * 100))}%`,
                        height: '100%',
                        bgcolor: '#00e5ff',
                        borderRadius: 2.5
                      }} />
                    </Box>
                  </Box>
                )}

                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Pitch Detection</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: debugInfo.pitch_detected ? '#4ade80' : '#fbbf24' }}>
                    {debugInfo.pitch_detected ? 'Detected (HSV Green)' : 'Default Assumed'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="caption" sx={{ color: '#94a3b8' }}>Video Metadata</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#38bdf8' }}>
                    {videoInfo?.width ? `${videoInfo.width}×${videoInfo.height} @ ${videoInfo.fps || 30}fps` : 'Standard 30 fps'}
                  </Typography>
                </Box>

                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleExportCVDiagnostics}
                  startIcon={<DataObject sx={{ fontSize: 14 }} />}
                  sx={{
                    mt: 0.8,
                    color: '#a78bfa',
                    borderColor: 'rgba(167, 139, 250, 0.4)',
                    fontSize: '0.68rem',
                    py: 0.3,
                    textTransform: 'none',
                    '&:hover': {
                      borderColor: '#a78bfa',
                      bgcolor: 'rgba(167, 139, 250, 0.1)'
                    }
                  }}
                >
                  Export CV Diagnostics JSON
                </Button>
              </Box>
            ) : (
              <Typography variant="caption" sx={{ color: '#adb8c7' }}>
                {isSimulation ? 'Physics simulation delivery — analytical aerodynamics model.' : 'No CV diagnostics available for this clip.'}
              </Typography>
            )}
          </div>
          </details>

          {/* Interactive Instructions Card */}
          <details className="inspector-details controls-guide">
            <summary>Controls guide</summary>
          <Box className="inspector-card details-card">
            <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5, fontWeight: 600 }}>
              Viewer controls
            </Typography>
            <Typography variant="caption" sx={{ color: '#adb8c7', display: 'block', fontSize: '0.7rem' }}>
              • Drag left mouse to orbit 360°
              <br />• Scroll wheel to zoom in/out
              <br />• Switch cameras (Chase Cam, Batsman POV, Umpire)
              <br />• Toggle 2D tracking reticle over video
              <br />• Click trajectory markers for telemetry
            </Typography>
          </Box>
          </details>
        </Box>
      </Box>

      {/* Spoken AI Voice Commentary & Visual Closed-Captions Subtitle Strip */}
      {showCommentary && <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: 0.8, bgcolor: 'var(--bg-deep)', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <DRSCommentary
          trajectoryData={activeTrajectory}
          currentTime={currentTime}
          isPlaying={isPlaying}
          showControls={true}
          showTicker={true}
        />
      </Box>}

      {/* Bottom Timeline Controls */}
      <Paper className="review-playback" elevation={0} sx={{
        borderRadius: 0,
        bgcolor: 'var(--surface)',
        px: { xs: 2, sm: 3 },
        py: 1.25,
        borderTop: '1px solid var(--line)'
      }}>
        {/* Timeline Slider */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
          <Typography variant="caption" className="mono" sx={{ color: 'var(--muted)', minWidth: 60 }}>
            {formatTime(currentTime)}
          </Typography>
          <Slider
            aria-label="Delivery timeline"
            getAriaValueText={value => `${formatTime(value)} of ${formatTime(duration)}`}
            value={Math.min(currentTime, duration || 1.5)}
            min={0}
            max={duration || 1.5}
            step={0.01}
            onChange={handleSeek}
            onChangeCommitted={() => setIsSeeking(false)}
            sx={{
              color: 'var(--accent)',
              '& .MuiSlider-thumb': { width: 14, height: 14 },
              '& .MuiSlider-track': { height: 4 },
              '& .MuiSlider-rail': { height: 4, bgcolor: 'rgba(255,255,255,0.18)' }
            }}
          />
          <Typography variant="caption" className="mono" sx={{ color: 'var(--muted)', minWidth: 60, textAlign: 'right' }}>
            {formatTime(duration)}
          </Typography>
        </Box>

        {/* Playback & Speed Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton onClick={restart} sx={{ color: 'text.primary' }} aria-label="Restart">
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
            <Button
              onClick={togglePlay}
              disabled={!video && !activeTrajectory}
              variant="contained"
              startIcon={isPlaying ? <Pause /> : <PlayArrow />}
              sx={{
                color: 'primary.contrastText',
                bgcolor: 'var(--accent)',
                '&:hover': { bgcolor: 'var(--accent-strong)' },
                height: 44,
                mx: 0.5
              }}
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? 'Pause' : 'Play delivery'}
            </Button>
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
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }} role="group" aria-label="Playback speed">
            <Typography variant="caption" sx={{ color: 'var(--muted)', mr: 0.5, display: { xs: 'none', sm: 'inline' } }}>Speed</Typography>
            {PLAYBACK_RATES.map((rate) => (
              <Button
                key={rate}
                size="small"
                variant={playbackRate === rate ? 'contained' : 'outlined'}
                aria-pressed={playbackRate === rate}
                onClick={() => handleRateChange(rate)}
                sx={{
                  minWidth: 42,
                  py: 0.3,
                  fontSize: '0.75rem',
                  color: playbackRate === rate ? 'primary.contrastText' : 'text.primary',
                  borderColor: 'divider',
                  bgcolor: playbackRate === rate ? 'var(--accent)' : 'transparent',
                  '&:hover': {
                    bgcolor: playbackRate === rate ? 'var(--accent-strong)' : 'rgba(255,255,255,0.08)'
                  }
                }}
              >
                {rate}x
              </Button>
            ))}
          </Box>
        </Box>
      </Paper>

      {/* Save delivery review Dialog */}
      <Dialog
        open={reviewDialogOpen}
        onClose={() => setReviewDialogOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: 'var(--card)',
            color: 'text.primary',
            borderRadius: 3,
            border: '1px solid var(--line-strong)',
            width: { xs: 'calc(100% - 32px)', sm: 440 },
            p: 1
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Gavel /> Save reviewer assessment
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" sx={{ color: '#94a3b8', mb: 0.5, fontWeight: 600 }}>Decision Outcome</Typography>
            <Select
              displayEmpty
              inputProps={{ 'aria-label': 'Decision outcome' }}
              value={reviewOutcome}
              onChange={(e) => setReviewOutcome(e.target.value)}
              sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1.5 }}
            >
              <MenuItem value="" disabled>Select your assessment</MenuItem>
              <MenuItem value="OUT">OUT</MenuItem>
              <MenuItem value="NOT OUT">NOT OUT</MenuItem>
              <MenuItem value="UMPIRE'S CALL">{"UMPIRE'S CALL"}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" sx={{ color: '#94a3b8', mb: 0.5, fontWeight: 600 }}>Review Category</Typography>
            <Select
              inputProps={{ 'aria-label': 'Review category' }}
              value={reviewType}
              onChange={(e) => setReviewType(e.target.value)}
              sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1.5 }}
            >
              <MenuItem value="LBW">LBW (Leg Before Wicket)</MenuItem>
              <MenuItem value="Bowled">Bowled</MenuItem>
              <MenuItem value="Caught Behind">Caught Behind / Edge</MenuItem>
              <MenuItem value="Run Out">Run Out</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Review notes"
            multiline
            rows={3}
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            variant="outlined"
            size="small"
            fullWidth
            placeholder="e.g. Trajectory confirms ball pitched in line and hitting middle stump."
            InputLabelProps={{ sx: { color: '#94a3b8' } }}
            InputProps={{ sx: { color: 'white', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1.5 } }}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setReviewDialogOpen(false)} sx={{ color: '#94a3b8' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveReview}
            disabled={savingReview || !reviewOutcome}
            sx={{ fontWeight: 700 }}
          >
            {savingReview ? 'Saving...' : 'Save Decision'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Official Review Save Notification */}
      <Snackbar
        open={!!reviewSuccessMsg}
        autoHideDuration={4000}
        onClose={() => setReviewSuccessMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" onClose={() => setReviewSuccessMsg('')} sx={{ width: '100%', fontWeight: 600 }}>
          {reviewSuccessMsg}
        </Alert>
      </Snackbar>

      {/* Export & Action Feedback Notification */}
      <Snackbar
        open={!!feedbackMsg}
        autoHideDuration={4000}
        onClose={() => setFeedbackMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert severity="info" onClose={() => setFeedbackMsg('')} sx={{ width: '100%', fontWeight: 600, bgcolor: 'var(--card)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
          {feedbackMsg}
        </Alert>
      </Snackbar>

      {/* TV Broadcast 3-Stage Decision Flowchart Modal */}
      <DecisionFlowHUD
        open={flowHUDOpen}
        onClose={() => setFlowHUDOpen(false)}
        trajectoryData={activeTrajectory}
        autoPlaySequence={true}
      />

      {/* Delivery report & Delivery report Modal */}
      <MatchReportCard
        open={reportCardOpen}
        onClose={() => setReportCardOpen(false)}
        trajectoryData={activeTrajectory}
        videoSource={video?.original_filename || video?.filename || currentDeliveryType}
      />
    </Box>
  );
}
