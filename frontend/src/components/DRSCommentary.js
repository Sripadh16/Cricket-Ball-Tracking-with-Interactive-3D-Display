import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box, Typography, IconButton, Slider, Select, MenuItem, FormControl,
  Tooltip, Paper, Switch
} from '@mui/material';
import {
  VolumeUp, VolumeOff, RecordVoiceOver, GraphicEq,
  Campaign, Hearing
} from '@mui/icons-material';

/**
 * DRSCommentary
 * TV Broadcast Third Umpire Spoken AI Audio Commentary
 * Synchronized with replay progress using HTML5 Web Speech API (window.speechSynthesis)
 */
export default function DRSCommentary({
  trajectoryData,
  currentTime = 0,
  isPlaying = false,
  showControls = true,
  showTicker = true,
  style = {}
}) {
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [accent, setAccent] = useState('uk'); // 'default', 'uk', 'australia', 'india', 'us'
  const [availableVoices, setAvailableVoices] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState('Standby for TV Third Umpire review protocol...');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);

  const spokenStagesRef = useRef({
    release: false,
    pitching: false,
    impact: false,
    wickets: false
  });
  const prevTimeRef = useRef(0);

  // Load available speech synthesis voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeechSupported(false);
      return;
    }

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices() || [];
      setAvailableVoices(voices);
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Determine key event timings from trajectory data
  const eventTimings = useMemo(() => {
    if (!trajectoryData) return { release: 0.05, bounce: 0.5, impact: 0.9, end: 1.4 };

    const bounceT = trajectoryData.bounce_point?.t ?? 0.5;
    const impactT = trajectoryData.impact_point?.t ?? (bounceT + 0.35);
    const endT = trajectoryData.video_duration ?? 1.5;

    return {
      release: 0.05,
      bounce: bounceT,
      impact: impactT,
      end: Math.max(impactT + 0.2, endT - 0.1)
    };
  }, [trajectoryData]);

  // Extract DRS telemetry values
  const drs = trajectoryData?.drs_evaluation;
  const releaseSpeed = trajectoryData?.release_speed_kmh ?? null;
  // Only show verdicts when DRS data is actually present — never invent verdicts for real uploads
  const pitchingVerdict = drs?.pitching?.toUpperCase() ?? null;
  const impactVerdict = drs?.impact?.toUpperCase() ?? null;
  const wicketsVerdict = drs?.wickets?.toUpperCase() ?? null;
  const hitStump = trajectoryData?.stump_plane_target?.hit_stump || drs?.hit_stump || 'the wicket';

  // Generate authoritative Third Umpire dialogue for each stage
  const dialogueScripts = useMemo(() => {
    // 1. Release
    const releaseText = releaseSpeed != null
      ? `Delivery released at ${releaseSpeed} kilometres per hour. Tracking trajectory down the pitch.`
      : `Delivery tracking initiated. Speed measurement unavailable for this footage.`;

    // 2. Pitching — only if DRS data is available
    let pitchText = pitchingVerdict != null
      ? `Pitching is in line with the stumps.`
      : `Pitching analysis unavailable — DRS reconstruction requires calibrated camera data.`;
    if (pitchingVerdict?.includes('OUTSIDE OFF')) {
      pitchText = `Pitching is outside off stump.`;
    } else if (pitchingVerdict?.includes('OUTSIDE LEG')) {
      pitchText = `Pitching is outside leg stump. Ball pitched outside leg line.`;
    }

    // 3. Impact — only if DRS data is available
    let impactText = impactVerdict != null
      ? `Impact is in line with the stumps. Ball has struck the pad.`
      : `Impact analysis unavailable for this footage.`;
    if (impactVerdict?.includes('OUTSIDE')) {
      impactText = `Impact is outside the off-stump line. Ball has struck the pad.`;
    } else if (impactVerdict?.includes('NO IMPACT')) {
      impactText = `No pad impact detected. Clean delivery passing directly through to the stumps.`;
    }

    // 4. Wickets & TV Umpire Recommendation — only if DRS data is available
    let wicketsText = wicketsVerdict != null
      ? `Wickets: Missing the stumps. I recommend you reverse your decision to NOT OUT.`
      : `Wickets projection unavailable — insufficient geometric data for stump-plane reconstruction.`;
    if (wicketsVerdict === 'HITTING') {
      wicketsText = `Wickets: Hitting ${hitStump}. You can stay with your original on-field decision of OUT. Signal now.`;
    } else if (wicketsVerdict === "UMPIRE'S CALL") {
      wicketsText = `Wickets: Umpire's call clipping ${hitStump}. I recommend you stay with your on-field call.`;
    }

    return {
      release: releaseText,
      pitching: pitchText,
      impact: impactText,
      wickets: wicketsText
    };
  }, [releaseSpeed, pitchingVerdict, impactVerdict, wicketsVerdict, hitStump]);

  // Find optimal voice matching selected accent
  const getSelectedVoice = useCallback(() => {
    if (!availableVoices || availableVoices.length === 0) return null;

    const accentMatch = {
      uk: ['en-GB', 'en_GB', 'English (United Kingdom)', 'UK', 'British', 'Daniel', 'Oliver', 'George'],
      australia: ['en-AU', 'en_AU', 'English (Australia)', 'Australian', 'Karen', 'Lee'],
      india: ['en-IN', 'en_IN', 'English (India)', 'Indian', 'Rishi', 'Veena', 'Heera'],
      us: ['en-US', 'en_US', 'English (United States)', 'Samantha', 'Alex', 'Fred']
    };

    const searchPatterns = accentMatch[accent] || [];

    for (const pattern of searchPatterns) {
      const found = availableVoices.find(
        (v) =>
          v.lang?.toLowerCase().includes(pattern.toLowerCase()) ||
          v.name?.toLowerCase().includes(pattern.toLowerCase())
      );
      if (found) return found;
    }

    // Fallback: any English voice
    return availableVoices.find((v) => v.lang?.startsWith('en')) || availableVoices[0] || null;
  }, [availableVoices, accent]);

  // Speak a speech segment using Web Speech API
  const speakDialogue = useCallback((text) => {
    if (!speechSupported || isMuted || typeof window === 'undefined' || !window.speechSynthesis) {
      setActiveSubtitle(text);
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Snappy transition to latest milestone
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = getSelectedVoice();
      if (voice) utterance.voice = voice;

      utterance.volume = volume;
      utterance.rate = 1.02; // Firm, authoritative broadcast cadence
      utterance.pitch = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      setActiveSubtitle(text);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech synthesis error:', err);
      setActiveSubtitle(text);
    }
  }, [speechSupported, isMuted, volume, getSelectedVoice]);

  // Synchronize spoken commentary with playback time
  useEffect(() => {
    // Detect replay loop restart or rewind
    if (currentTime < prevTimeRef.current - 0.25 || currentTime < 0.08) {
      spokenStagesRef.current = {
        release: false,
        pitching: false,
        impact: false,
        wickets: false
      };
      if (currentTime < 0.08 && isPlaying) {
        setActiveSubtitle('Tracking delivery sequence from bowler release...');
      }
    }
    prevTimeRef.current = currentTime;

    if (!isPlaying) return;

    // Check milestones
    const { release, bounce, impact, end } = eventTimings;

    // Stage 1: Release
    if (currentTime >= release && currentTime < bounce && !spokenStagesRef.current.release) {
      spokenStagesRef.current.release = true;
      speakDialogue(dialogueScripts.release);
    }
    // Stage 2: Pitching
    else if (currentTime >= bounce && currentTime < impact && !spokenStagesRef.current.pitching) {
      spokenStagesRef.current.pitching = true;
      speakDialogue(dialogueScripts.pitching);
    }
    // Stage 3: Pad Impact
    else if (currentTime >= impact && currentTime < end && !spokenStagesRef.current.impact) {
      spokenStagesRef.current.impact = true;
      speakDialogue(dialogueScripts.impact);
    }
    // Stage 4: Wickets & Verdict
    else if (currentTime >= end && !spokenStagesRef.current.wickets) {
      spokenStagesRef.current.wickets = true;
      speakDialogue(dialogueScripts.wickets);
    }
  }, [currentTime, isPlaying, eventTimings, dialogueScripts, speakDialogue]);

  // Manual Trigger: speak full TV review sequence
  const handlePlayFullVerdict = () => {
    const fullSpeech = `Third Umpire review protocol. ${dialogueScripts.release} ${dialogueScripts.pitching} ${dialogueScripts.impact} ${dialogueScripts.wickets}`;
    speakDialogue(fullSpeech);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, ...style }}>
      {/* Visual Closed-Captions Subtitle Ticker Strip across Viewer */}
      {showTicker && (
        <Paper
          elevation={4}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1,
            bgcolor: 'rgba(6, 15, 28, 0.92)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            borderRadius: 2,
            boxShadow: '0 4px 20px rgba(0,0,0,0.6), inset 0 0 12px rgba(56, 189, 248, 0.1)',
            overflow: 'hidden'
          }}
        >
          {/* Umpire Audio Badge & Pulsing Graphic EQ */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: isSpeaking ? '#22c55e' : '#38bdf8',
                boxShadow: isSpeaking ? '0 0 10px #22c55e' : '0 0 6px #38bdf8',
                transition: 'all 0.3s'
              }}
            />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 900,
                letterSpacing: 0.8,
                color: isSpeaking ? '#4ade80' : '#38bdf8',
                textTransform: 'uppercase',
                fontSize: '0.68rem',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5
              }}
            >
              <RecordVoiceOver sx={{ fontSize: 14 }} />
              THIRD UMPIRE
            </Typography>
            {isSpeaking && (
              <GraphicEq
                sx={{
                  fontSize: 16,
                  color: '#4ade80',
                  animation: 'pulse 1s infinite alternate',
                  '@keyframes pulse': {
                    '0%': { transform: 'scale(0.8)' },
                    '100%': { transform: 'scale(1.2)' }
                  }
                }}
              />
            )}
          </Box>

          {/* Subtitle Ticker Text */}
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              fontWeight: 600,
              fontSize: { xs: '0.75rem', sm: '0.84rem' },
              color: '#f8fafc',
              fontStyle: 'italic',
              letterSpacing: 0.3,
              lineHeight: 1.3,
              textShadow: '0 1px 3px rgba(0,0,0,0.9)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            &ldquo;{activeSubtitle}&rdquo;
          </Typography>

          {/* Quick Mute Indicator / Button */}
          <Tooltip title={isMuted ? 'Unmute AI Commentary' : 'Mute Commentary'}>
            <IconButton
              size="small"
              onClick={() => {
                if (!isMuted && window.speechSynthesis) window.speechSynthesis.cancel();
                setIsMuted(!isMuted);
              }}
              sx={{
                color: isMuted ? '#f87171' : '#38bdf8',
                bgcolor: isMuted ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                p: 0.5,
                '&:hover': {
                  bgcolor: isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.25)'
                }
              }}
            >
              {isMuted ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Paper>
      )}

      {/* Broadcast Audio Commentary Controls Bar */}
      {showControls && (
        <Paper
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
            px: 1.8,
            py: 0.8,
            bgcolor: 'rgba(10, 22, 40, 0.85)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 2
          }}
        >
          {/* Audio Status & Switch */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
            <Campaign sx={{ color: isMuted ? '#64748b' : '#38bdf8', fontSize: 20 }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.75rem' }}>
              Spoken AI Commentary
            </Typography>
            <Switch
              size="small"
              checked={!isMuted}
              onChange={(e) => {
                const enable = e.target.checked;
                setIsMuted(!enable);
                if (!enable && window.speechSynthesis) window.speechSynthesis.cancel();
              }}
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': { color: '#38bdf8' },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#0284c7' }
              }}
            />
          </Box>

          {/* Volume Slider & Accent Selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            {/* Speech Volume */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
              <VolumeUp sx={{ fontSize: 16, color: '#94a3b8' }} />
              <Slider
                size="small"
                value={volume}
                min={0}
                max={1}
                step={0.05}
                disabled={isMuted}
                onChange={(_, v) => setVolume(v)}
                sx={{
                  color: '#38bdf8',
                  width: 70,
                  '& .MuiSlider-thumb': { width: 10, height: 10 }
                }}
              />
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem', minWidth: 26, fontFamily: 'monospace' }}>
                {Math.round(volume * 100)}%
              </Typography>
            </Box>

            {/* Voice Accent Picker */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem' }}>
                Accent:
              </Typography>
              <FormControl size="small">
                <Select
                  value={accent}
                  disabled={isMuted}
                  onChange={(e) => setAccent(e.target.value)}
                  sx={{
                    color: 'white',
                    bgcolor: 'rgba(255,255,255,0.06)',
                    height: 26,
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: 1,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,0.18)' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#38bdf8' },
                    '& .MuiSvgIcon-root': { color: '#94a3b8', fontSize: 16 }
                  }}
                >
                  <MenuItem value="uk" sx={{ fontSize: '0.75rem' }}>🇬🇧 UK English</MenuItem>
                  <MenuItem value="australia" sx={{ fontSize: '0.75rem' }}>🇦🇺 Australian</MenuItem>
                  <MenuItem value="india" sx={{ fontSize: '0.75rem' }}>🇮🇳 Indian</MenuItem>
                  <MenuItem value="us" sx={{ fontSize: '0.75rem' }}>🇺🇸 US English</MenuItem>
                  <MenuItem value="default" sx={{ fontSize: '0.75rem' }}>🌐 Standard Default</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {/* Test Voice / Speak Now Button */}
            <Tooltip title="Test voice dialogue for current delivery">
              <IconButton
                size="small"
                onClick={handlePlayFullVerdict}
                disabled={isMuted}
                sx={{
                  bgcolor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  p: 0.5,
                  borderRadius: 1,
                  '&:hover': { bgcolor: 'rgba(56, 189, 248, 0.28)' }
                }}
              >
                <Hearing sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
