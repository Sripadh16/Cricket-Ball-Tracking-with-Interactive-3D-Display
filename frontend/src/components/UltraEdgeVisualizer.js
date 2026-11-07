import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, ToggleButton, ToggleButtonGroup, Slider,
  Paper, Chip, IconButton, Tooltip
} from '@mui/material';
import {
  GraphicEq, VolumeUp, VolumeOff
} from '@mui/icons-material';

/**
 * UltraEdgeVisualizer - Real-time Snickometer / Ultra-Edge Soundwave Visualizer
 *
 * Simulates high-precision acoustic synchronisation used in television cricket DRS:
 * - Real-time scrolling waveform synced to video / 3D ball trajectory playback timeline
 * - Acoustic transient spikes at ball-bat / ball-pad contact moments
 * - Dual frequency modes: UltraEdge (high-frequency digital bandpass) vs Snickometer (analog CRT oscilloscope)
 * - Edge sensitivity, noise floor calibration, and contact type emulation
 * - Interactive timeline scrubber & optional Web Audio API click synthesis
 */
export default function UltraEdgeVisualizer({
  currentTime = 0,
  duration = 1.5,
  trajectoryData = null,
  onSeek = null,
  compact = false
}) {
  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const lastAudioTriggerRef = useRef(-1);

  // Visualizer Settings & Modes
  const [mode, setMode] = useState('ultraedge'); // 'ultraedge' | 'snicko'
  const [sensitivity, setSensitivity] = useState(1.2); // 0.5 - 2.5
  const [noiseFloor, setNoiseFloor] = useState(0.12); // 0.02 - 0.40
  const [contactScenario, setContactScenario] = useState('auto'); // 'auto' | 'bat' | 'pad' | 'clean'
  const [enableAudioCue, setEnableAudioCue] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(2); // 1x, 2x, 4x

  // Compute or detect impact / edge timestamp
  const { impactTimestamp, effectiveScenario } = useMemo(() => {
    // 1. Try to find from trajectoryData
    let tImp = null;
    let autoType = 'bat';

    if (trajectoryData?.impact_point?.t) {
      tImp = trajectoryData.impact_point.t;
    } else if (trajectoryData?.points?.length) {
      // Find point closest to batsman stance Z ≈ 8.84m or closest to crease
      let closestPt = trajectoryData.points[0];
      let minDiff = Infinity;
      for (const p of trajectoryData.points) {
        const diff = Math.abs((p.y || 0) - 8.84);
        if (diff < minDiff) {
          minDiff = diff;
          closestPt = p;
        }
      }
      tImp = closestPt.t || (duration * 0.68);
    } else {
      tImp = duration * 0.68;
    }

    // Determine default scenario if set to auto
    if (trajectoryData?.drs_evaluation?.edge_detected !== undefined) {
      autoType = trajectoryData.drs_evaluation.edge_detected ? 'bat' : 'clean';
    } else if (trajectoryData?.title?.toLowerCase().includes('clean') ||
               trajectoryData?.title?.toLowerCase().includes('missing')) {
      autoType = 'clean';
    } else if (trajectoryData?.title?.toLowerCase().includes('lbw')) {
      autoType = 'pad';
    } else {
      autoType = 'bat';
    }

    const finalScenario = contactScenario === 'auto' ? autoType : contactScenario;

    return {
      impactTimestamp: tImp,
      effectiveScenario: finalScenario
    };
  }, [trajectoryData, duration, contactScenario]);

  // Play realistic synthesized acoustic edge click via Web Audio API
  const playAudioCue = useCallback((type) => {
    if (!enableAudioCue) return;
    try {
      if (!audioCtxRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          audioCtxRef.current = new AudioContext();
        }
      }
      const ctx = audioCtxRef.current;
      if (!ctx || ctx.state === 'suspended') {
        if (ctx) ctx.resume();
      }
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      const now = ctx.currentTime;

      if (type === 'bat') {
        // High-pitch sharp woody resonance ~2400Hz
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(2600, now);
        osc.frequency.exponentialRampToValueAtTime(700, now + 0.08);

        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(2400, now);
        filter.Q.setValueAtTime(8, now);

        gain.gain.setValueAtTime(0.35 * sensitivity, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === 'pad') {
        // Dull lower frequency thud ~350Hz
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, now);

        gain.gain.setValueAtTime(0.3 * sensitivity, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.15);
      }
    } catch (e) {
      // Audio autoplay policy catch
    }
  }, [enableAudioCue, sensitivity]);

  // Audio trigger on crossing impact point
  useEffect(() => {
    if (effectiveScenario === 'clean') return;
    const diff = Math.abs(currentTime - impactTimestamp);
    if (diff < 0.025 && Math.abs(lastAudioTriggerRef.current - impactTimestamp) > 0.1) {
      lastAudioTriggerRef.current = impactTimestamp;
      playAudioCue(effectiveScenario);
    }
    if (diff > 0.15) {
      lastAudioTriggerRef.current = -1;
    }
  }, [currentTime, impactTimestamp, effectiveScenario, playAudioCue]);

  // Synthetic waveform sample generator at normalized time t in [0, duration]
  const sampleWaveform = useCallback((t) => {
    // 1. Ambient noise baseline
    const noise = (
      Math.sin(t * 1400.0) * 0.25 +
      Math.sin(t * 3100.0) * 0.15 +
      Math.sin(t * 790.0) * 0.3 +
      (Math.sin((t * 9871.23) % 6.28) * 0.3)
    ) * noiseFloor;

    if (effectiveScenario === 'clean') {
      return noise;
    }

    // 2. Contact spike envelope around impactTimestamp
    const dt = t - impactTimestamp;
    const absDt = Math.abs(dt);

    if (effectiveScenario === 'bat') {
      // Sharp high-frequency bat snick
      const windowWidth = 0.045; // 45ms contact window
      if (absDt < windowWidth) {
        const decay = Math.exp(-absDt * 75);
        // Resonant high frequencies: 2.2kHz + 3.8kHz harmonics
        const carrier = Math.sin(dt * 16500) * 0.65 + Math.sin(dt * 24200) * 0.35;
        const spike = carrier * decay * sensitivity * 0.92;
        return spike + noise * (1 - decay * 0.5);
      }
    } else if (effectiveScenario === 'pad') {
      // Dull muffled low-frequency pad thump
      const windowWidth = 0.075;
      if (absDt < windowWidth) {
        const decay = Math.exp(-absDt * 45);
        const carrier = Math.sin(dt * 4200) * 0.75 + Math.sin(dt * 8500) * 0.25;
        const spike = carrier * decay * sensitivity * 0.55;
        return spike + noise * (1 - decay * 0.4);
      }
    }

    return noise;
  }, [effectiveScenario, impactTimestamp, noiseFloor, sensitivity]);

  // Main Canvas Real-Time Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina display scaling
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Background Fill
    if (mode === 'ultraedge') {
      // Modern High-Tech DRS Dark Navy
      const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
      bgGrad.addColorStop(0, '#060d17');
      bgGrad.addColorStop(1, '#02060b');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);

      // Digital Grid lines
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      const numGridY = 6;
      for (let i = 1; i < numGridY; i++) {
        const y = (height / numGridY) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      const numGridX = 12;
      for (let i = 1; i < numGridX; i++) {
        const x = (width / numGridX) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    } else {
      // Snickometer Vintage CRT Oscilloscope Green
      ctx.fillStyle = '#011409';
      ctx.fillRect(0, 0, width, height);

      // CRT Phosphor Reticle Grid
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.12)';
      ctx.lineWidth = 1;
      const step = 24;
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // 2. Center Zero-Crossing Reference Line
    const midY = height / 2;
    ctx.strokeStyle = mode === 'ultraedge' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(34, 197, 94, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3. Time Window mapping (Center playhead in middle or scroll)
    // Visible time span depending on zoomLevel
    const timeSpan = (duration / zoomLevel);
    const startT = Math.max(0, Math.min(duration - timeSpan, currentTime - timeSpan * 0.5));
    const endT = startT + timeSpan;

    // Contact line position in current view
    if (impactTimestamp >= startT && impactTimestamp <= endT) {
      const impactScreenX = ((impactTimestamp - startT) / timeSpan) * width;

      // Contact moment vertical marker
      ctx.strokeStyle = effectiveScenario === 'bat'
        ? 'rgba(247, 37, 133, 0.85)'
        : effectiveScenario === 'pad'
        ? 'rgba(251, 191, 36, 0.85)'
        : 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(impactScreenX, 0);
      ctx.lineTo(impactScreenX, height);
      ctx.stroke();

      // Pill label at top of contact line
      ctx.fillStyle = effectiveScenario === 'bat'
        ? '#f72585'
        : effectiveScenario === 'pad'
        ? '#fbbf24'
        : '#64748b';
      ctx.fillRect(impactScreenX - 32, 4, 64, 16);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        effectiveScenario === 'bat' ? 'EDGE POINT' : effectiveScenario === 'pad' ? 'PAD IMPACT' : 'BALL PASS',
        impactScreenX,
        15
      );
    }

    // 4. Sample and draw soundwave
    const samplesCount = Math.min(600, width * 1.5);
    const wavePoints = [];
    let peakAmp = 0;

    for (let i = 0; i < samplesCount; i++) {
      const frac = i / (samplesCount - 1);
      const sampleT = startT + frac * timeSpan;
      const amp = sampleWaveform(sampleT);
      const absAmp = Math.abs(amp);
      if (absAmp > peakAmp) peakAmp = absAmp;

      const screenX = frac * width;
      const screenY = midY - amp * (height * 0.42);
      wavePoints.push({ x: screenX, y: screenY, amp });
    }

    // 5. Draw Waveform Path & Fill / Glow
    if (wavePoints.length > 1) {
      // Gradient Fill under curve for UltraEdge
      if (mode === 'ultraedge') {
        const areaGrad = ctx.createLinearGradient(0, 0, 0, height);
        areaGrad.addColorStop(0, 'rgba(0, 240, 255, 0.22)');
        areaGrad.addColorStop(0.5, 'rgba(0, 240, 255, 0.02)');
        areaGrad.addColorStop(1, 'rgba(247, 37, 133, 0.15)');

        ctx.fillStyle = areaGrad;
        ctx.beginPath();
        ctx.moveTo(wavePoints[0].x, midY);
        for (const pt of wavePoints) {
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.lineTo(wavePoints[wavePoints.length - 1].x, midY);
        ctx.closePath();
        ctx.fill();

        // Stroke with glow
        ctx.shadowColor = peakAmp > 0.4 ? '#f72585' : '#00f0ff';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = peakAmp > 0.4 ? '#ff007f' : '#00f0ff';
        ctx.lineWidth = 2.2;
      } else {
        // Snickometer Phosphor green line with slight CRT bloom
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.8;
      }

      ctx.beginPath();
      ctx.moveTo(wavePoints[0].x, wavePoints[0].y);
      for (let i = 1; i < wavePoints.length; i++) {
        ctx.lineTo(wavePoints[i].x, wavePoints[i].y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 6. Draw Current Playhead Needle
    const playheadX = ((currentTime - startT) / timeSpan) * width;
    if (playheadX >= 0 && playheadX <= width) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Top triangle needle marker
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(playheadX - 6, 0);
      ctx.lineTo(playheadX + 6, 0);
      ctx.lineTo(playheadX, 9);
      ctx.closePath();
      ctx.fill();
    }

    // 7. Spectrum / Decibel Meter in Top-Right
    const dbValue = Math.max(-60, Math.round(20 * Math.log10(Math.max(0.001, peakAmp))));
    ctx.fillStyle = 'rgba(6, 13, 23, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.fillRect(width - 125, height - 32, 115, 24);
    ctx.strokeRect(width - 125, height - 32, 115, 24);

    ctx.fillStyle = peakAmp > 0.35 ? '#f43f5e' : '#38bdf8';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${dbValue} dBFS | ${(peakAmp * 100).toFixed(0)}%`, width - 18, height - 16);

    ctx.restore();
  }, [
    currentTime,
    duration,
    mode,
    zoomLevel,
    impactTimestamp,
    effectiveScenario,
    sampleWaveform
  ]);

  // Handle canvas click to scrub
  const handleCanvasClick = (e) => {
    if (!onSeek) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;

    const timeSpan = (duration / zoomLevel);
    const startT = Math.max(0, Math.min(duration - timeSpan, currentTime - timeSpan * 0.5));
    const targetT = Math.max(0, Math.min(duration, startT + (clickX / width) * timeSpan));

    onSeek(targetT);
  };

  // Determine current edge status chip
  const edgeStatus = useMemo(() => {
    const isAtImpact = Math.abs(currentTime - impactTimestamp) < 0.055;
    if (!isAtImpact) {
      return {
        label: 'MONITORING AUDIO TRACK',
        color: '#94a3b8',
        bg: 'rgba(148, 163, 184, 0.15)',
        border: 'rgba(148, 163, 184, 0.3)'
      };
    }
    if (effectiveScenario === 'bat') {
      return {
        label: 'SPIKE DETECTED - BAT CONTACT',
        color: '#f43f5e',
        bg: 'rgba(244, 63, 94, 0.25)',
        border: '#f43f5e',
        isHit: true
      };
    }
    if (effectiveScenario === 'pad') {
      return {
        label: 'ACOUSTIC THUD - PAD DEFLECTION',
        color: '#fbbf24',
        bg: 'rgba(251, 191, 36, 0.25)',
        border: '#fbbf24',
        isHit: true
      };
    }
    return {
      label: 'FLATLINE - NO CONTACT DETECTED',
      color: '#4ade80',
      bg: 'rgba(74, 222, 128, 0.2)',
      border: '#4ade80'
    };
  }, [currentTime, impactTimestamp, effectiveScenario]);

  return (
    <Paper sx={{
      bgcolor: mode === 'ultraedge' ? '#09131f' : '#03170a',
      borderRadius: 2.5,
      border: `1px solid ${mode === 'ultraedge' ? 'rgba(56, 189, 248, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
      p: 1.5,
      boxShadow: mode === 'ultraedge'
        ? '0 8px 32px rgba(0,0,0,0.6), inset 0 0 20px rgba(56, 189, 248, 0.05)'
        : '0 8px 32px rgba(0,0,0,0.6), inset 0 0 20px rgba(34, 197, 94, 0.05)',
      display: 'flex',
      flexDirection: 'column',
      gap: 1.2
    }}>
      {/* Top Header Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <GraphicEq sx={{
            color: mode === 'ultraedge' ? '#38bdf8' : '#4ade80',
            fontSize: 22
          }} />
          <Typography variant="subtitle2" sx={{
            fontWeight: 800,
            letterSpacing: 0.8,
            color: mode === 'ultraedge' ? '#38bdf8' : '#4ade80',
            textTransform: 'uppercase',
            fontSize: '0.8rem'
          }}>
            {mode === 'ultraedge' ? 'UltraEdge DSP Audio Track' : 'Snickometer Oscilloscope'}
          </Typography>
          <Chip
            size="small"
            label={edgeStatus.label}
            sx={{
              bgcolor: edgeStatus.bg,
              color: edgeStatus.color,
              border: `1px solid ${edgeStatus.border}`,
              fontWeight: 800,
              fontSize: '0.68rem',
              height: 20
            }}
          />
        </Box>

        {/* Audio Mode Switch & Audio Cue Toggle */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={enableAudioCue ? 'Audio Cues Active' : 'Audio Cues Muted'}>
            <IconButton
              size="small"
              onClick={() => setEnableAudioCue(!enableAudioCue)}
              sx={{ color: enableAudioCue ? '#38bdf8' : '#64748b', p: 0.5 }}
            >
              {enableAudioCue ? <VolumeUp fontSize="small" /> : <VolumeOff fontSize="small" />}
            </IconButton>
          </Tooltip>

          <ToggleButtonGroup
            size="small"
            value={mode}
            exclusive
            onChange={(_, val) => val && setMode(val)}
            sx={{
              height: 26,
              '& .MuiToggleButton-root': {
                color: '#94a3b8',
                borderColor: 'rgba(255,255,255,0.15)',
                fontSize: '0.68rem',
                fontWeight: 700,
                px: 1,
                py: 0
              },
              '& .Mui-selected': {
                bgcolor: mode === 'ultraedge' ? '#0284c7 !important' : '#15803d !important',
                color: 'white !important'
              }
            }}
          >
            <ToggleButton value="ultraedge">Ultra-Edge</ToggleButton>
            <ToggleButton value="snicko">Snicko</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Main Real-Time Oscilloscope Canvas */}
      <Box sx={{
        position: 'relative',
        width: '100%',
        height: compact ? 110 : 150,
        borderRadius: 1.5,
        overflow: 'hidden',
        border: `1px solid ${mode === 'ultraedge' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(34, 197, 94, 0.2)'}`,
        cursor: 'crosshair'
      }}>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />

        {/* Sync Indicator Pill */}
        <Box sx={{
          position: 'absolute',
          top: 6,
          left: 8,
          bgcolor: 'rgba(2, 6, 23, 0.75)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 1,
          px: 0.8,
          py: 0.2,
          display: 'flex',
          alignItems: 'center',
          gap: 0.6,
          pointerEvents: 'none'
        }}>
          <Box sx={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            bgcolor: '#ef4444',
            boxShadow: '0 0 6px #ef4444'
          }} />
          <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.62rem', fontWeight: 700 }}>
            SYNC: {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
          </Typography>
        </Box>
      </Box>

      {/* Control Bar: Scenario Selectors, Zoom, Sensitivity, Noise Floor */}
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 1.5,
        pt: 0.5
      }}>
        {/* Contact Scenario Preset */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem', fontWeight: 600 }}>
            Scenario:
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={contactScenario}
            exclusive
            onChange={(_, val) => val && setContactScenario(val)}
            sx={{
              height: 24,
              '& .MuiToggleButton-root': {
                color: '#94a3b8',
                borderColor: 'rgba(255,255,255,0.12)',
                fontSize: '0.65rem',
                fontWeight: 600,
                px: 0.8,
                py: 0
              },
              '& .Mui-selected': {
                bgcolor: 'rgba(56, 189, 248, 0.2) !important',
                color: '#38bdf8 !important',
                borderColor: '#38bdf8 !important'
              }
            }}
          >
            <ToggleButton value="auto">Auto</ToggleButton>
            <ToggleButton value="bat">Bat Edge</ToggleButton>
            <ToggleButton value="pad">Pad Thud</ToggleButton>
            <ToggleButton value="clean">Clean Miss</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {/* Sliders for Sensitivity & Noise Floor */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 260 }}>
          {/* Sensitivity */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Tooltip title="Acoustic Edge Gain Sensitivity">
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                Gain: {sensitivity.toFixed(1)}x
              </Typography>
            </Tooltip>
            <Slider
              size="small"
              value={sensitivity}
              min={0.5}
              max={2.5}
              step={0.1}
              onChange={(_, val) => setSensitivity(val)}
              sx={{
                color: mode === 'ultraedge' ? '#38bdf8' : '#4ade80',
                '& .MuiSlider-thumb': { width: 10, height: 10 },
                py: 0
              }}
            />
          </Box>

          {/* Noise Floor */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Tooltip title="Background Microphone Noise Floor Calibration">
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem', whiteSpace: 'nowrap' }}>
                Noise: {Math.round(noiseFloor * 100)}%
              </Typography>
            </Tooltip>
            <Slider
              size="small"
              value={noiseFloor}
              min={0.02}
              max={0.35}
              step={0.01}
              onChange={(_, val) => setNoiseFloor(val)}
              sx={{
                color: '#f59e0b',
                '& .MuiSlider-thumb': { width: 10, height: 10 },
                py: 0
              }}
            />
          </Box>

          {/* Zoom Level */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Zoom:
            </Typography>
            <ToggleButtonGroup
              size="small"
              value={zoomLevel}
              exclusive
              onChange={(_, val) => val && setZoomLevel(val)}
              sx={{
                height: 22,
                '& .MuiToggleButton-root': {
                  color: '#94a3b8',
                  borderColor: 'rgba(255,255,255,0.12)',
                  fontSize: '0.62rem',
                  px: 0.6,
                  py: 0
                },
                '& .Mui-selected': {
                  bgcolor: 'rgba(255,255,255,0.15) !important',
                  color: 'white !important'
                }
              }}
            >
              <ToggleButton value={1}>1x</ToggleButton>
              <ToggleButton value={2}>2x</ToggleButton>
              <ToggleButton value={4}>4x</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
