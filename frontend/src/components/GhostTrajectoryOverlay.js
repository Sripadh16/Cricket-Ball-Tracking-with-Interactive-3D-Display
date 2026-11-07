import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Typography, Chip, Tooltip, IconButton, Paper, Collapse } from '@mui/material';
import { CompareArrows, ExpandMore, ExpandLess } from '@mui/icons-material';
import * as THREE from 'three';

// Standard Cricket Pitch Constants (meters)
const PITCH_LENGTH = 20.12;
const STUMP_Y = PITCH_LENGTH / 2;     // +10.06m (Batsman stumps)
const BALL_RADIUS = 0.036;
const GRAVITY = 9.81;

// Preset Ghost Deliveries for Side-by-Side Comparison
export const GHOST_PRESETS = [
  {
    id: 'outswinger',
    name: 'Outswinger (Away Swinger)',
    bowler_type: 'Right-Arm Fast (140 km/h)',
    color: '#00f5ff',
    wireColor: '#a855f7',
    desc: 'Late away drift swinging past off stump to slips',
    release_speed_kmh: 140.0,
    release_pos: [0.25, -9.5, 2.05],
    pitch_target: [0.24, 4.7],
    swing_accel: 0.14,
    seam_deviation_x: 0.026,
    restitution: 0.46,
    has_pad_impact: false,
    impact_y: 10.06
  },
  {
    id: 'inswinger',
    name: 'Fast Inswinger',
    bowler_type: 'Right-Arm Fast (142 km/h)',
    color: '#38bdf8',
    wireColor: '#ec4899',
    desc: 'Vicious inward curve attacking pads & stumps',
    release_speed_kmh: 142.0,
    release_pos: [0.25, -9.5, 2.05],
    pitch_target: [0.06, 4.8],
    swing_accel: -0.12,
    seam_deviation_x: -0.015,
    restitution: 0.45,
    has_pad_impact: true,
    impact_y: 8.8
  },
  {
    id: 'googly',
    name: "Googly / Wrong'un",
    bowler_type: 'Right-Arm Wrist Spin (86 km/h)',
    color: '#d946ef',
    wireColor: '#06b6d4',
    desc: 'Deceptive wrist spin turning sharply in towards off-middle',
    release_speed_kmh: 86.0,
    release_pos: [0.35, -9.0, 1.95],
    pitch_target: [0.22, 5.0],
    swing_accel: -0.06,
    seam_deviation_x: -0.22,
    restitution: 0.50,
    has_pad_impact: true,
    impact_y: 8.85
  },
  {
    id: 'leg_break',
    name: 'Leg Break (Big Turn)',
    bowler_type: 'Right-Arm Leg Spin (88 km/h)',
    color: '#a855f7',
    wireColor: '#38bdf8',
    desc: 'Classic leg spinner drifting in then biting away',
    release_speed_kmh: 88.0,
    release_pos: [0.35, -9.0, 1.95],
    pitch_target: [-0.04, 5.0],
    swing_accel: 0.15,
    seam_deviation_x: 0.24,
    restitution: 0.52,
    has_pad_impact: true,
    impact_y: 8.9
  },
  {
    id: 'off_cutter',
    name: 'Good Length Off-Cutter',
    bowler_type: 'Fast-Medium Cutter (130 km/h)',
    color: '#818cf8',
    wireColor: '#f59e0b',
    desc: 'Finger-rolled delivery cutting back into the batsman',
    release_speed_kmh: 130.0,
    release_pos: [0.45, -9.5, 2.15],
    pitch_target: [0.20, 4.3],
    swing_accel: -0.08,
    seam_deviation_x: -0.018,
    restitution: 0.44,
    has_pad_impact: false,
    impact_y: 10.06
  },
  {
    id: 'sharp_bouncer',
    name: 'Sharp Express Bouncer',
    bowler_type: 'Express Pace (148 km/h)',
    color: '#ec4899',
    wireColor: '#00f5ff',
    desc: 'Hostile short-pitch delivery rising over stumps',
    release_speed_kmh: 148.0,
    release_pos: [0.40, -9.5, 2.25],
    pitch_target: [0.02, -1.5],
    swing_accel: 0.04,
    seam_deviation_x: 0.04,
    restitution: 0.68,
    has_pad_impact: true,
    impact_y: 8.6
  },
  {
    id: 'reverse_yorker',
    name: 'Late Reverse Yorker',
    bowler_type: 'Death Specialist (145 km/h)',
    color: '#06b6d4',
    wireColor: '#ec4899',
    desc: 'Toe-crushing late tailing yorker at base of stumps',
    release_speed_kmh: 145.0,
    release_pos: [0.20, -9.5, 1.95],
    pitch_target: [0.02, 8.5],
    swing_accel: -0.16,
    seam_deviation_x: -0.01,
    restitution: 0.35,
    has_pad_impact: true,
    impact_y: 8.9
  }
];

// Physical Trajectory Simulator for Ghost Deliveries
export function simulateGhostTrajectory(presetId = 'outswinger') {
  const preset = GHOST_PRESETS.find(p => p.id === presetId) || GHOST_PRESETS[0];
  const fps = 60.0;
  const dt = 1.0 / fps;
  const speed_ms = preset.release_speed_kmh / 3.6;
  const [x0, y0, z0] = preset.release_pos;
  const [pitch_x, pitch_y] = preset.pitch_target;

  const vy0 = speed_ms * 0.98;
  const time_to_pitch = (pitch_y - y0) / vy0;
  const vz0 = (0.5 * GRAVITY * (time_to_pitch ** 2) - z0) / time_to_pitch;
  const vx0 = (pitch_x - x0 - 0.5 * preset.swing_accel * (time_to_pitch ** 2)) / time_to_pitch;

  const points = [];
  const pre_bounce_points = [];
  const post_bounce_points = [];
  const extrapolated_points = [];

  let t = 0.0;
  let x = x0, y = y0, z = z0;
  let vx = vx0, vy = vy0, vz = vz0;

  // 1. Pre-Bounce Arc
  while (y < pitch_y && z > 0.036) {
    const pt = {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      z: Number(z.toFixed(4)),
      t: Number(t.toFixed(4)),
      speed_kmh: Number((Math.sqrt(vx * vx + vy * vy + vz * vz) * 3.6).toFixed(1)),
      phase: 'pre_bounce'
    };
    points.push(pt);
    pre_bounce_points.push(pt);

    vx += preset.swing_accel * dt;
    vz -= GRAVITY * dt;
    vy -= 0.12 * vy * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    t += dt;
  }

  const bounce_point = {
    x: Number(x.toFixed(4)),
    y: Number(pitch_y.toFixed(4)),
    z: 0.036,
    t: Number(t.toFixed(4)),
    speed_kmh: Number((Math.sqrt(vx * vx + vy * vy + vz * vz) * 3.6).toFixed(1)),
    phase: 'bounce'
  };
  points.push(bounce_point);

  // 2. Bounce Turf Reflection
  vz = Math.abs(vz) * preset.restitution;
  vy = vy * 0.78;
  vx = vx + preset.seam_deviation_x * 1.8;
  z = 0.036;

  // 3. Post-Bounce Arc
  const target_impact_y = preset.has_pad_impact ? preset.impact_y : STUMP_Y;
  let impact_point = null;

  while (y < target_impact_y && z > 0) {
    const pt = {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      z: Number(z.toFixed(4)),
      t: Number(t.toFixed(4)),
      speed_kmh: Number((Math.sqrt(vx * vx + vy * vy + vz * vz) * 3.6).toFixed(1)),
      phase: 'post_bounce'
    };
    points.push(pt);
    post_bounce_points.push(pt);

    vz -= GRAVITY * dt;
    vy -= 0.1 * vy * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    t += dt;
  }

  if (preset.has_pad_impact) {
    impact_point = {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      z: Number(Math.max(0.05, z).toFixed(4)),
      t: Number(t.toFixed(4)),
      speed_kmh: Number((Math.sqrt(vx * vx + vy * vy + vz * vz) * 3.6).toFixed(1)),
      phase: 'impact'
    };
    points.push(impact_point);
  }

  // 4. Extrapolation to Stumps Plane (Y = 10.06m)
  let pred_x = x, pred_y = y, pred_z = z;
  let pred_vx = vx, pred_vy = vy, pred_vz = vz;
  let pred_t = t;

  while (pred_y <= STUMP_Y + 0.3) {
    const pt = {
      x: Number(pred_x.toFixed(4)),
      y: Number(pred_y.toFixed(4)),
      z: Number(Math.max(0.01, pred_z).toFixed(4)),
      t: Number(pred_t.toFixed(4)),
      speed_kmh: Number((Math.sqrt(pred_vx * pred_vx + pred_vy * pred_vy + pred_vz * pred_vz) * 3.6).toFixed(1)),
      phase: 'extrapolated'
    };
    extrapolated_points.push(pt);

    pred_vz -= GRAVITY * dt;
    pred_x += pred_vx * dt;
    pred_y += pred_vy * dt;
    pred_z += pred_vz * dt;
    pred_t += dt;
  }

  let stump_plane_x = pred_x;
  let stump_plane_z = pred_z;
  for (const ep of extrapolated_points) {
    if (ep.y >= STUMP_Y) {
      stump_plane_x = ep.x;
      stump_plane_z = ep.z;
      break;
    }
  }

  return {
    id: preset.id,
    title: preset.name,
    preset,
    points,
    pre_bounce_points,
    post_bounce_points,
    extrapolated_points,
    bounce_point,
    impact_point,
    stump_plane_target: {
      x: Number(stump_plane_x.toFixed(4)),
      y: STUMP_Y,
      z: Number(stump_plane_z.toFixed(4))
    }
  };
}

// Spatial Divergence Calculation Engine
export function calculateDivergence(primaryTrajectory, ghostTrajectory, currentTime = 0) {
  if (!primaryTrajectory || !ghostTrajectory) return null;

  // Extract coordinates normalized to Three.js space:
  // Three.js X = raw x (lateral width)
  // Three.js Y = raw z (height)
  // Three.js Z = raw y (pitch length)
  const getPrimaryBounce = () => {
    const bp = primaryTrajectory.bounce_point;
    if (bp) return { x: bp.x || 0, y: Math.max(0.036, bp.z || 0.036), z: bp.y || 0 };
    return null;
  };

  const getGhostBounce = () => {
    const bp = ghostTrajectory.bounce_point;
    if (bp) return { x: bp.x || 0, y: Math.max(0.036, bp.z || 0.036), z: bp.y || 0 };
    return null;
  };

  const getPrimaryStump = () => {
    const st = primaryTrajectory.stump_plane_target;
    if (st) return { x: st.x || 0, y: Math.max(0.036, st.z || 0.4), z: st.y || STUMP_Y };
    const ep = primaryTrajectory.extrapolated_points;
    if (ep && ep.length > 0) {
      const last = ep[ep.length - 1];
      return { x: last.x || 0, y: Math.max(0.036, last.z || 0.4), z: last.y || STUMP_Y };
    }
    return null;
  };

  const getGhostStump = () => {
    const st = ghostTrajectory.stump_plane_target;
    if (st) return { x: st.x || 0, y: Math.max(0.036, st.z || 0.4), z: st.y || STUMP_Y };
    const ep = ghostTrajectory.extrapolated_points;
    if (ep && ep.length > 0) {
      const last = ep[ep.length - 1];
      return { x: last.x || 0, y: Math.max(0.036, last.z || 0.4), z: last.y || STUMP_Y };
    }
    return null;
  };

  const primBounce = getPrimaryBounce();
  const ghostBounce = getGhostBounce();
  const primStump = getPrimaryStump();
  const ghostStump = getGhostStump();

  // 1. Bounce Divergence (cm)
  let bounceDivergenceCm = null;
  let bounceDeltaXCm = null;
  let bounceDeltaZCm = null;
  if (primBounce && ghostBounce) {
    bounceDeltaXCm = (ghostBounce.x - primBounce.x) * 100;
    bounceDeltaZCm = (ghostBounce.z - primBounce.z) * 100;
    bounceDivergenceCm = Math.sqrt(bounceDeltaXCm ** 2 + bounceDeltaZCm ** 2);
  }

  // 2. Stumps / Crease Divergence (cm)
  let stumpDivergenceCm = null;
  let stumpDeltaXCm = null;
  let stumpDeltaYCm = null;
  let directionText = 'in line';
  if (primStump && ghostStump) {
    stumpDeltaXCm = (ghostStump.x - primStump.x) * 100;
    stumpDeltaYCm = (ghostStump.y - primStump.y) * 100;
    stumpDivergenceCm = Math.sqrt(stumpDeltaXCm ** 2 + stumpDeltaYCm ** 2);

    if (stumpDeltaXCm > 0.5) {
      directionText = `+${stumpDeltaXCm.toFixed(1)} cm outside off`;
    } else if (stumpDeltaXCm < -0.5) {
      directionText = `${stumpDeltaXCm.toFixed(1)} cm down leg`;
    } else {
      directionText = `${stumpDeltaXCm.toFixed(1)} cm in line`;
    }
  }

  // 3. Real-time Ball Separation at currentTime
  const interpolateBall = (pts, t) => {
    if (!pts || pts.length === 0) return null;
    if (pts.length === 1) return pts[0];
    let idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].t <= t) idx = i;
      else break;
    }
    const p1 = pts[idx];
    const p2 = pts[Math.min(idx + 1, pts.length - 1)];
    if (p1 === p2 || p1.t === p2.t) return { x: p1.x, y: p1.z, z: p1.y };
    const factor = Math.max(0, Math.min(1, (t - p1.t) / (p2.t - p1.t)));
    return {
      x: p1.x + (p2.x - p1.x) * factor,
      y: p1.z + (p2.z - p1.z) * factor,
      z: p1.y + (p2.y - p1.y) * factor
    };
  };

  const primBall = interpolateBall(primaryTrajectory.points || [], currentTime);
  const ghostBall = interpolateBall(ghostTrajectory.points || [], currentTime);

  let realtimeSeparationCm = null;
  if (primBall && ghostBall) {
    const dx = (ghostBall.x - primBall.x) * 100;
    const dy = (ghostBall.y - primBall.y) * 100;
    const dz = (ghostBall.z - primBall.z) * 100;
    realtimeSeparationCm = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  return {
    bounceDivergenceCm: bounceDivergenceCm !== null ? Number(bounceDivergenceCm.toFixed(1)) : null,
    bounceDeltaXCm: bounceDeltaXCm !== null ? Number(bounceDeltaXCm.toFixed(1)) : null,
    bounceDeltaZCm: bounceDeltaZCm !== null ? Number(bounceDeltaZCm.toFixed(1)) : null,
    stumpDivergenceCm: stumpDivergenceCm !== null ? Number(stumpDivergenceCm.toFixed(1)) : null,
    stumpDeltaXCm: stumpDeltaXCm !== null ? Number(stumpDeltaXCm.toFixed(1)) : null,
    stumpDeltaYCm: stumpDeltaYCm !== null ? Number(stumpDeltaYCm.toFixed(1)) : null,
    realtimeSeparationCm: realtimeSeparationCm !== null ? Number(realtimeSeparationCm.toFixed(1)) : null,
    directionText,
    primBounce,
    ghostBounce,
    primStump,
    ghostStump,
    primBall,
    ghostBall
  };
}

// ---------------------------------------------------------------------------
// 3D Three.js Ethereal Pulsating Wireframe Tube for Ghost Trajectory
// ---------------------------------------------------------------------------
function PulsatingHoloTube({ points, radius = 0.024 }) {
  const wireMatRef = useRef();
  const innerMatRef = useRef();

  const curve = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    return new THREE.CatmullRomCurve3(vectors);
  }, [points]);

  const geometry = useMemo(() => {
    if (!curve) return null;
    return new THREE.TubeGeometry(curve, Math.max(30, points.length * 3), radius, 10, false);
  }, [curve, points, radius]);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.6);
    const wireOpacity = 0.45 + 0.35 * pulse;
    const innerOpacity = 0.18 + 0.16 * pulse;

    if (wireMatRef.current) {
      wireMatRef.current.opacity = wireOpacity;
      // Oscillate hue subtly between neon cyan and electric purple
      const hue = 0.5 + 0.25 * Math.sin(elapsed * 2.0); // 0.5 = cyan, 0.75 = magenta
      wireMatRef.current.color.setHSL(hue, 1.0, 0.55);
    }
    if (innerMatRef.current) {
      innerMatRef.current.opacity = innerOpacity;
      const hueInner = 0.6 + 0.2 * Math.sin(elapsed * 2.0 + 0.5);
      innerMatRef.current.color.setHSL(hueInner, 0.95, 0.65);
    }
  });

  if (!geometry) return null;

  return (
    <group>
      {/* Outer Ethereal Holographic Wireframe Cage */}
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={wireMatRef}
          color="#00f5ff"
          wireframe
          transparent
          opacity={0.65}
          depthWrite={false}
        />
      </mesh>
      {/* Inner Semi-Transparent Ethereal Glow Core */}
      <mesh geometry={geometry}>
        <meshBasicMaterial
          ref={innerMatRef}
          color="#a855f7"
          transparent
          opacity={0.25}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 3D Ethereal Pulsating Holographic Ghost Ball with Spinning Hologram Rings
// ---------------------------------------------------------------------------
function HolographicGhostBall({ position }) {
  const groupRef = useRef();
  const ringRef1 = useRef();
  const ringRef2 = useRef();
  const sphereMatRef = useRef();

  useFrame(({ clock }, delta) => {
    const elapsed = clock.getElapsedTime();
    if (groupRef.current) {
      groupRef.current.rotation.y += 2.8 * delta;
    }
    if (ringRef1.current) {
      ringRef1.current.rotation.x += 4.5 * delta;
      ringRef1.current.rotation.z += 2.0 * delta;
    }
    if (ringRef2.current) {
      ringRef2.current.rotation.y += 3.8 * delta;
      ringRef2.current.rotation.x -= 2.2 * delta;
    }
    if (sphereMatRef.current) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4.0);
      sphereMatRef.current.opacity = 0.40 + 0.30 * pulse;
      const hue = 0.52 + 0.22 * Math.sin(elapsed * 2.5);
      sphereMatRef.current.color.setHSL(hue, 1.0, 0.6);
    }
  });

  if (!position) return null;

  return (
    <group position={[position.x, position.y, position.z]}>
      {/* Center Holographic Ghost Sphere */}
      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 1.05, 20, 20]} />
        <meshBasicMaterial
          ref={sphereMatRef}
          color="#00f5ff"
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Orbiting Hologram Wireframe Rings */}
      <group ref={groupRef}>
        <mesh ref={ringRef1}>
          <ringGeometry args={[BALL_RADIUS * 1.35, BALL_RADIUS * 1.48, 24]} />
          <meshBasicMaterial
            color="#c084fc"
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh ref={ringRef2} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[BALL_RADIUS * 1.25, BALL_RADIUS * 1.38, 24]} />
          <meshBasicMaterial
            color="#38bdf8"
            transparent
            opacity={0.65}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* Outer Ethereal Halo Aura */}
      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 1.6, 16, 16]} />
        <meshBasicMaterial
          color="#a855f7"
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// 3D Spatial Divergence Connection Lines & Spot Markers
// ---------------------------------------------------------------------------
function DivergenceConnectors({ divergence }) {
  if (!divergence) return null;

  const { primBounce, ghostBounce, primStump, ghostStump } = divergence;

  return (
    <group>
      {/* 1. Bounce Spot Divergence Line on Turf */}
      {primBounce && ghostBounce && (
        <group>
          {/* Dashed connector line between bounce spots */}
          <line>
            <bufferGeometry
              attach="geometry"
              {...new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(primBounce.x, 0.008, primBounce.z),
                new THREE.Vector3(ghostBounce.x, 0.008, ghostBounce.z)
              ])}
            />
            <lineBasicMaterial attach="material" color="#a855f7" linewidth={2} />
          </line>

          {/* Ghost Bounce Target Bullseye */}
          <group position={[ghostBounce.x, 0.006, ghostBounce.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.12, 0.18, 28]} />
              <meshBasicMaterial
                color="#c084fc"
                transparent
                opacity={0.85}
                side={THREE.DoubleSide}
              />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.06, 24]} />
              <meshBasicMaterial color="#00f5ff" transparent opacity={0.9} />
            </mesh>
          </group>
        </group>
      )}

      {/* 2. Stumps Plane Divergence Line */}
      {primStump && ghostStump && (
        <group>
          <line>
            <bufferGeometry
              attach="geometry"
              {...new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(primStump.x, primStump.y, primStump.z),
                new THREE.Vector3(ghostStump.x, ghostStump.y, ghostStump.z)
              ])}
            />
            <lineBasicMaterial attach="material" color="#00f5ff" linewidth={2} />
          </line>

          {/* Ghost Stump Indicator Sphere */}
          <mesh position={[ghostStump.x, ghostStump.y, ghostStump.z]}>
            <sphereGeometry args={[BALL_RADIUS * 0.9, 16, 16]} />
            <meshBasicMaterial
              color="#a855f7"
              transparent
              opacity={0.8}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Master 3D Ghost Overlay Scene Component (rendered inside React Three Fiber Canvas)
// ---------------------------------------------------------------------------
export default function GhostTrajectoryOverlay({
  primaryTrajectory,
  ghostTrajectoryData,
  ghostPreset = 'outswinger',
  currentTime = 0,
  showExtrapolation = true
}) {
  // If ghostTrajectoryData is explicitly passed, use it; otherwise compute from preset
  const ghostData = useMemo(() => {
    if (ghostTrajectoryData) return ghostTrajectoryData;
    if (!ghostPreset || ghostPreset === 'none') return null;
    return simulateGhostTrajectory(ghostPreset);
  }, [ghostTrajectoryData, ghostPreset]);

  // Standardize coordinate conversion into Three.js space
  const { prePoints, postPoints, extPoints, allGhostPoints } = useMemo(() => {
    if (!ghostData) return { prePoints: [], postPoints: [], extPoints: [], allGhostPoints: [] };

    const convert = (p) => {
      if (!p) return null;
      return {
        x: p.x || 0,
        y: Math.max(0.036, (p.z !== undefined ? p.z : 0.1)),
        z: p.y !== undefined ? p.y : 0,
        t: p.t || 0,
        speed_kmh: p.speed_kmh || 135,
        phase: p.phase || 'ghost'
      };
    };

    const pre = (ghostData.pre_bounce_points || []).map(convert).filter(Boolean);
    const post = (ghostData.post_bounce_points || []).map(convert).filter(Boolean);
    const ext = (ghostData.extrapolated_points || []).map(convert).filter(Boolean);
    const all = (ghostData.points || []).map(convert).filter(Boolean);

    return {
      prePoints: pre,
      postPoints: post,
      extPoints: ext,
      allGhostPoints: all
    };
  }, [ghostData]);

  // Interpolate ghost ball position according to currentTime
  const currentGhostBallPos = useMemo(() => {
    if (!allGhostPoints || allGhostPoints.length === 0) return null;
    if (allGhostPoints.length === 1) return allGhostPoints[0];

    let idx = 0;
    for (let i = 0; i < allGhostPoints.length - 1; i++) {
      if (allGhostPoints[i].t <= currentTime) idx = i;
      else break;
    }

    const p1 = allGhostPoints[idx];
    const p2 = allGhostPoints[Math.min(idx + 1, allGhostPoints.length - 1)];
    if (p1 === p2 || p1.t === p2.t) return p1;

    const t = (currentTime - p1.t) / (p2.t - p1.t);
    const clampedT = Math.max(0, Math.min(1, t));

    return {
      x: p1.x + (p2.x - p1.x) * clampedT,
      y: p1.y + (p2.y - p1.y) * clampedT,
      z: p1.z + (p2.z - p1.z) * clampedT
    };
  }, [allGhostPoints, currentTime]);

  // Real-time divergence metrics
  const divergence = useMemo(() => {
    if (!primaryTrajectory || !ghostData) return null;
    return calculateDivergence(primaryTrajectory, ghostData, currentTime);
  }, [primaryTrajectory, ghostData, currentTime]);

  if (!ghostData) return null;

  return (
    <group>
      {/* Pre-Bounce Ethereal Wireframe Arc */}
      {prePoints.length > 1 && (
        <PulsatingHoloTube points={prePoints} radius={0.022} />
      )}

      {/* Post-Bounce Ethereal Wireframe Arc */}
      {postPoints.length > 1 && (
        <PulsatingHoloTube points={postPoints} radius={0.022} />
      )}

      {/* Projected Extrapolation Wireframe Arc */}
      {showExtrapolation && extPoints.length > 1 && (
        <PulsatingHoloTube points={extPoints} radius={0.018} />
      )}

      {/* Floating Holographic Ghost Ball */}
      <HolographicGhostBall position={currentGhostBallPos} />

      {/* Divergence Connectors & Markers */}
      <DivergenceConnectors divergence={divergence} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// HTML Telemetry Pill & Card (rendered in viewer HUD overlay)
// ---------------------------------------------------------------------------
export function GhostDivergencePill({
  primaryTrajectory,
  ghostTrajectoryData,
  ghostPreset = 'outswinger',
  currentTime = 0,
  onClearGhost
}) {
  const [expanded, setExpanded] = React.useState(false);

  const ghostData = useMemo(() => {
    if (ghostTrajectoryData) return ghostTrajectoryData;
    if (!ghostPreset || ghostPreset === 'none') return null;
    return simulateGhostTrajectory(ghostPreset);
  }, [ghostTrajectoryData, ghostPreset]);

  const divergence = useMemo(() => {
    if (!primaryTrajectory || !ghostData) return null;
    return calculateDivergence(primaryTrajectory, ghostData, currentTime);
  }, [primaryTrajectory, ghostData, currentTime]);

  if (!ghostData || !divergence) return null;

  const currentGhostPreset = GHOST_PRESETS.find(p => p.id === ghostPreset) || ghostData.preset;

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'absolute',
        top: 60,
        left: 14,
        zIndex: 12,
        bgcolor: 'rgba(11, 20, 38, 0.92)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(168, 85, 247, 0.45)',
        borderRadius: 2.5,
        p: 1.2,
        minWidth: 280,
        maxWidth: 360,
        boxShadow: '0 8px 32px rgba(0,0,0,0.65), 0 0 18px rgba(168, 85, 247, 0.25)',
        transition: 'all 0.3s ease'
      }}
    >
      {/* Telemetry Pill Main Row */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: '#00f5ff',
              boxShadow: '0 0 8px #00f5ff, 0 0 16px #a855f7',
              animation: 'pulse 1.8s infinite'
            }}
          />
          <Chip
            icon={<CompareArrows sx={{ fontSize: '14px !important', color: '#c084fc !important' }} />}
            label="GHOST TELEMETRY"
            size="small"
            sx={{
              bgcolor: 'rgba(168, 85, 247, 0.2)',
              color: '#e2e8f0',
              fontWeight: 800,
              fontSize: '0.68rem',
              letterSpacing: 0.6,
              border: '1px solid rgba(168, 85, 247, 0.4)'
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={expanded ? "Collapse details" : "Expand divergence breakdown"}>
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              sx={{ color: '#c084fc', p: 0.3 }}
            >
              {expanded ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
            </IconButton>
          </Tooltip>
          {onClearGhost && (
            <Tooltip title="Remove Ghost Overlay">
              <IconButton
                size="small"
                onClick={onClearGhost}
                sx={{ color: '#94a3b8', p: 0.3, '&:hover': { color: '#f87171' } }}
              >
                ×
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Primary Divergence Headline Pill */}
      <Box sx={{
        mt: 0.8,
        p: 0.7,
        borderRadius: 1.5,
        bgcolor: 'rgba(168, 85, 247, 0.12)',
        border: '1px solid rgba(168, 85, 247, 0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.7rem', fontWeight: 600 }}>
          Ghost Divergence:
        </Typography>
        <Typography variant="body2" sx={{
          color: '#00f5ff',
          fontWeight: 800,
          fontSize: '0.82rem',
          textShadow: '0 0 10px rgba(0,245,255,0.5)'
        }}>
          {divergence.directionText}
        </Typography>
      </Box>

      {/* Comparing Subtitle */}
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#cbd5e1', fontSize: '0.68rem' }}>
        Comparing with: <strong style={{ color: '#c084fc' }}>{currentGhostPreset?.name || ghostData.title}</strong>
      </Typography>

      {/* Quick Metrics Bar */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 0.6 }}>
        {divergence.bounceDivergenceCm !== null && (
          <Box>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.62rem', display: 'block' }}>
              Bounce Δ
            </Typography>
            <Typography variant="body2" sx={{ color: '#ffb703', fontWeight: 700, fontSize: '0.72rem' }}>
              {divergence.bounceDivergenceCm} cm
            </Typography>
          </Box>
        )}
        {divergence.stumpDivergenceCm !== null && (
          <Box>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.62rem', display: 'block' }}>
              Stump Plane Δ
            </Typography>
            <Typography variant="body2" sx={{ color: '#ec4899', fontWeight: 700, fontSize: '0.72rem' }}>
              {divergence.stumpDivergenceCm} cm
            </Typography>
          </Box>
        )}
        {divergence.realtimeSeparationCm !== null && (
          <Box>
            <Typography variant="caption" sx={{ color: '#64748b', fontSize: '0.62rem', display: 'block' }}>
              Real-time Sep
            </Typography>
            <Typography variant="body2" sx={{ color: '#38bdf8', fontWeight: 700, fontSize: '0.72rem' }}>
              {divergence.realtimeSeparationCm} cm
            </Typography>
          </Box>
        )}
      </Box>

      {/* Expanded Detailed Divergence Breakdown Card */}
      <Collapse in={expanded}>
        <Box sx={{
          mt: 1,
          pt: 1,
          borderTop: '1px dashed rgba(168, 85, 247, 0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 0.6
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Lateral Shift (Crease/Stumps):
            </Typography>
            <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.68rem' }}>
              {divergence.stumpDeltaXCm > 0 ? `+${divergence.stumpDeltaXCm}` : divergence.stumpDeltaXCm} cm
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Elevation Shift (Stumps Y):
            </Typography>
            <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.68rem' }}>
              {divergence.stumpDeltaYCm > 0 ? `+${divergence.stumpDeltaYCm}` : divergence.stumpDeltaYCm} cm
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Bounce Pitching Shift (Lateral):
            </Typography>
            <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.68rem' }}>
              {divergence.bounceDeltaXCm > 0 ? `+${divergence.bounceDeltaXCm}` : divergence.bounceDeltaXCm} cm
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>
              Bounce Pitching Shift (Length):
            </Typography>
            <Typography variant="caption" sx={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.68rem' }}>
              {divergence.bounceDeltaZCm > 0 ? `+${divergence.bounceDeltaZCm}` : divergence.bounceDeltaZCm} cm
            </Typography>
          </Box>

          {currentGhostPreset?.desc && (
            <Box sx={{ mt: 0.5, p: 0.6, bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.64rem', fontStyle: 'italic' }}>
                {currentGhostPreset.desc}
              </Typography>
            </Box>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
