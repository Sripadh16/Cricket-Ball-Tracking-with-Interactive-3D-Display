import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, ToggleButton, ToggleButtonGroup, Slider, Paper, Button, Alert, FormControlLabel, Switch } from '@mui/material';
import { analyzeAudio, audioExtrema } from '../utils/audio';

// Cache only the last two decoded envelopes, never PCM or another audio transport.
const sourceCache = new Map();
export default function UltraEdgeVisualizer({ currentTime = 0, duration = 1.5, trajectoryData,
  onSeek, compact = false, isPlaying = false, isSeeking = false, sourceAudioUrl, isSimulation = false }) {
  const [demo, setDemo] = useState(isSimulation);
  const [storedAudio, setAudio] = useState(null);
  const audio = storedAudio?.sourceUrl === sourceAudioUrl ? storedAudio : null;
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('ultraedge');
  const [scenario, setScenario] = useState('auto');
  const [gain, setGain] = useState(1);
  const [noise, setNoise] = useState(0.12);
  const [zoom, setZoom] = useState(2);
  const [cue, setCue] = useState(false);
  const [size, setSize] = useState([0, 0]);
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const previousRef = useRef(null);
  const firedRef = useRef(false);
  const simulation = isSimulation || demo;
  const eventTime = trajectoryData?.impact_point?.t ?? trajectoryData?.collision_event?.time;
  const eventType = scenario !== 'auto' ? scenario : trajectoryData?.impact_point ? 'pad' : 'clean';
  const offset = Number.isFinite(trajectoryData?.audio_start_s) ? trajectoryData.audio_start_s : 0;
  const span = Math.max(0.01, duration / zoom);
  const start = Math.max(0, Math.min(duration - span, currentTime - span / 2));

  useEffect(() => { setDemo(isSimulation); }, [isSimulation, sourceAudioUrl]);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let context;
    setAudio(null);
    setError('');
    setLoading(false);
    if (simulation) return;
    if (!sourceAudioUrl) { setError('No source audio is available.'); return; }
    if (sourceCache.has(sourceAudioUrl)) { setAudio(sourceCache.get(sourceAudioUrl)); return; }
    setLoading(true);
    (async () => {
      try {
        const response = await fetch(sourceAudioUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load source audio. Reopen the clip to retry.');
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('Audio decoding is unsupported in this browser.');
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes);
        if (cancelled) return;
        const result = { ...analyzeAudio(decoded), sourceUrl: sourceAudioUrl };
        if (sourceCache.size >= 2) sourceCache.delete(sourceCache.keys().next().value);
        sourceCache.set(sourceAudioUrl, result);
        setAudio(result);
      } catch (err) {
        if (!cancelled) setError(err.message?.includes('load source') ? err.message : 'No decodable audio track. Try a browser-supported file with audio.');
      } finally {
        if (context && context.state !== 'closed') await context.close().catch(() => {});
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [simulation, sourceAudioUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const observer = new ResizeObserver(() => setSize([canvas.clientWidth, canvas.clientHeight]));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { contextRef.current?.close().catch(() => {}); }, []);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = currentTime;
    if (previous == null || currentTime < previous) firedRef.current = false;
    if (!simulation || !cue || !isPlaying || isSeeking || !Number.isFinite(eventTime)
      || previous == null || currentTime < previous || currentTime - previous > 0.1
      || previous >= eventTime || currentTime < eventTime || firedRef.current || eventType === 'clean') return;
    firedRef.current = true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = contextRef.current || (contextRef.current = new AudioContext());
      context.resume().catch(() => {});
      const oscillator = context.createOscillator();
      const volume = context.createGain();
      oscillator.frequency.value = eventType === 'bat' ? 2400 : 350;
      volume.gain.setValueAtTime(0.15, context.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(volume); volume.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + 0.1);
    } catch { /* A browser may deny optional synthetic sound. */ }
  }, [currentTime, eventTime, eventType, simulation, cue, isPlaying, isSeeking]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101318'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#adb8c7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    if (!simulation && (!audio || loading || error)) return;
    ctx.strokeStyle = mode === 'ultraedge' ? '#8ab4ff' : '#8fd8a8';
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      const t = start + x / width * span;
      let low, high;
      if (simulation) {
        const contact = Number.isFinite(eventTime) && eventType !== 'clean'
          ? Math.exp(-Math.abs(t - eventTime) * (eventType === 'bat' ? 90 : 45)) * 0.8 : 0;
        high = Math.abs(Math.sin(t * 970)) * noise + contact;
        low = -high;
      } else [low, high] = audioExtrema(audio, t - offset, t - offset + span / Math.max(1, width));
      ctx.moveTo(x, height / 2 - Math.min(1, high * gain) * height * 0.44);
      ctx.lineTo(x, height / 2 - Math.max(-1, low * gain) * height * 0.44);
    }
    ctx.stroke();
    const markers = simulation ? (Number.isFinite(eventTime) ? [eventTime] : []) : audio.candidates.map(t => t + offset);
    ctx.strokeStyle = '#f6d365'; ctx.setLineDash([3, 3]);
    for (const t of markers) {
      const x = (t - start) / span * width;
      if (x >= 0 && x <= width) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    }
    ctx.setLineDash([]); ctx.strokeStyle = '#f2f5f9';
    const cursor = (currentTime - start) / span * width;
    ctx.beginPath(); ctx.moveTo(cursor, 0); ctx.lineTo(cursor, height); ctx.stroke();
  }, [audio, loading, error, simulation, eventTime, eventType, noise, gain, mode, start, span, currentTime, offset, size]);

  return <Paper elevation={0} sx={{ p: 2, bgcolor: 'background.paper', minWidth: 0 }}>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1 }}>
      <Typography component="h3" variant="subtitle1">{simulation ? 'Simulated audio demonstration' : 'Source audio inspection'}</Typography>
      {!isSimulation && <Button onClick={() => setDemo(!demo)}>{demo ? 'Switch to source' : 'Switch to demo'}</Button>}
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
      {simulation ? 'Synthetic bat, pad and clean scenarios. These sounds are not uploaded evidence.'
        : 'Raw channel envelope. Yellow markers are candidate sound events; inspect the video. Sound alone cannot identify bat contact.'}
    </Typography>
    {!simulation && <Typography variant="caption" color="text.secondary" display="block">
      {audio ? `${audio.channels} channel(s) · ${audio.sampleRate} Hz · ${audio.candidates.length} candidate(s). ` : ''}
      {Number.isFinite(trajectoryData?.audio_start_s) ? `Audio offset: ${offset}s.` : 'Container audio offset is unverified; zero offset assumed.'}
    </Typography>}
    {loading && <Typography role="status">Decoding source audio…</Typography>}
    {!simulation && error && <Alert severity="info">{error}</Alert>}
    {!simulation && audio?.peak < 0.002 && <Alert severity="info">Source audio is silent or too quiet to assess contact.</Alert>}
    <canvas ref={canvasRef} aria-label={simulation ? 'Synthetic waveform' : 'Source audio waveform'}
      onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); if (rect.width) onSeek?.(start + (e.clientX - rect.left) / rect.width * span); }}
      style={{ width: '100%', height: compact ? 110 : 160, display: 'block', marginTop: 12 }} />
    <Slider aria-label="Audio inspection timeline" value={Math.min(duration, currentTime)} min={0} max={Math.max(0.01, duration)} step={0.001}
      onChange={(_, value) => onSeek?.(value)} disabled={!onSeek} valueLabelDisplay="auto" />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
      <ToggleButtonGroup value={mode} exclusive size="small" aria-label="Waveform appearance" onChange={(_, value) => value && setMode(value)}>
        <ToggleButton value="ultraedge">UltraEdge style</ToggleButton><ToggleButton value="snicko">Snickometer style</ToggleButton>
      </ToggleButtonGroup>
      <ToggleButtonGroup value={zoom} exclusive size="small" aria-label="Audio zoom" onChange={(_, value) => value && setZoom(value)}>
        {[1, 2, 4].map(value => <ToggleButton key={value} value={value}>{value}x</ToggleButton>)}
      </ToggleButtonGroup>
      <Box sx={{ width: 160 }}><Typography variant="caption">Display gain {gain.toFixed(1)}x</Typography>
        <Slider aria-label="Waveform display gain" min={0.5} max={2.5} step={0.1} value={gain} onChange={(_, value) => setGain(value)} /></Box>
      {simulation && <>
        <ToggleButtonGroup value={scenario} exclusive size="small" aria-label="Simulated contact" onChange={(_, value) => value && setScenario(value)}>
          {['auto', 'bat', 'pad', 'clean'].map(value => <ToggleButton key={value} value={value}>{value}</ToggleButton>)}
        </ToggleButtonGroup>
        <Box sx={{ width: 160 }}><Typography variant="caption">Simulated noise floor</Typography>
          <Slider aria-label="Simulated noise floor" min={0.02} max={0.4} step={0.01} value={noise} onChange={(_, value) => setNoise(value)} /></Box>
        <FormControlLabel control={<Switch checked={cue} onChange={e => setCue(e.target.checked)} />} label="Synthetic sound cues" />
      </>}
    </Box>
    <Typography variant="caption" color="text.secondary">{currentTime.toFixed(2)}s / {duration.toFixed(2)}s · Styles change appearance only; no acoustic filter or edge classifier is applied.</Typography>
  </Paper>;
}
