import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, Chip, IconButton, Button, Dialog,
  DialogContent, Tooltip, Fade
} from '@mui/material';
import {
  CheckCircle, Cancel, ErrorOutline, Replay,
  Close, ArrowForward
} from '@mui/icons-material';

/**
 * DecisionFlowHUD
 * TV Broadcast 3-Stage Decision Flowchart modal & overlay:
 * [1. PITCHING]  --->  [2. IMPACT]  --->  [3. WICKETS]  --->  [FINAL VERDICT]
 * High-voltage television graphics with sequential animations, neon glowing badges,
 * and official ICC television verdict banner.
 */
export default function DecisionFlowHUD({
  open = false,
  onClose,
  trajectoryData,
  isOverlay = false, // If true, renders as in-viewer HUD card instead of modal Dialog
  autoPlaySequence = true
}) {
  const drs = trajectoryData?.drs_evaluation;

  // Decision stage determinations
  const pitchingVerdict = (drs?.pitching || 'IN LINE').toUpperCase();
  const impactVerdict = (drs?.impact || 'IN LINE').toUpperCase();
  const wicketsVerdict = (drs?.wickets || 'HITTING').toUpperCase();
  const rawDecision = (drs?.decision || 'OUT').toUpperCase();

  const isOut = rawDecision.includes('OUT') && !rawDecision.includes('NOT');
  const isUmpiresCall = rawDecision.includes('UMPIRE');

  const finalDecisionText = isOut
    ? 'OUT'
    : isUmpiresCall
    ? "UMPIRE'S CALL"
    : 'NOT OUT';

  // Animation Step: 0 = idle/all visible, 1 = Pitching, 2 = Impact, 3 = Wickets, 4 = Final Verdict
  const [activeStep, setActiveStep] = useState(autoPlaySequence ? 1 : 4);
  const [isPlayingSeq, setIsPlayingSeq] = useState(autoPlaySequence);

  useEffect(() => {
    if (!open && !isOverlay) return;

    if (autoPlaySequence) {
      setActiveStep(1);
      setIsPlayingSeq(true);
    } else {
      setActiveStep(4);
      setIsPlayingSeq(false);
    }
  }, [open, isOverlay, autoPlaySequence]);

  // Sequential Reveal Clock
  useEffect(() => {
    if (!isPlayingSeq) return;

    const timer = setInterval(() => {
      setActiveStep((prev) => {
        if (prev < 4) return prev + 1;
        setIsPlayingSeq(false);
        return 4;
      });
    }, 1100);

    return () => clearInterval(timer);
  }, [isPlayingSeq]);

  const handleRestartSequence = () => {
    setActiveStep(1);
    setIsPlayingSeq(true);
  };

  // Helper for node styling
  const getNodeStatus = (stageType) => {
    if (stageType === 'pitching') {
      const isPass = pitchingVerdict.includes('IN LINE');
      return {
        label: pitchingVerdict,
        type: isPass ? 'success' : 'danger',
        desc: isPass ? 'In line with stumps' : pitchingVerdict.toLowerCase()
      };
    }
    if (stageType === 'impact') {
      const isPass = impactVerdict.includes('IN LINE');
      return {
        label: impactVerdict,
        type: isPass ? 'success' : impactVerdict.includes('NO IMPACT') ? 'warning' : 'danger',
        desc: isPass ? 'In line with stumps' : impactVerdict.toLowerCase()
      };
    }
    if (stageType === 'wickets') {
      const isHit = wicketsVerdict.includes('HITTING');
      const isUmp = wicketsVerdict.includes('UMPIRE');
      return {
        label: wicketsVerdict,
        type: isHit ? 'success' : isUmp ? 'warning' : 'danger',
        desc: isHit
          ? `Hitting ${trajectoryData?.stump_plane_target?.hit_stump || 'Stumps'}`
          : isUmp
          ? `Clipping ${trajectoryData?.stump_plane_target?.hit_stump || 'Bails'}`
          : 'Missing stumps'
      };
    }
    return { label: '', type: 'default', desc: '' };
  };

  const pitchingStatus = getNodeStatus('pitching');
  const impactStatus = getNodeStatus('impact');
  const wicketsStatus = getNodeStatus('wickets');

  // Render individual Flowchart Stage Node
  const renderStageNode = (stepNumber, title, status, stepIndex) => {
    const isRevealed = activeStep >= stepIndex;
    const isCurrent = activeStep === stepIndex;

    let icon = <CheckCircle sx={{ fontSize: 26, color: '#22c55e' }} />;
    let borderColor = 'rgba(34, 197, 94, 0.6)';
    let glowColor = 'rgba(34, 197, 94, 0.4)';
    let badgeBg = 'rgba(34, 197, 94, 0.15)';
    let textColor = '#4ade80';

    if (status.type === 'danger') {
      icon = <Cancel sx={{ fontSize: 26, color: '#ef4444' }} />;
      borderColor = 'rgba(239, 68, 68, 0.7)';
      glowColor = 'rgba(239, 68, 68, 0.45)';
      badgeBg = 'rgba(239, 68, 68, 0.15)';
      textColor = '#f87171';
    } else if (status.type === 'warning') {
      icon = <ErrorOutline sx={{ fontSize: 26, color: '#f59e0b' }} />;
      borderColor = 'rgba(245, 158, 11, 0.7)';
      glowColor = 'rgba(245, 158, 11, 0.45)';
      badgeBg = 'rgba(245, 158, 11, 0.18)';
      textColor = '#fbbf24';
    }

    return (
      <Box
        sx={{
          flex: 1,
          minWidth: { xs: '100%', sm: 160 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
          opacity: isRevealed ? 1 : 0.25,
          transform: isRevealed ? (isCurrent ? 'scale(1.04)' : 'scale(1)') : 'scale(0.95)',
          position: 'relative'
        }}
      >
        {/* Step Indicator Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, mb: 1 }}>
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              bgcolor: isRevealed ? (isCurrent ? '#38bdf8' : 'rgba(255,255,255,0.2)') : 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.68rem',
              fontWeight: 800,
              color: 'white',
              boxShadow: isCurrent ? '0 0 10px #38bdf8' : 'none'
            }}
          >
            {stepNumber}
          </Box>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              letterSpacing: 1.2,
              color: isRevealed ? '#cbd5e1' : '#64748b',
              textTransform: 'uppercase',
              fontSize: '0.72rem'
            }}
          >
            {title}
          </Typography>
        </Box>

        {/* Node Card */}
        <Paper
          elevation={isCurrent ? 8 : 2}
          sx={{
            width: '100%',
            p: 1.8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            bgcolor: isRevealed ? 'rgba(15, 23, 42, 0.95)' : 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(12px)',
            border: `2px solid ${isRevealed ? borderColor : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 3,
            boxShadow: isRevealed
              ? `0 0 20px ${glowColor}, inset 0 0 12px ${glowColor}`
              : 'none',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Active pulse highlight strip */}
          {isCurrent && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                bgcolor: textColor,
                boxShadow: `0 0 10px ${textColor}`
              }}
            />
          )}

          {/* Node Icon */}
          <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </Box>

          {/* Stage Value Chip */}
          <Chip
            label={status.label}
            size="small"
            sx={{
              bgcolor: badgeBg,
              color: textColor,
              border: `1px solid ${borderColor}`,
              fontWeight: 900,
              fontSize: '0.75rem',
              letterSpacing: 0.5,
              mb: 0.8
            }}
          />

          {/* Detailed Metric Description */}
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem', lineHeight: 1.2 }}>
            {status.desc}
          </Typography>
        </Paper>
      </Box>
    );
  };

  // Main TV Graphic Content
  const content = (
    <Box
      sx={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
        p: { xs: 2, sm: 3 },
        bgcolor: '#071220',
        color: 'white',
        borderRadius: 3,
        border: '1px solid rgba(56, 189, 248, 0.3)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 30px rgba(56, 189, 248, 0.15)',
        position: 'relative'
      }}
    >
      {/* Top TV Header Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', pb: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: '#ef4444',
              boxShadow: '0 0 10px #ef4444',
              animation: 'blink 1.2s infinite',
              '@keyframes blink': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.4 } }
            }}
          />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', color: '#38bdf8', lineHeight: 1.1 }}>
              HAWK-EYE DECISION FLOW
            </Typography>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Official ICC Television LBW Protocol
            </Typography>
          </Box>
        </Box>

        {/* Action Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title="Replay TV Decision Sequence">
            <Button
              size="small"
              variant="outlined"
              startIcon={<Replay sx={{ fontSize: '14px !important' }} />}
              onClick={handleRestartSequence}
              sx={{
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                fontSize: '0.7rem',
                fontWeight: 700,
                textTransform: 'none',
                py: 0.4,
                '&:hover': { borderColor: '#38bdf8', bgcolor: 'rgba(56, 189, 248, 0.1)' }
              }}
            >
              Replay Flow
            </Button>
          </Tooltip>

          {onClose && (
            <IconButton onClick={onClose} size="small" sx={{ color: '#94a3b8', '&:hover': { color: 'white' } }}>
              <Close fontSize="small" />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* 3-Stage Decision Flowchart Row */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 2, sm: 1.5 },
          position: 'relative'
        }}
      >
        {/* Node 1: Pitching */}
        {renderStageNode(1, 'Pitching', pitchingStatus, 1)}

        {/* Arrow Connector 1 -> 2 */}
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            justifyContent: 'center',
            color: activeStep >= 2 ? '#38bdf8' : 'rgba(255,255,255,0.15)',
            transition: 'color 0.4s'
          }}
        >
          <ArrowForward sx={{ fontSize: 24 }} />
        </Box>

        {/* Node 2: Impact */}
        {renderStageNode(2, 'Impact', impactStatus, 2)}

        {/* Arrow Connector 2 -> 3 */}
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            justifyContent: 'center',
            color: activeStep >= 3 ? '#38bdf8' : 'rgba(255,255,255,0.15)',
            transition: 'color 0.4s'
          }}
        >
          <ArrowForward sx={{ fontSize: 24 }} />
        </Box>

        {/* Node 3: Wickets */}
        {renderStageNode(3, 'Wickets', wicketsStatus, 3)}
      </Box>

      {/* Final Official Television Verdict Graphic (Stage 4) */}
      <Fade in={activeStep >= 4} timeout={600}>
        <Paper
          sx={{
            p: 2.2,
            textAlign: 'center',
            borderRadius: 3,
            bgcolor: isOut
              ? 'rgba(220, 38, 38, 0.95)'
              : isUmpiresCall
              ? 'rgba(217, 119, 6, 0.95)'
              : 'rgba(16, 149, 114, 0.95)',
            boxShadow: isOut
              ? '0 0 40px rgba(239, 68, 68, 0.6), inset 0 0 20px rgba(255,255,255,0.2)'
              : isUmpiresCall
              ? '0 0 40px rgba(245, 158, 11, 0.6), inset 0 0 20px rgba(255,255,255,0.2)'
              : '0 0 40px rgba(34, 197, 94, 0.6), inset 0 0 20px rgba(255,255,255,0.2)',
            border: '2px solid rgba(255,255,255,0.4)',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* TV Scanline Graphic Effect */}
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.15), rgba(0,0,0,0.15) 2px, transparent 2px, transparent 4px)',
              pointerEvents: 'none'
            }}
          />

          <Typography
            variant="caption"
            sx={{
              fontWeight: 800,
              letterSpacing: 2,
              color: 'rgba(255,255,255,0.85)',
              textTransform: 'uppercase',
              fontSize: '0.75rem',
              display: 'block',
              mb: 0.3
            }}
          >
            OFFICIAL THIRD UMPIRE VERDICT
          </Typography>

          <Typography
            variant="h3"
            sx={{
              fontWeight: 950,
              letterSpacing: { xs: 3, sm: 6 },
              color: '#ffffff',
              textShadow: '0 4px 16px rgba(0,0,0,0.8), 0 0 20px rgba(255,255,255,0.5)',
              fontSize: { xs: '2rem', sm: '2.8rem' },
              lineHeight: 1.1
            }}
          >
            {finalDecisionText}
          </Typography>

          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              color: 'rgba(255,255,255,0.92)',
              fontSize: '0.75rem',
              mt: 0.6,
              display: 'block'
            }}
          >
            {isOut
              ? `Decision Confirmed: Trajectory is projected to hit ${trajectoryData?.stump_plane_target?.hit_stump || 'middle stump'}.`
              : isUmpiresCall
              ? `On-Field Decision Stands: Ball clipping stumps zone.`
              : `Decision Overturned: Ball trajectory missing stumps.`}
          </Typography>
        </Paper>
      </Fade>
    </Box>
  );

  // If used as in-viewer overlay
  if (isOverlay) {
    return content;
  }

  // Modal dialog mode
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'transparent',
          boxShadow: 'none',
          overflow: 'visible'
        }
      }}
    >
      <DialogContent sx={{ p: 0 }}>
        {content}
      </DialogContent>
    </Dialog>
  );
}
