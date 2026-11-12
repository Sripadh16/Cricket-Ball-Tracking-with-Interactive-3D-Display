import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  Box, IconButton, Typography, Chip, Slider, ToggleButton, ToggleButtonGroup,
  Paper, Button, Select, MenuItem, FormControl, Divider, CircularProgress,
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
import api, { API_BASE_URL } from '../api/client';
import { prepareTrajectory, sampleTrajectoryAtTime, containRect } from '../utils/trajectory';
import { subscribeMediaClock } from '../utils/mediaClock';

const PLAYBACK_RATES = [0.1, 0.25, 0.5, 1];

const PRESET_DELIVERIES = [
  { id: 'inswinger_lbw', label: 'Fast inswinger (142 km/h)', decision: 'OUT' },
  { id: 'offcutter_bowled', label: 'Good length off-cutter (132 km/h)', decision: 'OUT' },
  { id: 'bouncer_missing', label: 'Sharp bouncer (148 km/h)', decision: 'NOT OUT' },
  { id: 'legspin_umpires_call', label: 'Leg break (88 km/h)', decision: "UMPIRE'S CALL" }
];

export default function DRSReview({
  video,
  trajectoryData: initialTrajectory,
  trajectoryLoading = false,
  trajectoryError = null,
  onBack
}) {
  const smallScreen = useMediaQuery('(max-width:767px)');
  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(null);
  // Request ID ref to prevent out-of-order async preset/video responses from overwriting active trajectory
  const activeDeliveryFetchId = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1.5);
  const [playbackRate, setPlaybackRate] = useState(video ? 1 : 0.5);
  const [viewMode, setViewMode] = useState(video ? (smallScreen ? 'video' : 'split') : '3d');
  const [currentDeliveryType, setCurrentDeliveryType] = useState(video ? 'video' : 'inswinger_lbw');
  const [activeTrajectory, setActiveTrajectory] = useState(initialTrajectory);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [showCvOverlay, setShowCvOverlay] = useState(true);
  const [showCvTrail, setShowCvTrail] = useState(true);
  const [pickingCorner, setPickingCorner] = useState(null);
  const [pickedPoint, setPickedPoint] = useState(null);
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

  // Pitch surface & spin RPM state for aerodynamic simulation presets
  const [pitchType, setPitchType] = useState('standard_hard');
  const [spinRPM, setSpinRPM] = useState(2100);

  // Load preset delivery data with aerodynamics & pitch restitution parameters and request guard
  const loadPresetDelivery = useCallback(async (deliveryType, pType = pitchType, rpm = spinRPM) => {
    const fetchId = ++activeDeliveryFetchId.current;
    setLoadingPreset(true);
    setActionError('');
    try {
      const response = await api.get(`/videos/presets/${deliveryType}`, {
        params: {
          pitch_type: pType,
          rpm: rpm || undefined
        }
      });
      if (fetchId !== activeDeliveryFetchId.current) return;
      setActiveTrajectory(response.data);
      setDuration(response.data.video_duration || 1.5);
      setCurrentTime(0);
      setIsPlaying(false);
    } catch (err) {
      if (fetchId === activeDeliveryFetchId.current) {
        console.error('Failed to load preset delivery:', err);
        setActionError('Could not load the simulation. Check the server connection and try again.');
      }
    } finally {
      if (fetchId === activeDeliveryFetchId.current) {
        setLoadingPreset(false);
      }
    }
  }, [pitchType, spinRPM]);

  // Handle switching delivery presets
  const handleDeliveryChange = (newType) => {
    activeDeliveryFetchId.current++;
    videoRef.current?.pause();
    setIsPlaying(false);
    setCurrentTime(0);
    setCurrentDeliveryType(newType);
    if (newType === 'video') {
      setActiveTrajectory(initialTrajectory);
      if (videoRef.current) {
        setDuration(videoRef.current.duration || 1.5);
      }
      setViewMode(smallScreen ? 'video' : 'split');
    } else {
      if (video) loadPresetDelivery(newType, pitchType, spinRPM);
      setViewMode('3d');
    }
  };

  const handlePitchTypeChange = (newPitch) => {
    setPitchType(newPitch);
    if (video && currentDeliveryType !== 'video') {
      loadPresetDelivery(currentDeliveryType, newPitch, spinRPM);
    }
  };

  const handleRPMChange = (newRPM) => {
    setSpinRPM(newRPM);
    if (video && currentDeliveryType !== 'video') {
      loadPresetDelivery(currentDeliveryType, pitchType, newRPM);
    }
  };

  // Load initial preset if no video is loaded
  useEffect(() => {
    if (!video && !initialTrajectory && !trajectoryLoading) {
      loadPresetDelivery(currentDeliveryType);
    }
  }, [video, initialTrajectory, trajectoryLoading, loadPresetDelivery, currentDeliveryType]);

  // Keep the mounted media element authoritative across layout changes.
  useEffect(() => {
    const media = videoRef.current;
    if (!media || currentDeliveryType !== 'video') return;
    setMediaError('');
    return subscribeMediaClock(media, (time, fromFrame) => {
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
      videoRef.current.currentTime = value;
    } else { setCurrentTime(value); setIsSeeking(false); }
  };

  const handleRateChange = (rate) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  };

  const restart = () => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      videoRef.current.currentTime = 0;
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
      videoRef.current.currentTime = clamped;
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

  // Authenticated video stream URL with token query parameter for HTML5 video
  const token = localStorage.getItem('token');
  const videoUrl = video?.id
    ? `${API_BASE_URL}/videos/${video.id}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
    : '';

  const drs = typeof activeTrajectory?.drs_evaluation?.decision === 'string' ? activeTrajectory.drs_evaluation : null;
  const debugInfo = activeTrajectory?.debug_info;
  const videoInfo = activeTrajectory?.video_info;
  const isVideoMode = currentDeliveryType === 'video';
  const isSimulation = !isVideoMode;

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
    // Real upload: return null if not measured
    if (activeTrajectory?.release_speed_kmh != null) {
      return Number(activeTrajectory.release_speed_kmh.toFixed(1));
    }
    const pts = activeTrajectory?.points;
    if (pts && pts.length > 0 && pts[0].speed_kmh != null) {
      return Number(pts[0].speed_kmh.toFixed(1));
    }
    return null; // unknown — do not invent a value
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
    if (lbwProbability >= 70) return '#ef4444';
    if (lbwProbability >= 35) return '#f59e0b';
    return '#10b981';
  }, [lbwProbability]);

  const preparedPoints = useMemo(() => prepareTrajectory(activeTrajectory?.points), [activeTrajectory]);
  const currentTrackPoint = useMemo(() => sampleTrajectoryAtTime(preparedPoints, currentTime), [preparedPoints, currentTime]);
  const recentTrail = useMemo(() => preparedPoints.filter(point => point.t <= currentTime && point.t >= currentTime - 0.3
    && Number.isFinite(point.pixel_x) && Number.isFinite(point.pixel_y)), [preparedPoints, currentTime]);

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
        hit_stump: drs?.hit_stump || activeTrajectory.stump_plane_target?.hit_stump || 'N/A',
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
      points_count: activeTrajectory.points?.length || 0,
      trajectory_points: (activeTrajectory.points || []).map((pt, idx) => ({
        index: pt.frame_idx ?? idx,
        timestamp_s: pt.t ?? (activeTrajectory.timestamps ? activeTrajectory.timestamps[idx] : null),
        x_meters: pt.x != null ? Number(pt.x.toFixed(4)) : null,
        y_meters: pt.y != null ? Number(pt.y.toFixed(4)) : null,
        z_meters: pt.z != null ? Number(pt.z.toFixed(4)) : null,
        speed_kmh: pt.speed_kmh != null ? Number(pt.speed_kmh.toFixed(1)) : null,
        phase: pt.phase || (pt.is_predicted ? 'extrapolated' : 'tracked'),
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
      sample_points: (activeTrajectory?.points || []).map(p => ({
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
    lines.push('# Hawk-Eye DRS 3D Trajectory Telemetry Export');
    lines.push(`# Export Timestamp: ${new Date().toISOString()}`);
    lines.push(`# Delivery Preset / Video Source: ${currentDeliveryType}`);
    if (video?.filename) lines.push(`# Source Video Filename: ${video.filename}`);
    lines.push(`# DRS Decision: ${drs?.decision || 'N/A'}`);
    lines.push(`# Pitching: ${drs?.pitching || 'N/A'} | Impact: ${drs?.impact || 'N/A'} | Wickets: ${drs?.wickets || 'N/A'}`);
    lines.push(`# LBW Probability: ${lbwProbability != null ? `${lbwProbability}%` : 'N/A'}`);
    lines.push(`# Release Speed: ${releaseSpeed != null ? `${releaseSpeed} km/h` : 'N/A'} | Bounce Speed: ${bounceSpeed != null ? `${bounceSpeed ?? '—'} km/h` : 'N/A'} | Decay: ${speedLossPct != null ? `${speedLossPct}%` : 'N/A'}`);
    lines.push(`# Seam Deviation: ${deviationAngle}° (${deviationLabel})`);
    lines.push(`# Pitch Length Zone: ${lengthZone}`);
    lines.push('#');
    lines.push('frame_index,timestamp_s,x_meters,y_meters,z_meters,speed_kmh,phase,is_interpolated,confidence,pixel_x,pixel_y');

    const points = activeTrajectory.points || [];
    points.forEach((pt, idx) => {
      const frameIdx = pt.frame_idx ?? idx;
      const t = pt.t != null ? pt.t.toFixed(4) : (activeTrajectory.timestamps?.[idx] ?? '');
      const x = pt.x != null ? pt.x.toFixed(4) : '';
      const y = pt.y != null ? pt.y.toFixed(4) : '';
      const z = pt.z != null ? pt.z.toFixed(4) : '';
      const speed = pt.speed_kmh != null ? pt.speed_kmh.toFixed(1) : '';
      const phase = pt.phase || (pt.is_predicted ? 'extrapolated' : 'tracked');
      const isInterp = (pt.is_predicted || pt.is_interpolated || pt.interpolated) ? '1' : '0';
      const conf = pt.confidence != null ? pt.confidence.toFixed(3) : '';
      const px = pt.pixel_x != null ? pt.pixel_x.toFixed(1) : '';
      const py = pt.pixel_y != null ? pt.pixel_y.toFixed(1) : '';

      lines.push(`${frameIdx},${t},${x},${y},${z},${speed},${phase},${isInterp},${conf},${px},${py}`);
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
      const canvas = document.querySelector('canvas');
      if (!canvas) {
        alert('Could not find 3D graphics canvas to capture.');
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
      alert('Could not capture snapshot: ' + err.message);
    }
  };


  return (
    <Box component="main" id="main-content" tabIndex={-1} className="review-workspace" sx={{ display: 'flex', flexDirection: 'column', bgcolor: '#101318', color: 'white' }}>
      <header className="review-header">
        <div className="review-header-line">
          <div className="review-heading">
            <Tooltip title="Back to workspace"><IconButton onClick={onBack} aria-label="Back to workspace"><ArrowBack fontSize="small" /></IconButton></Tooltip>
            <div><h1>{isVideoMode ? 'Delivery analysis' : 'Simulation lab'}</h1></div>
            <Chip label={isVideoMode ? 'Uploaded footage' : 'Simulated delivery'} variant="outlined" size="small" color="primary" />
          </div>
          <div className="review-controls">
            {!video && <FormControl size="small" sx={{ minWidth: { xs: 170, sm: 265 }, maxWidth: 360 }}>
              <Select value={currentDeliveryType} onChange={e => handleDeliveryChange(e.target.value)} disabled={loadingPreset} inputProps={{ 'aria-label': 'Delivery source' }}>
                {video && <MenuItem value="video">{video.original_filename || video.filename}</MenuItem>}
                {PRESET_DELIVERIES.map(p => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
              </Select>
            </FormControl>}
            {video && <Typography className="review-filename" title={video.original_filename || video.filename} variant="body2">{video.original_filename || video.filename}</Typography>}
            {video && <ToggleButtonGroup size="small" value={viewMode} exclusive onChange={(_, value) => value && setViewMode(value)} aria-label="Review layout">
              <ToggleButton value="video">Video</ToggleButton>{!smallScreen && <ToggleButton value="split">Split</ToggleButton>}<ToggleButton value="3d">3D</ToggleButton>
            </ToggleButtonGroup>}
          </div>
        </div>
        <details className="review-settings">
          <summary>Delivery settings & presentation tools</summary>
          <div className="settings-content">
            {!isVideoMode && <>
              <FormControl size="small" sx={{ minWidth: 180 }}><Select value={pitchType} disabled={loadingPreset} onChange={e => handlePitchTypeChange(e.target.value)} inputProps={{ 'aria-label': 'Pitch surface' }}>
                <MenuItem value="standard_hard">Standard hard pitch</MenuItem><MenuItem value="green_seamer">Green seamer</MenuItem><MenuItem value="dry_dusty">Dry & dusty</MenuItem><MenuItem value="damp_clay">Damp clay</MenuItem>
              </Select></FormControl>
              <FormControl size="small" sx={{ minWidth: 125 }}><Select value={spinRPM} disabled={loadingPreset} onChange={e => handleRPMChange(Number(e.target.value))} inputProps={{ 'aria-label': 'Spin rate' }}>{[1600, 2100, 2400, 2800].map(rpm => <MenuItem key={rpm} value={rpm}>{rpm.toLocaleString()} RPM</MenuItem>)}</Select></FormControl>
            </>}
            <FormControlLabel control={<Switch size="small" checked={showBroadcastHUD} onChange={e => setShowBroadcastHUD(e.target.checked)} />} label="Scene telemetry" />
            <FormControlLabel control={<Switch size="small" checked={showCommentary} onChange={e => setShowCommentary(e.target.checked)} />} label="Commentary" />
          </div>
        </details>
        {loadingPreset && <Box role="status" sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={12} /><Typography variant="caption" color="text.secondary">Preparing the delivery…</Typography></Box>}
        {mediaError && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setMediaError('')}>{mediaError}</Alert>}
        {actionError && <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setActionError('')}>{actionError}</Alert>}
      </header>

      {/* Main Review Area */}
      <Box className="review-stage" sx={{
        flex: 1,
        minHeight: 0,
        display: { xs: 'flex', lg: 'grid' },
        gridTemplateColumns: video && viewMode === 'split'
          ? 'minmax(0, 1fr) minmax(0, 1.3fr) 300px'
          : 'minmax(0, 1fr) 300px',
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
              if (!pickingCorner || !videoRect) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const x = (event.clientX - bounds.left - videoRect.left) / videoRect.width;
              const y = (event.clientY - bounds.top - videoRect.top) / videoRect.height;
              if (x < 0 || x >= 1 || y < 0 || y >= 1) return;
              setPickedPoint({ index: pickingCorner.index, x: Math.round(x * videoRef.current.videoWidth), y: Math.round(y * videoRef.current.videoHeight) });
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
              borderRight: { xs: 'none', md: viewMode === '3d' ? 'none' : '1px solid rgba(255,255,255,0.1)' },
              borderBottom: { xs: viewMode === '3d' ? 'none' : '1px solid rgba(255,255,255,0.1)', md: 'none' }
            }}
          >
            <video
              aria-label="Uploaded delivery video"
              ref={videoRef}
              src={videoUrl}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              playsInline
            />
            {pickingCorner && <Box sx={{ position: 'absolute', top: 50, left: 12, right: 12, bgcolor: 'background.paper', p: 1 }}>
              <Typography role="status">Click the {pickingCorner.label.toLowerCase()} pitch corner. Pixel fields are also available for keyboard entry.</Typography>
              <Button onClick={event => { event.stopPropagation(); setPickingCorner(null); }}>Cancel picking</Button>
            </Box>}

            {videoRect && (showCvOverlay || showCvTrail) && (
              <svg aria-hidden="true" viewBox={`0 0 ${videoInfo?.width || videoRef.current?.videoWidth} ${videoInfo?.height || videoRef.current?.videoHeight}`}
                style={{ position: 'absolute', pointerEvents: 'none', ...videoRect }}>
                {showCvTrail && <polyline points={recentTrail.map(point => `${point.pixel_x},${point.pixel_y}`).join(' ')}
                  fill="none" stroke="#F6D365" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
                {showCvOverlay && currentTrackPoint && Number.isFinite(currentTrackPoint.pixel_x) && Number.isFinite(currentTrackPoint.pixel_y) && (
                  <circle cx={currentTrackPoint.pixel_x} cy={currentTrackPoint.pixel_y} r="12" fill="none"
                    stroke="#F6D365" strokeWidth="2" vectorEffect="non-scaling-stroke"
                    strokeDasharray={currentTrackPoint.is_predicted || currentTrackPoint.is_interpolated ? '4 3' : undefined} />
                )}
              </svg>
            )}

            <Box className="video-status" role="status">
              <Typography variant="caption">Original video</Typography>
              <Typography variant="caption">{currentTrackPoint
                ? (currentTrackPoint.is_predicted || currentTrackPoint.is_interpolated ? 'Estimated position' : 'Detected position')
                : 'No tracking at this time'}</Typography>
            </Box>
          </Box>
        )}

        {/* 3D Hawk-Eye View Panel with Television Broadcast HUD */}
        {(viewMode === '3d' || viewMode === 'split') && (
          <Box className="scene-panel" sx={{
            flex: 1.3,
            height: { xs: 420, lg: 'auto' },
            minHeight: { xs: 280, md: 'auto' },
            position: 'relative',
            bgcolor: '#141920'
          }}>
            <HawkEyeViewer
              trajectoryData={activeTrajectory}
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
                          {lbwProbability}% Hitting
                        </Typography>
                      </Box>
                      <Box sx={{ width: '100%', height: 6, bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${lbwProbability}%`,
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
          width: { xs: '100%', lg: 300 },
          flexShrink: 0,
          bgcolor: '#181d25',
          borderLeft: { xs: 'none', lg: '1px solid rgba(255,255,255,0.1)' },
          borderTop: { xs: '1px solid rgba(255,255,255,0.1)', lg: 'none' },
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflowY: 'auto'
        }}>
          {/* Header Card */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Gavel sx={{ color: '#8ab4ff', fontSize: 24 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Review evidence
            </Typography>
          </Box>

          {/* Loading state for uploaded video trajectory */}
          {isVideoMode && trajectoryLoading && (
            <Paper sx={{ p: 2, bgcolor: '#202733', textAlign: 'center', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
              <CircularProgress size={16} sx={{ color: '#38bdf8' }} />
              <Typography variant="body2" sx={{ color: '#94a3b8' }}>
                Loading trajectory analysis…
              </Typography>
            </Paper>
          )}

          {/* Error state */}
          {isVideoMode && trajectoryError && !trajectoryLoading && (
            <Paper sx={{ p: 2, bgcolor: '#202733', textAlign: 'center', borderRadius: 2 }}>
              <Typography variant="body2" sx={{ color: trajectoryError === 'not_processed' ? '#fbbf24' : '#f87171' }}>
                {trajectoryError === 'not_processed'
                  ? 'Analysis is not ready. Return to your deliveries to check processing or retry.'
                  : 'Analysis could not be loaded. Return to your deliveries and try again.'}
              </Typography>
              <Button onClick={onBack} sx={{ mt: 1 }}>Back to deliveries</Button>
            </Paper>
          )}

          {isVideoMode && activeTrajectory && <Typography variant="body2" color="text.secondary">
            {activeTrajectory.ball_detected ? 'Approximate 3D reconstruction. Review the original footage for evidence.' : 'No ball detected. The original video is still available; try a clearer, fixed-camera clip.'}
          </Typography>}
          {isVideoMode && preparedPoints.length > 0 && <Button variant="outlined" onClick={() => handleSeek(null, preparedPoints[0].t)}>
            Jump to first tracked frame ({preparedPoints[0].t.toFixed(2)}s)
          </Button>}
          {isVideoMode && activeTrajectory && <>
            <Typography variant="caption" color="text.secondary">
              Timing: {activeTrajectory.timing_source === 'decoder_pts' ? 'decoder presentation timestamps' : 'approximate / unverified'}.
              {' '}Calibration: {activeTrajectory.calibration_status === 'manual_pitch_plane' ? 'manual pitch plane; height unverified' : 'unverified'}.
            </Typography>
            <PitchCalibration key={video.id} videoId={video.id} trajectory={activeTrajectory} onApply={setActiveTrajectory} pickedPoint={pickedPoint}
              onPick={(index, label) => { videoRef.current?.pause(); setViewMode('video'); setPickingCorner({ index, label }); videoContainerRef.current?.scrollIntoView?.({ block: 'center' }); }} />
          </>}
          {/* Official DRS Evaluation Card (Only when verified event evidence exists) */}
          {!trajectoryLoading && (
            <>
              {drs ? (
                <Paper sx={{
                  p: 2,
                  bgcolor: '#202733',
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
                      ? '#8ab4ff'
                      : drs.decision.includes('UMPIRE')
                      ? '#f59e0b'
                      : '#2a9d8f'
                  }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: 0, color: '#101318' }}>
                      {drs.decision.split(' ')[0]} {drs.decision.split(' ')[1] || ''}
                    </Typography>
                  </Box>
                </Paper>
              ) : (
                !trajectoryError && (
                  <Paper sx={{ p: 2, bgcolor: '#202733', textAlign: 'center', borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                      {isVideoMode
                        ? 'DRS LBW decision unavailable: uncalibrated single-camera footage with no verified pad impact event.'
                        : 'Pick a delivery preset above to view DRS evaluation.'}
                    </Typography>
                  </Paper>
                )
              )}
            </>
          )}

          <details className="inspector-section"><summary>Measurements</summary>
          {/* Delivery measurements */}
          <Paper sx={{
            p: 2,
            bgcolor: '#202733',
            borderRadius: 2,
            border: '1px solid rgba(56, 189, 248, 0.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.6,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
          }}>
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
            {isVideoMode && activeTrajectory?.release_speed_kmh == null ? (
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
          </Paper>

          </details>
          {/* Save review notes Action */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
              sx={{
                bgcolor: '#8ab4ff',
                color: 'primary.contrastText',
                fontWeight: 700,
                fontSize: '0.85rem',
                py: 1.1,
                borderRadius: 2,
                boxShadow: '0 4px 12px rgba(230,57,70,0.3)',
                '&:hover': { bgcolor: '#a8c7ff' }
              }}
            >
              Save reviewer assessment
            </Button>

            {!video && <Typography variant="caption" color="text.secondary">Upload a delivery after signing in to save reviewer notes.</Typography>}
            {/* Broadcast Flow HUD & Match Certificate Shortcuts */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<AccountTree sx={{ fontSize: 15 }} />}
                onClick={() => setFlowHUDOpen(true)}
                sx={{
                  color: '#38bdf8',
                  borderColor: 'rgba(56, 189, 248, 0.4)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  py: 0.8,
                  borderRadius: 1.5,
                  '&:hover': { borderColor: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' }
                }}
              >
                Decision Flow
              </Button>
              <Button
                variant="outlined"
                fullWidth
                startIcon={<Article sx={{ fontSize: 15 }} />}
                onClick={() => setReportCardOpen(true)}
                sx={{
                  color: '#4ade80',
                  borderColor: 'rgba(74, 222, 128, 0.4)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  py: 0.8,
                  borderRadius: 1.5,
                  '&:hover': { borderColor: '#4ade80', bgcolor: 'rgba(74, 222, 128, 0.1)' }
                }}
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

          <details className="review-export"><summary>Export data & capture view</summary>
          {/* Trajectory Telemetry Export Section (Category E.2) */}
          <Paper sx={{
            p: 1.5,
            bgcolor: '#202733',
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1
          }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Timeline sx={{ fontSize: 16 }} /> Export Telemetry &amp; 3D Data
            </Typography>

            <Box sx={{ display: 'flex', gap: 1 }}>
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
          </Paper>

          </details>
          {/* Observable Computer Vision Diagnostics Panel */}
          <details style={{ marginTop: 0 }}>
            <summary style={{ color: '#adb8c7', fontSize: '12px', cursor: 'pointer', padding: '8px 0' }}>CV diagnostics</summary>
          <Paper sx={{
            p: 2,
            bgcolor: '#202733',
            borderRadius: 2,
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.2
          }}>
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
          </Paper>
          </details>

          {/* Interactive Instructions Card */}
          <details style={{ marginTop: 'auto' }}>
            <summary style={{ color: '#adb8c7', fontSize: '12px', cursor: 'pointer', padding: '8px 0' }}>Controls guide</summary>
          <Box sx={{ p: 1.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 2 }}>
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
      {showCommentary && <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: 0.8, bgcolor: '#141920', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
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
        bgcolor: '#181d25',
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
            aria-label="Delivery timeline"
            getAriaValueText={value => `${formatTime(value)} of ${formatTime(duration)}`}
            value={Math.min(currentTime, duration || 1.5)}
            min={0}
            max={duration || 1.5}
            step={0.01}
            onChange={handleSeek}
            onChangeCommitted={() => setIsSeeking(false)}
            sx={{
              color: '#8ab4ff',
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
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
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
                color: '#172014',
                bgcolor: '#8ab4ff',
                '&:hover': { bgcolor: '#a8c7ff' },
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
                aria-pressed={playbackRate === rate}
                onClick={() => handleRateChange(rate)}
                sx={{
                  minWidth: 42,
                  py: 0.3,
                  fontSize: '0.75rem',
                  color: playbackRate === rate ? 'primary.contrastText' : 'text.primary',
                  borderColor: 'divider',
                  bgcolor: playbackRate === rate ? '#8ab4ff' : 'transparent',
                  '&:hover': {
                    bgcolor: playbackRate === rate ? '#a8c7ff' : 'rgba(255,255,255,0.1)'
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
            bgcolor: '#202733',
            color: 'white',
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.15)',
            minWidth: { xs: 300, sm: 420 },
            p: 1
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: '#8ab4ff', display: 'flex', alignItems: 'center', gap: 1 }}>
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
            sx={{ bgcolor: '#8ab4ff', fontWeight: 700, '&:hover': { bgcolor: '#a8c7ff' } }}
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
        <Alert severity="info" onClose={() => setFeedbackMsg('')} sx={{ width: '100%', fontWeight: 600, bgcolor: '#202733', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
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
