import React, { useMemo } from 'react';
import { Box, Typography, Chip } from '@mui/material';

/**
 * Swing & delivery classifier card.
 *
 * Reads the backend's `trajectory.swing_analysis` (see services/delivery_classifier.py build_swing_analysis) and the
 * reconstructed 3D points. World frame: x across the pitch (+x = off side for a right-handed batter), y from the
 * bowler's stumps (-10.06 m) to the striker's stumps (+10.06 m), metres.
 *   air_swing_mm        + = towards +x (outswing for a RHB), - = towards leg (inswing)
 *   seam_deviation_deg  + = deviates towards +x after the bounce (away from a RHB), - = back in
 * Renders nothing when there is no reconstructed path.
 */

const STUMP_Y = 10.06;
const HALF_PITCH_W = 1.52; // return creases sit 1.32 m either side of middle; a little margin
const CREASE_Y = 8.84;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function usablePoints(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && num(p.x) !== null && num(p.y) !== null)
    .map((p) => ({ x: p.x, y: p.y, t: num(p.t), phase: p.phase }));
}

function directionWord(dir, kind) {
  if (dir === 'inswing') return 'Inswing';
  if (dir === 'outswing') return 'Outswing';
  if (dir === 'in') return kind === 'spin' ? 'Turns in' : 'Nips back in';
  if (dir === 'away') return kind === 'spin' ? 'Turns away' : 'Seams away';
  return 'None';
}

function Stat({ label, value, sub, tone }) {
  return (
    <Box
      sx={{
        display: 'flex', flexDirection: 'column', gap: '2px', p: '8px 10px', minWidth: 0,
        borderRadius: '10px', background: 'var(--inset)', border: '1px solid var(--line)',
      }}
    >
      <Typography sx={{ fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </Typography>
      <Typography
        sx={{ fontSize: 15, fontWeight: 700, color: tone || 'var(--text)', fontFamily: 'var(--font-mono)', lineHeight: 1.25 }}
      >
        {value}
      </Typography>
      {sub ? <Typography sx={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>{sub}</Typography> : null}
    </Box>
  );
}

/** Hawk-Eye style pitch map: striker's stumps at the top, bowler at the bottom, seen from behind the bowler,
 *  +x (off side for a RHB) on the right. */
function PitchTopView({ pre, post, bounce, swingMm, swingSignificant, lateralMeasurable }) {
  const W = 120;
  const H = 300;
  const padY = 14;
  const sx = (x) => W / 2 + (x / HALF_PITCH_W) * (W / 2 - 8);
  const sy = (y) => padY + ((STUMP_Y - y) / (2 * STUMP_Y)) * (H - 2 * padY);
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  // Measured swing drawn as a bend of the pre-bounce path (exaggerated x4 so a few cm are visible).
  let swingPath = null;
  if (swingSignificant && lateralMeasurable && pre.length >= 2 && num(swingMm) !== null) {
    const a = pre[0];
    const b = pre[pre.length - 1];
    const dev = (swingMm / 1000) * 4;
    const n = 24;
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const u = i / n;
      // straight launch line + quadratic sideways drift reaching `dev` at the bounce,
      // re-anchored so the curve ends at the measured bounce point
      const x = a.x + (b.x - a.x - dev) * u + dev * u * u;
      const y = a.y + (b.y - a.y) * u;
      pts.push({ x, y });
    }
    swingPath = line(pts);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      role="img"
      aria-label="Top view of the delivery path on the pitch"
      style={{ display: 'block', maxHeight: 300 }}
    >
      <rect x={4} y={4} width={W - 8} height={H - 8} rx={8} fill="rgba(194,166,110,.16)" stroke="var(--line)" />
      {/* creases and stumps */}
      {[-CREASE_Y, CREASE_Y].map((y) => (
        <line key={y} x1={8} x2={W - 8} y1={sy(y)} y2={sy(y)} stroke="var(--muted)" strokeOpacity={0.45} strokeWidth={1} />
      ))}
      {[-STUMP_Y, STUMP_Y].map((y) => (
        <rect key={y} x={sx(-0.114)} y={sy(y) - 2} width={sx(0.114) - sx(-0.114)} height={4} rx={1} fill="var(--text)" opacity={0.8} />
      ))}
      <line x1={W / 2} x2={W / 2} y1={sy(-STUMP_Y)} y2={sy(STUMP_Y)} stroke="var(--line)" strokeDasharray="3 4" />
      <text x={W - 10} y={sy(0) + 3} textAnchor="end" fontSize={8} fill="var(--muted)">OFF</text>
      <text x={10} y={sy(0) + 3} fontSize={8} fill="var(--muted)">LEG</text>
      <text x={W / 2} y={sy(STUMP_Y) + 13} textAnchor="middle" fontSize={7} fill="var(--muted)">STRIKER</text>
      <text x={W / 2} y={sy(-STUMP_Y) - 7} textAnchor="middle" fontSize={7} fill="var(--muted)">BOWLER</text>
      {/* paths */}
      {pre.length >= 2 ? (
        <path d={line(pre)} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinecap="round"
          strokeOpacity={swingPath ? 0.35 : 1} />
      ) : null}
      {swingPath ? <path d={swingPath} fill="none" stroke="var(--accent)" strokeWidth={2.4} strokeLinecap="round" /> : null}
      {post.length >= 2 ? (
        <path d={line(post)} fill="none" stroke="var(--good)" strokeWidth={2.2} strokeLinecap="round" />
      ) : null}
      {bounce ? (
        <g>
          <circle cx={sx(bounce.x)} cy={sy(bounce.y)} r={5} fill="none" stroke="var(--warn, #f5b942)" strokeWidth={1.6} />
          <circle cx={sx(bounce.x)} cy={sy(bounce.y)} r={2} fill="var(--warn, #f5b942)" />
        </g>
      ) : null}
    </svg>
  );
}

export default function SwingAnalysisCard({ trajectory }) {
  const data = useMemo(() => {
    if (!trajectory) return null;
    const all = usablePoints(trajectory.points);
    if (all.length < 2) return null;
    let pre = usablePoints(trajectory.pre_bounce_points);
    let post = usablePoints(trajectory.post_bounce_points);
    if (!pre.length && !post.length) {
      pre = all.filter((p) => p.phase !== 'post_bounce');
      post = all.filter((p) => p.phase === 'post_bounce' || p.phase === 'bounce');
    }
    const b = trajectory.bounce_point;
    const bounce = b && num(b.x) !== null && num(b.y) !== null ? { x: b.x, y: b.y } : null;
    if (bounce && pre.length && post.length) {
      // join the two segments at the bounce for a continuous drawing
      pre = [...pre, bounce];
      post = [bounce, ...post];
    }
    return { pre, post, bounce, sa: trajectory.swing_analysis || null };
  }, [trajectory]);

  if (!data) return null;
  const { pre, post, bounce, sa } = data;

  if (!sa) {
    // Simulation presets have no reconstruction to measure; older stored analyses predate the classifier
    // (their air_swing_mm / pitch_deviation_deg used another sign convention, so they are never shown here).
    if (!trajectory.reconstruction_method) return null;
    return (
      <Box sx={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '14px', p: '10px 14px' }}>
        <Typography sx={{ fontSize: 12.5, color: 'var(--muted)' }}>
          Swing &amp; delivery classifier: reprocess this clip to measure swing and seam.
        </Typography>
      </Box>
    );
  }

  const speed = num(sa.release_speed_kmh) ?? num(trajectory.release_speed_kmh);
  const swingMm = num(sa.air_swing_mm) ?? 0;
  const seamDeg = num(sa.seam_deviation_deg) ?? 0;
  const lateral = sa.lateral_measurable !== false;
  const kind = sa.movement_kind || 'seam';
  const name = sa.delivery_name || trajectory.delivery_name || 'Delivery';
  const pace = sa.pace_category || null;
  const length = sa.length_zone || trajectory.length_zone || '—';
  const dist = bounce ? STUMP_Y - bounce.y : num(sa.bounce_distance_from_stumps_m);

  const swingValue = lateral ? `${swingMm > 0 ? '+' : ''}${Math.round(swingMm)} mm` : 'n/a';
  const swingSub = lateral
    ? `${directionWord(sa.swing_direction, kind)}${num(sa.air_swing_sigma_mm) ? ` · ±${Math.round(sa.air_swing_sigma_mm)} mm` : ''}`
    : 'Side-on view: line not measurable';
  const seamValue = lateral && bounce ? `${seamDeg > 0 ? '+' : ''}${seamDeg.toFixed(1)}°` : 'n/a';
  const seamSub = !bounce
    ? 'No bounce (full toss)'
    : lateral
      ? directionWord(sa.seam_direction, kind)
      : 'Side-on view: line not measurable';

  return (
    <Box
      sx={{
        background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '14px', p: '14px', display: 'flex',
        flexDirection: 'column', gap: '10px', minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600 }}>
          Swing &amp; delivery classifier
        </Typography>
        <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {pace ? (
            <Chip size="small" label={pace}
              sx={{ height: 22, fontSize: 11, color: 'var(--accent)', border: '1px solid var(--accent)', background: 'transparent' }} />
          ) : null}
          {speed !== null ? (
            <Chip size="small" label={`${speed.toFixed(0)} km/h`}
              sx={{ height: 22, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text)', background: 'var(--inset)', border: '1px solid var(--line)' }} />
          ) : null}
        </Box>
      </Box>

      <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>{name}</Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 96px', gap: '12px', alignItems: 'stretch' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', alignContent: 'start' }}>
          <Stat label="Air swing" value={swingValue} sub={swingSub}
            tone={lateral && sa.air_swing_significant ? 'var(--accent)' : undefined} />
          <Stat label={kind === 'spin' ? 'Turn off pitch' : 'Seam movement'} value={seamValue} sub={seamSub}
            tone={lateral && sa.seam_significant ? 'var(--good)' : undefined} />
          <Stat label="Length" value={length} sub={dist !== null ? `${dist.toFixed(1)} m from stumps` : 'Did not bounce'} />
          <Stat label="Bowler type" value={sa.bowler_type === 'spin' ? 'Spin / slow' : 'Pace'}
            sub={`${sa.bowler_arm || 'Right-Arm'} to ${sa.batter_stance || 'RHB'}`} />
        </Box>
        <Box sx={{ background: 'var(--inset)', border: '1px solid var(--line)', borderRadius: '10px', p: '4px', minHeight: 0 }}>
          <PitchTopView pre={pre} post={post} bounce={bounce} swingMm={swingMm}
            swingSignificant={Boolean(sa.air_swing_significant)} lateralMeasurable={lateral} />
        </Box>
      </Box>

      {sa.explanation ? (
        <Typography sx={{ fontSize: 12.5, color: 'var(--text-2, var(--muted))', lineHeight: 1.5 }}>{sa.explanation}</Typography>
      ) : null}
      <Typography sx={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4 }}>
        Signs: + = towards the off side of a right-hander (away), − = towards leg (in). Swing is the sideways drift at the
        bounce from the line the ball was launched on; the diagram exaggerates it ×4.
      </Typography>
    </Box>
  );
}
