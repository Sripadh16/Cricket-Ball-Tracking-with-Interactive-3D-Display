import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Box, IconButton, Typography, Chip, Slider, ToggleButton, ToggleButtonGroup,
  Paper, Button, Select, MenuItem, FormControl, Divider, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Snackbar, Alert,
  Tooltip
} from '@mui/material';
import {
  ArrowBack, PlayArrow, Pause, Replay, Speed, Gavel, SkipPrevious, SkipNext,
  DataObject, TableChart, CameraAlt, GpsFixed, Visibility, VisibilityOff,
  TrendingUp, Timeline, AccountTree, Article
} from '@mui/icons-material';
import HawkEyeViewer from '../components/HawkEyeViewer';
import DRSCommentary from '../components/DRSCommentary';
import DecisionFlowHUD from '../components/DecisionFlowHUD';
import MatchReportCard from '../components/MatchReportCard';
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
  const videoContainerRef = useRef(null);
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

  // Official DRS Review Session State
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewOutcome, setReviewOutcome] = useState('OUT');
  const [reviewType, setReviewType] = useState('LBW');
  const [reviewNotes, setReviewNotes] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const [savedReviewId, setSavedReviewId] = useState(null);
  const [reviewSuccessMsg, setReviewSuccessMsg] = useState('');

  // 2D Video Tracking Reticle & Broadcast HUD Controls
  const [showReticle, setShowReticle] = useState(true);
  const [showBroadcastHUD] = useState(true);
  const [hudMinimized, setHudMinimized] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // TV Broadcast Decision Flow HUD & Match Report Card states
  const [flowHUDOpen, setFlowHUDOpen] = useState(false);
  const [reportCardOpen, setReportCardOpen] = useState(false);

  const handleSaveReview = async () => {
    setSavingReview(true);
    try {
      const payload = {
        video_id: video?.id || 'demo-preset',
        decisions: [
          {
            type: reviewType,
            outcome: reviewOutcome,
            timestamp: currentTime,
            confidence: activeTrajectory?.confidence_score || 0.95
          }
        ],
        notes: reviewNotes || `Official DRS Review: ${reviewOutcome} (${reviewType})`
      };
      const res = await api.post('/reviews/', payload);
      setSavedReviewId(res.data.id);
      setReviewSuccessMsg(`Review session #${res.data.id.substring(0, 8)} saved successfully!`);
      setReviewDialogOpen(false);
    } catch (err) {
      console.error('Failed to save review session:', err);
      alert('Could not save review: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSavingReview(false);
    }
  };

  // Sync activeTrajectory when parent updates (e.g. user switches clips)
  useEffect(() => {
    if (currentDeliveryType === 'video') {
      setActiveTrajectory(initialTrajectory);
    }
  }, [initialTrajectory, currentDeliveryType]);

  // Pitch surface & spin RPM state for aerodynamic simulation presets
  const [pitchType, setPitchType] = useState('standard_hard');
  const [spinRPM, setSpinRPM] = useState(2100);

  // Load preset delivery data with aerodynamics & pitch restitution parameters
  const loadPresetDelivery = useCallback(async (deliveryType, pType = pitchType, rpm = spinRPM) => {
    setLoadingPreset(true);
    try {
      const response = await api.get(`/videos/presets/${deliveryType}`, {
        params: {
          pitch_type: pType,
          rpm: rpm || undefined
        }
      });
      setActiveTrajectory(response.data);
      setDuration(response.data.video_duration || 1.5);
      setCurrentTime(0);
      setIsPlaying(true);
    } catch (err) {
      console.error('Failed to load preset delivery:', err);
    } finally {
      setLoadingPreset(false);
    }
  }, [pitchType, spinRPM]);

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
      loadPresetDelivery(newType, pitchType, spinRPM);
      setViewMode('3d');
    }
  };

  const handlePitchTypeChange = (newPitch) => {
    setPitchType(newPitch);
    if (currentDeliveryType !== 'video') {
      loadPresetDelivery(currentDeliveryType, newPitch, spinRPM);
    }
  };

  const handleRPMChange = (newRPM) => {
    setSpinRPM(newRPM);
    if (currentDeliveryType !== 'video') {
      loadPresetDelivery(currentDeliveryType, pitchType, newRPM);
    }
  };

  // Load default preset if there's no video and no trajectory loading in flight
  useEffect(() => {
    if (!video && !initialTrajectory && !trajectoryLoading) {
      loadPresetDelivery('inswinger_lbw');
    }
  }, [video, initialTrajectory, trajectoryLoading, loadPresetDelivery]);

  // Video event listeners
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
  }, [currentDeliveryType, viewMode]);

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

  // Handle play/pause
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

  const stepFrame = (direction) => {
    if (currentDeliveryType === 'video' && videoRef.current) {
      const fps = 30;
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

  const videoUrl = video?.filename
    ? `${API_BASE_URL}/uploads/${encodeURIComponent(video.filename)}`
    : '';

  const drs = activeTrajectory?.drs_evaluation;
  const isVideoMode = currentDeliveryType === 'video';
  const isSimulation = !isVideoMode;

  // ---------------------------------------------------------------------------
  // TELEMETRY COMPUTATIONS (Speed, Seam Deviation, Length Zone, LBW Impact)
  // ---------------------------------------------------------------------------
  const releaseSpeed = useMemo(() => {
    if (activeTrajectory?.release_speed_kmh != null) {
      return Number(activeTrajectory.release_speed_kmh.toFixed(1));
    }
    const pts = activeTrajectory?.points;
    if (pts && pts.length > 0 && pts[0].speed_kmh != null) {
      return Number(pts[0].speed_kmh.toFixed(1));
    }
    return 142.4;
  }, [activeTrajectory]);

  const bounceSpeed = useMemo(() => {
    if (activeTrajectory?.bounce_speed_kmh != null) {
      return Number(activeTrajectory.bounce_speed_kmh.toFixed(1));
    }
    const bp = activeTrajectory?.bounce_point;
    if (bp && bp.speed_kmh != null) {
      return Number(bp.speed_kmh.toFixed(1));
    }
    return Number((releaseSpeed * 0.83).toFixed(1));
  }, [activeTrajectory, releaseSpeed]);

  const speedLossPct = useMemo(() => {
    if (!releaseSpeed || !bounceSpeed) return 17.0;
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

    const id = activeTrajectory?.id || currentDeliveryType || '';
    if (id.includes('inswinger')) return 3.2;
    if (id.includes('offcutter')) return -3.4;
    if (id.includes('legspin')) return 4.6;
    if (id.includes('bouncer')) return 0.5;
    return 2.4;
  }, [activeTrajectory, currentDeliveryType]);

  const deviationLabel = useMemo(() => {
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
    const id = activeTrajectory?.id || currentDeliveryType || '';
    if (id.includes('bouncer')) return 'Bouncer';
    if (id.includes('offcutter')) return 'Good Length';
    if (id.includes('inswinger')) return 'Full Pitch';
    return 'Good Length';
  }, [activeTrajectory, currentDeliveryType]);

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

  const lbwProbability = useMemo(() => {
    if (activeTrajectory?.lbw_probability != null) {
      return Math.round(activeTrajectory.lbw_probability);
    }
    if (!drs) return 86;
    const dec = (drs.decision || '').toUpperCase();
    const w = (drs.wickets || '').toUpperCase();
    const p = (drs.pitching || '').toUpperCase();
    const imp = (drs.impact || '').toUpperCase();

    if (p.includes('OUTSIDE') || imp.includes('OUTSIDE') || w.includes('MISSING') || dec.includes('NOT OUT')) {
      return 8;
    }
    if (w.includes('UMPIRE') || dec.includes('UMPIRE')) {
      return 51;
    }
    if (w.includes('HITTING') || dec.includes('OUT')) {
      return 96;
    }
    return 74;
  }, [activeTrajectory, drs]);

  const lbwColor = useMemo(() => {
    if (lbwProbability >= 70) return '#ef4444';
    if (lbwProbability >= 35) return '#f59e0b';
    return '#10b981';
  }, [lbwProbability]);

  // ---------------------------------------------------------------------------
  // SYNCHRONOUS 2D BOUNDING BOX / RETICLE OVERLAY CALCULATION
  // ---------------------------------------------------------------------------
  const getRenderedVideoRect = useCallback(() => {
    const vid = videoRef.current;
    if (!vid) return null;
    const cw = vid.clientWidth;
    const ch = vid.clientHeight;
    const vw = vid.videoWidth || 1920;
    const vh = vid.videoHeight || 1080;
    if (!cw || !ch) return null;

    const videoAspect = vw / vh;
    const elemAspect = cw / ch;

    let drawW = cw;
    let drawH = ch;
    let drawX = vid.offsetLeft;
    let drawY = vid.offsetTop;

    if (Math.abs(elemAspect - videoAspect) > 0.01) {
      if (elemAspect > videoAspect) {
        drawW = ch * videoAspect;
        drawX = vid.offsetLeft + (cw - drawW) / 2;
      } else {
        drawH = cw / videoAspect;
        drawY = vid.offsetTop + (ch - drawH) / 2;
      }
    }
    return { drawX, drawY, drawW, drawH, vw, vh };
  }, []);

  const activeBallData = useMemo(() => {
    const points = activeTrajectory?.points;
    if (!points || points.length === 0) return null;

    // Search for segment [p0, p1] enclosing currentTime
    let p0 = null;
    let p1 = null;

    for (let i = 0; i < points.length; i++) {
      if (points[i].t <= currentTime) {
        p0 = points[i];
      }
      if (points[i].t >= currentTime && !p1) {
        p1 = points[i];
        break;
      }
    }

    if (!p0 && !p1) return null;
    if (!p0) p0 = p1;
    if (!p1) p1 = p0;

    // Check if within tracking temporal window
    const distToRange = currentTime < points[0].t
      ? (points[0].t - currentTime)
      : currentTime > points[points.length - 1].t
      ? (currentTime - points[points.length - 1].t)
      : 0;

    if (distToRange > 0.35) return null;

    let alpha = 0;
    if (p1.t !== p0.t && p1.t > p0.t) {
      alpha = Math.max(0, Math.min(1, (currentTime - p0.t) / (p1.t - p0.t)));
    }

    const isInterpolated = Boolean(
      p0.is_predicted || p1.is_predicted ||
      p0.is_interpolated || p1.is_interpolated ||
      p0.interpolated || p1.interpolated ||
      p0.phase === 'extrapolated' || p1.phase === 'extrapolated'
    );

    const confidence = (p0.confidence ?? 0.94) * (1 - alpha) + (p1.confidence ?? 0.94) * alpha;
    const speedKmh = p1.speed_kmh ?? p0.speed_kmh ?? releaseSpeed;

    // Coordinate resolution
    let px = null;
    let py = null;

    if (p0.pixel_x != null && p1.pixel_x != null) {
      let p0x = p0.pixel_x;
      let p0y = p0.pixel_y;
      let p1x = p1.pixel_x;
      let p1y = p1.pixel_y;

      const rect = getRenderedVideoRect();
      const vw = rect?.vw || 1920;
      const vh = rect?.vh || 1080;
      if (p0x <= 1.0 && p0y <= 1.0 && p0x > 0 && p0y > 0) {
        p0x *= vw;
        p0y *= vh;
      }
      if (p1x <= 1.0 && p1y <= 1.0 && p1x > 0 && p1y > 0) {
        p1x *= vw;
        p1y *= vh;
      }

      px = p0x + (p1x - p0x) * alpha;
      py = p0y + (p1y - p0y) * alpha;
    } else if (p0.x != null && p1.x != null) {
      // 3D perspective projection into broadcast camera frame
      const x = p0.x + (p1.x - p0.x) * alpha;
      const y = p0.y + (p1.y - p0.y) * alpha;
      const z = p0.z + (p1.z - p0.z) * alpha;

      const rect = getRenderedVideoRect();
      const vw = rect?.vw || 1920;
      const vh = rect?.vh || 1080;

      // Broadcast camera position behind bowler stumps
      const dY = Math.max(0.6, y - (-15.5));
      const normU = 0.5 + ((x - 0.0) / dY) * 1.85;
      const normV = 0.70 - ((z - 0.25) / dY) * 2.35;

      px = Math.max(0, Math.min(vw, normU * vw));
      py = Math.max(0, Math.min(vh, normV * vh));
    }

    return {
      px,
      py,
      isInterpolated,
      confidence,
      speedKmh,
      point: p0
    };
  }, [activeTrajectory, currentTime, getRenderedVideoRect, releaseSpeed]);

  const reticleStyle = useMemo(() => {
    if (!activeBallData || activeBallData.px == null || activeBallData.py == null) {
      return null;
    }

    const rect = getRenderedVideoRect();
    if (!rect) return null;

    const screenX = rect.drawX + (activeBallData.px / rect.vw) * rect.drawW;
    const screenY = rect.drawY + (activeBallData.py / rect.vh) * rect.drawH;

    const scale = rect.drawW / rect.vw;
    const boxSize = Math.max(34, Math.min(62, Math.round(44 * Math.max(0.8, scale * 1.4))));

    return {
      left: screenX,
      top: screenY,
      size: boxSize,
      isInterpolated: activeBallData.isInterpolated,
      confidence: activeBallData.confidence,
      speedKmh: activeBallData.speedKmh,
      pixelX: Math.round(activeBallData.px),
      pixelY: Math.round(activeBallData.py)
    };
  }, [activeBallData, getRenderedVideoRect]);

  // ---------------------------------------------------------------------------
  // TRAJECTORY EXPORT (JSON & CSV & 3D Screenshot)
  // ---------------------------------------------------------------------------
  const handleExportJSON = () => {
    if (!activeTrajectory) {
      alert('No trajectory data available to export.');
      return;
    }

    const exportPayload = {
      metadata: {
        application: 'Cricket Ball Tracking & Interactive 3D Display',
        module: 'Hawk-Eye DRS Review Console',
        export_timestamp: new Date().toISOString(),
        delivery_type: currentDeliveryType,
        source_video: video?.filename || null,
        video_duration_seconds: duration,
        confidence_score: activeTrajectory.confidence_score || 0.95
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

  const handleExportCSV = () => {
    if (!activeTrajectory) {
      alert('No trajectory data available to export.');
      return;
    }

    const lines = [];
    lines.push('# Hawk-Eye DRS 3D Trajectory Telemetry Export');
    lines.push(`# Export Timestamp: ${new Date().toISOString()}`);
    lines.push(`# Delivery Preset / Video Source: ${currentDeliveryType}`);
    if (video?.filename) lines.push(`# Source Video Filename: ${video.filename}`);
    lines.push(`# DRS Decision: ${drs?.decision || 'N/A'}`);
    lines.push(`# Pitching: ${drs?.pitching || 'N/A'} | Impact: ${drs?.impact || 'N/A'} | Wickets: ${drs?.wickets || 'N/A'}`);
    lines.push(`# LBW Probability: ${lbwProbability}%`);
    lines.push(`# Release Speed: ${releaseSpeed} km/h | Bounce Speed: ${bounceSpeed} km/h | Decay: ${speedLossPct}%`);
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

          {/* Aerodynamics & Pitch Restitution Surface Controls (Active for 3D Presets) */}
          {currentDeliveryType !== 'video' && (
            <>
              <FormControl size="small" sx={{ minWidth: 165 }}>
                <Select
                  disabled={loadingPreset}
                  value={pitchType}
                  onChange={(e) => handlePitchTypeChange(e.target.value)}
                  sx={{
                    color: '#38bdf8',
                    bgcolor: 'rgba(56, 189, 248, 0.08)',
                    borderRadius: 2,
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(56, 189, 248, 0.3)' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#38bdf8' },
                    '& .MuiSvgIcon-root': { color: '#38bdf8' }
                  }}
                >
                  <MenuItem value="standard_hard">Turf: Standard Hard</MenuItem>
                  <MenuItem value="green_seamer">Turf: Green Seamer</MenuItem>
                  <MenuItem value="dry_dusty">Turf: Dry & Dusty</MenuItem>
                  <MenuItem value="damp_clay">Turf: Damp Clay</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 125 }}>
                <Select
                  disabled={loadingPreset}
                  value={spinRPM}
                  onChange={(e) => handleRPMChange(Number(e.target.value))}
                  sx={{
                    color: '#f472b6',
                    bgcolor: 'rgba(244, 114, 182, 0.08)',
                    borderRadius: 2,
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(244, 114, 182, 0.3)' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#f472b6' },
                    '& .MuiSvgIcon-root': { color: '#f472b6' }
                  }}
                >
                  <MenuItem value={1600}>1,600 RPM</MenuItem>
                  <MenuItem value={2100}>2,100 RPM</MenuItem>
                  <MenuItem value={2400}>2,400 RPM</MenuItem>
                  <MenuItem value={2800}>2,800 RPM</MenuItem>
                </Select>
              </FormControl>
            </>
          )}

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

          {/* TV Broadcast Decision Flow HUD Button */}
          <Tooltip title="View TV Broadcast 3-Stage Decision Flowchart (Pitching → Impact → Wickets)">
            <Button
              size="small"
              variant="outlined"
              startIcon={<AccountTree sx={{ fontSize: '15px !important', color: '#38bdf8' }} />}
              onClick={() => setFlowHUDOpen(true)}
              sx={{
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                bgcolor: 'rgba(56, 189, 248, 0.08)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'none',
                px: 1.2,
                py: 0.5,
                borderRadius: 2,
                '&:hover': {
                  borderColor: '#38bdf8',
                  bgcolor: 'rgba(56, 189, 248, 0.18)'
                }
              }}
            >
              TV Flow HUD
            </Button>
          </Tooltip>

          {/* Official Match Report Card Button */}
          <Tooltip title="Generate Official Hawk-Eye DRS Match Certificate & Report Card">
            <Button
              size="small"
              variant="outlined"
              startIcon={<Article sx={{ fontSize: '15px !important', color: '#4ade80' }} />}
              onClick={() => setReportCardOpen(true)}
              sx={{
                color: '#4ade80',
                borderColor: 'rgba(74, 222, 128, 0.4)',
                bgcolor: 'rgba(74, 222, 128, 0.08)',
                fontSize: '0.75rem',
                fontWeight: 700,
                textTransform: 'none',
                px: 1.2,
                py: 0.5,
                borderRadius: 2,
                '&:hover': {
                  borderColor: '#4ade80',
                  bgcolor: 'rgba(74, 222, 128, 0.18)'
                }
              }}
            >
              Match Report
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Main Review Area */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        overflow: { xs: 'auto', md: 'hidden' }
      }}>
        {/* Video Panel with Synchronous 2D Tracking Reticle Overlay */}
        {video && (viewMode === 'video' || viewMode === 'split') && (
          <Box
            ref={videoContainerRef}
            sx={{
              flex: viewMode === 'split' ? 1 : 'auto',
              height: { xs: 260, md: 'auto' },
              minHeight: { xs: 220, md: 'auto' },
              position: 'relative',
              bgcolor: 'black',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRight: { xs: 'none', md: '1px solid rgba(255,255,255,0.1)' },
              borderBottom: { xs: '1px solid rgba(255,255,255,0.1)', md: 'none' },
              overflow: 'hidden'
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              playsInline
            />

            {/* Top-Left Video Badges: Playback Rate & 2D Tracking Reticle Toggle */}
            <Box sx={{ position: 'absolute', top: 12, left: 12, display: 'flex', gap: 1, zIndex: 12 }}>
              {playbackRate !== 1 && (
                <Chip
                  label={`${playbackRate}x`}
                  size="small"
                  sx={{
                    bgcolor: '#e63946',
                    color: 'white',
                    fontWeight: 800,
                    fontSize: '0.7rem'
                  }}
                />
              )}
              <Chip
                icon={<GpsFixed sx={{ fontSize: '14px !important', color: showReticle ? '#39ff14' : '#94a3b8' }} />}
                label={showReticle ? '2D Reticle: ON' : '2D Reticle: OFF'}
                size="small"
                onClick={() => setShowReticle(!showReticle)}
                sx={{
                  bgcolor: showReticle ? 'rgba(57, 255, 20, 0.15)' : 'rgba(255,255,255,0.1)',
                  color: showReticle ? '#39ff14' : '#94a3b8',
                  border: `1px solid ${showReticle ? 'rgba(57, 255, 20, 0.5)' : 'rgba(255,255,255,0.2)'}`,
                  fontWeight: 700,
                  fontSize: '0.68rem',
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: showReticle ? 'rgba(57, 255, 20, 0.25)' : 'rgba(255,255,255,0.2)'
                  }
                }}
              />
            </Box>

            {/* Top-Right Tracking Lock Status Badge */}
            <Box sx={{ position: 'absolute', top: 12, right: 12, zIndex: 12 }}>
              <Chip
                label={reticleStyle ? (reticleStyle.isInterpolated ? '● KALMAN SYNC' : '● CV LOCK [30 FPS]') : '◌ BALL SEARCH'}
                size="small"
                sx={{
                  bgcolor: reticleStyle
                    ? (reticleStyle.isInterpolated ? 'rgba(0, 240, 255, 0.2)' : 'rgba(57, 255, 20, 0.2)')
                    : 'rgba(255,255,255,0.08)',
                  color: reticleStyle
                    ? (reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14')
                    : '#94a3b8',
                  border: `1px solid ${
                    reticleStyle
                      ? (reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14')
                      : 'rgba(255,255,255,0.15)'
                  }`,
                  fontWeight: 800,
                  fontSize: '0.65rem'
                }}
              />
            </Box>

            {/* 2D Synchronous Tracking Bounding Box / Reticle Overlay */}
            {showReticle && reticleStyle && (
              <Box
                sx={{
                  position: 'absolute',
                  left: reticleStyle.left,
                  top: reticleStyle.top,
                  transform: 'translate(-50%, -50%)',
                  pointerEvents: 'none',
                  zIndex: 10,
                  transition: isPlaying ? 'none' : 'all 0.08s ease-out'
                }}
              >
                {/* Target Reticle Box */}
                <Box
                  sx={{
                    width: reticleStyle.size,
                    height: reticleStyle.size,
                    border: reticleStyle.isInterpolated
                      ? '2px dashed #00f0ff'
                      : '2px solid #39ff14',
                    borderRadius: '6px',
                    boxShadow: reticleStyle.isInterpolated
                      ? '0 0 16px rgba(0, 240, 255, 0.9), inset 0 0 8px rgba(0, 240, 255, 0.35)'
                      : '0 0 16px rgba(57, 255, 20, 0.9), inset 0 0 8px rgba(57, 255, 20, 0.35)',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {/* Corner Reticle Brackets */}
                  <Box sx={{
                    position: 'absolute', top: -4, left: -4, width: 8, height: 8,
                    borderTop: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`,
                    borderLeft: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`
                  }} />
                  <Box sx={{
                    position: 'absolute', top: -4, right: -4, width: 8, height: 8,
                    borderTop: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`,
                    borderRight: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`
                  }} />
                  <Box sx={{
                    position: 'absolute', bottom: -4, left: -4, width: 8, height: 8,
                    borderBottom: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`,
                    borderLeft: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`
                  }} />
                  <Box sx={{
                    position: 'absolute', bottom: -4, right: -4, width: 8, height: 8,
                    borderBottom: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`,
                    borderRight: `2px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`
                  }} />

                  {/* Center Target Dot */}
                  <Box
                    sx={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      bgcolor: reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14',
                      boxShadow: `0 0 8px ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`
                    }}
                  />
                </Box>

                {/* Reticle Classification Badge Tag (Above) */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: -24,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    bgcolor: reticleStyle.isInterpolated ? 'rgba(0, 25, 35, 0.94)' : 'rgba(10, 30, 15, 0.94)',
                    border: `1px solid ${reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14'}`,
                    color: reticleStyle.isInterpolated ? '#00f0ff' : '#39ff14',
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    px: 0.8,
                    py: 0.2,
                    borderRadius: 1,
                    letterSpacing: 0.5,
                    boxShadow: '0 2px 10px rgba(0,0,0,0.7)'
                  }}
                >
                  <span>{reticleStyle.isInterpolated ? '● KALMAN PRED' : '● BALL DETECTED'}</span>
                  {reticleStyle.confidence && (
                    <span style={{ opacity: 0.85 }}>({Math.round(reticleStyle.confidence * 100)}%)</span>
                  )}
                </Box>

                {/* Reticle Speed & Coordinate Chip (Below) */}
                <Box
                  sx={{
                    position: 'absolute',
                    bottom: -22,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                    bgcolor: 'rgba(6, 13, 23, 0.92)',
                    color: '#e2e8f0',
                    fontSize: '0.6rem',
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    px: 0.8,
                    py: 0.15,
                    borderRadius: 0.8,
                    border: '1px solid rgba(255,255,255,0.18)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.6)'
                  }}
                >
                  {reticleStyle.speedKmh ? `${reticleStyle.speedKmh} km/h` : `x:${reticleStyle.pixelX} y:${reticleStyle.pixelY}`}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* 3D Hawk-Eye View Panel with Television Broadcast HUD */}
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
              onSeek={(t) => handleSeek(null, t)}
              onOpenFlowHUD={() => setFlowHUDOpen(true)}
              onOpenReportCard={() => setReportCardOpen(true)}
            />

            {/* In-Viewer Television Broadcast Telemetry HUD Overlay */}
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
                        <span style={{ color: '#38bdf8' }}>{releaseSpeed}</span> km/h <span style={{ color: '#64748b' }}>|</span> {bounceSpeed} km/h
                      </Typography>
                    </Box>

                    {/* Deviation Angle */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem' }}>Deviation Angle</Typography>
                      <Chip
                        label={`${deviationAngle >= 0 ? '+' : ''}${deviationAngle}°`}
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
                        label={lengthZone}
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
        <Box sx={{
          width: { xs: '100%', md: 330 },
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

          {/* DRS BROADCAST TELEMETRY HUD CONSOLE (Category C.5) */}
          <Paper sx={{
            p: 2,
            bgcolor: '#0f2137',
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
                Broadcast Telemetry HUD
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
                  <span style={{ color: '#64748b', fontSize: '0.72rem' }}>
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
                  {bounceSpeed} km/h{' '}
                  <span style={{ color: '#f87171', fontSize: '0.65rem' }}>(-{speedLossPct}% decay)</span>
                </Typography>
              </Box>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            {/* 2. Deviation Angle in Degrees After Pitch Contact */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 600 }}>
                  Pitch Deviation
                </Typography>
                <Chip
                  icon={<TrendingUp sx={{ fontSize: '13px !important', color: '#38bdf8 !important' }} />}
                  label={`${deviationAngle >= 0 ? '+' : ''}${deviationAngle}°`}
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
                  label={lengthZone}
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
                  const isActive = lengthZone.includes(z.name) || z.name.includes(lengthZone);
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
                <Typography variant="caption" sx={{ fontWeight: 900, color: lbwColor, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {lbwProbability}% Hitting
                </Typography>
              </Box>

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
                <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.68rem' }}>Target Plane</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#f72585', fontSize: '0.72rem' }}>
                  {activeTrajectory?.stump_plane_target?.hit_stump || 'Middle Stump Hit'}
                </Typography>
              </Box>
            </Box>
          </Paper>

          {/* Record Official DRS Review Action */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button
              variant="contained"
              startIcon={<Gavel />}
              onClick={() => {
                const dec = drs?.decision || '';
                if (dec.includes('OUT') && !dec.includes('NOT OUT')) setReviewOutcome('OUT');
                else if (dec.includes("UMPIRE'S CALL")) setReviewOutcome("UMPIRE'S CALL");
                else setReviewOutcome('NOT OUT');
                setReviewDialogOpen(true);
              }}
              sx={{
                bgcolor: '#e63946',
                color: 'white',
                fontWeight: 700,
                fontSize: '0.85rem',
                py: 1.1,
                borderRadius: 2,
                boxShadow: '0 4px 12px rgba(230,57,70,0.3)',
                '&:hover': { bgcolor: '#c1121f' }
              }}
            >
              Record Official DRS Review
            </Button>

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
                Report Card
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

          {/* Trajectory Telemetry Export Section (Category E.2) */}
          <Paper sx={{
            p: 1.5,
            bgcolor: '#0f2137',
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

          {/* Interactive Instructions Card */}
          <Box sx={{ mt: 'auto', p: 1.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 2 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', display: 'block', mb: 0.5, fontWeight: 600 }}>
              💡 Interactive Graphics Controls
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b', display: 'block', fontSize: '0.7rem' }}>
              • Drag left mouse to orbit 360°
              <br />• Scroll wheel to zoom in/out
              <br />• Switch cameras (Chase Cam, Batsman POV, Umpire)
              <br />• Toggle 2D tracking reticle over video
              <br />• Click trajectory markers for telemetry
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Spoken AI Voice Commentary & Visual Closed-Captions Subtitle Strip */}
      <Box sx={{ px: { xs: 1.5, sm: 2.5 }, py: 0.8, bgcolor: '#08121e', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <DRSCommentary
          trajectoryData={activeTrajectory}
          currentTime={currentTime}
          isPlaying={isPlaying}
          showControls={true}
          showTicker={true}
        />
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

      {/* Official DRS Review Verdict Dialog */}
      <Dialog
        open={reviewDialogOpen}
        onClose={() => setReviewDialogOpen(false)}
        PaperProps={{
          sx: {
            bgcolor: '#0f2137',
            color: 'white',
            borderRadius: 3,
            border: '1px solid rgba(255,255,255,0.15)',
            minWidth: { xs: 300, sm: 420 },
            p: 1
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: '#e63946', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Gavel /> Record Official DRS Verdict
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" sx={{ color: '#94a3b8', mb: 0.5, fontWeight: 600 }}>Decision Outcome</Typography>
            <Select
              value={reviewOutcome}
              onChange={(e) => setReviewOutcome(e.target.value)}
              sx={{ color: 'white', bgcolor: 'rgba(255,255,255,0.06)', borderRadius: 1.5 }}
            >
              <MenuItem value="OUT">OUT</MenuItem>
              <MenuItem value="NOT OUT">NOT OUT</MenuItem>
              <MenuItem value="UMPIRE'S CALL">{"UMPIRE'S CALL"}</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <Typography variant="caption" sx={{ color: '#94a3b8', mb: 0.5, fontWeight: 600 }}>Review Category</Typography>
            <Select
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
            label="Umpire Review Notes"
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
            disabled={savingReview}
            sx={{ bgcolor: '#e63946', fontWeight: 700, '&:hover': { bgcolor: '#c1121f' } }}
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
        <Alert severity="info" onClose={() => setFeedbackMsg('')} sx={{ width: '100%', fontWeight: 600, bgcolor: '#0f2137', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.4)' }}>
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

      {/* Official Hawk-Eye DRS Match Certificate & Report Card Modal */}
      <MatchReportCard
        open={reportCardOpen}
        onClose={() => setReportCardOpen(false)}
        trajectoryData={activeTrajectory}
        videoSource={video?.original_filename || video?.filename || currentDeliveryType}
      />
    </Box>
  );
}
