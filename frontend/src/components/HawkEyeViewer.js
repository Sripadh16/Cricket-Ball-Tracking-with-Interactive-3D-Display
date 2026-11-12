import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  Box, Typography, ToggleButton, ToggleButtonGroup, Chip,
  FormControlLabel, Switch, Paper, Tooltip, IconButton, Button,
  Menu, MenuItem, ListItemIcon, ListItemText, Select, FormControl, useMediaQuery
} from '@mui/material';
import {
  SportsCricket, Palette, Whatshot, WbSunny, LiveTv,
  GraphicEq, AutoAwesome, Close, ExpandMore, AccountTree, Article,
  RestartAlt, FlashOn
} from '@mui/icons-material';
import DecisionFlowHUD from './DecisionFlowHUD';
import * as THREE from 'three';
import { THEME_CONFIGS, getThemeColors } from './ThemeEngine';
import UltraEdgeVisualizer from './UltraEdgeVisualizer';
import BatsmanAvatar from './BatsmanAvatar';
import DynamicStumps from './DynamicStumps';
import GhostTrajectoryOverlay, { GhostDivergencePill, GHOST_PRESETS } from './GhostTrajectoryOverlay';
import CinematicCameraController from './CinematicCameraController';
import { prepareTrajectory, sampleTrajectoryAtTime } from '../utils/trajectory';
import PhysicsVectorArrows, { PhysicsTelemetryBadge } from './PhysicsVectorsHUD';

// Standard Cricket Pitch Dimensions (meters)
const PITCH_LENGTH = 20.12;  // 22 yards
const PITCH_WIDTH = 3.05;    // 10 feet
const STUMP_HEIGHT = 0.711;  // 28 inches
const STUMP_WIDTH = 0.2286;  // 9 inches
const BALL_RADIUS = 0.036;

// 3D Stumps & Bails component with Theme-aware Materials
function Stumps({ position, isTargetEnd = false, hitStump = 'None', theme }) {
  const stumpSpacing = 0.0953; // 5.7cm apart
  const stumps = [
    { name: 'Leg Stump', x: -stumpSpacing },
    { name: 'Middle Stump', x: 0 },
    { name: 'Off Stump', x: stumpSpacing }
  ];

  const themeStumps = theme?.stumps || THEME_CONFIGS.broadcast.stumps;

  return (
    <group position={position}>
      {stumps.map((s, idx) => {
        const isHit = isTargetEnd && hitStump.includes(s.name.split(' ')[0]);
        return (
          <mesh key={idx} position={[s.x, STUMP_HEIGHT / 2, 0]} castShadow>
            <cylinderGeometry args={[0.019, 0.019, STUMP_HEIGHT, 16]} />
            <meshStandardMaterial
              color={isHit ? '#ff1744' : themeStumps.color}
              roughness={0.3}
              metalness={0.15}
              emissive={isHit ? '#ff1744' : themeStumps.emissive}
              emissiveIntensity={isHit ? 0.8 : themeStumps.emissiveIntensity}
            />
          </mesh>
        );
      })}

      {/* Two Bails */}
      <mesh position={[-0.04765, STUMP_HEIGHT + 0.012, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.0953, 12]} />
        <meshStandardMaterial color={themeStumps.bailsColor} roughness={0.4} />
      </mesh>
      <mesh position={[0.04765, STUMP_HEIGHT + 0.012, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.0953, 12]} />
        <meshStandardMaterial color={themeStumps.bailsColor} roughness={0.4} />
      </mesh>
    </group>
  );
}

// Detailed Cricket Pitch with Crease Markings, Grid Overlay & Optional Length Zones
function CricketPitch({ showZones = false, theme, pitchType }) {
  const halfPitch = PITCH_LENGTH / 2;
  const poppingCreaseDist = 1.22; // 1.22m in front of bowling crease

  const base = theme?.pitch || THEME_CONFIGS.broadcast.pitch;
  const surface = { standard_hard: '#b89769', green_seamer: '#72905a', dry_dusty: '#bc9464', damp_clay: '#806750' }[pitchType];
  const pConfig = surface ? { ...base, pitchColor: surface } : base;

  return (
    <group>
      {/* Stadium Outfield Grass / Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow>
        <circleGeometry args={[36, 64]} />
        <meshStandardMaterial color={pConfig.outfieldColor} roughness={0.8} />
      </mesh>

      {/* Cyberpunk / Thermal Stadium Grid Lines Overlay */}
      {pConfig.showGrid && (
        <gridHelper
          args={[72, 72, pConfig.gridColor, pConfig.gridColor]}
          position={[0, -0.012, 0]}
          rotation={[0, 0, 0]}
        >
          <lineBasicMaterial
            attach="material"
            color={pConfig.gridColor}
            transparent
            opacity={pConfig.gridOpacity || 0.35}
          />
        </gridHelper>
      )}

      {/* Boundary Rope */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[34.8, 35.0, 64]} />
        <meshStandardMaterial color={pConfig.boundaryColor} roughness={0.5} />
      </mesh>

      {/* Pitch Turf Surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[PITCH_WIDTH, PITCH_LENGTH + 3.0]} />
        <meshStandardMaterial color={pConfig.pitchColor} roughness={0.9} />
      </mesh>

      {/* Bowling Creases (2.64m wide line passing through stumps) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -halfPitch]}>
        <planeGeometry args={[2.64, 0.06]} />
        <meshBasicMaterial color={pConfig.creaseColor} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, halfPitch]}>
        <planeGeometry args={[2.64, 0.06]} />
        <meshBasicMaterial color={pConfig.creaseColor} />
      </mesh>

      {/* Popping Creases (1.22m in front of stumps, minimum 3.66m long) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -halfPitch + poppingCreaseDist]}>
        <planeGeometry args={[3.2, 0.06]} />
        <meshBasicMaterial color={pConfig.creaseColor} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, halfPitch - poppingCreaseDist]}>
        <planeGeometry args={[3.2, 0.06]} />
        <meshBasicMaterial color={pConfig.creaseColor} />
      </mesh>

      {/* Return Creases (perpendicular side boundaries at bowling crease) */}
      {[-1.32, 1.32].map((x, i) => (
        <React.Fragment key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, -halfPitch + 0.61]}>
            <planeGeometry args={[0.06, 1.8]} />
            <meshBasicMaterial color={pConfig.creaseColor} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, halfPitch - 0.61]}>
            <planeGeometry args={[0.06, 1.8]} />
            <meshBasicMaterial color={pConfig.creaseColor} />
          </mesh>
        </React.Fragment>
      ))}

      {/* Pitch Length Zones Heatmap Overlay (ICG Feature) */}
      {showZones && (
        <group position={[0, 0.003, 0]}>
          {/* Yorker: 0 to 2m from batsman stumps (Z = 8.06 to 10.06) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 9.06]}>
            <planeGeometry args={[PITCH_WIDTH - 0.2, 2.0]} />
            <meshBasicMaterial color="#e63946" transparent opacity={0.25} />
          </mesh>
          {/* Full: 2 to 4m from stumps (Z = 6.06 to 8.06) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 7.06]}>
            <planeGeometry args={[PITCH_WIDTH - 0.2, 2.0]} />
            <meshBasicMaterial color="#f77f00" transparent opacity={0.25} />
          </mesh>
          {/* Good Length: 4 to 7m from stumps (Z = 3.06 to 6.06) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 4.56]}>
            <planeGeometry args={[PITCH_WIDTH - 0.2, 3.0]} />
            <meshBasicMaterial color="#2a9d8f" transparent opacity={0.25} />
          </mesh>
          {/* Short of Length: 7 to 9.5m (Z = 0.56 to 3.06) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 1.81]}>
            <planeGeometry args={[PITCH_WIDTH - 0.2, 2.5]} />
            <meshBasicMaterial color="#e9c46a" transparent opacity={0.25} />
          </mesh>
          {/* Bouncer: >9.5m (Z < 0.56) */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1.0]}>
            <planeGeometry args={[PITCH_WIDTH - 0.2, 3.0]} />
            <meshBasicMaterial color="#457b9d" transparent opacity={0.25} />
          </mesh>
        </group>
      )}

      {/* Bowler End Stumps (Target/Batsman end is handled by DynamicStumps in Scene) */}
      <Stumps position={[0, 0, -halfPitch]} theme={theme} />
    </group>
  );
}

// Glowing CatmullRom Trajectory Ribbon
function TrajectoryTube({ points, color, emissiveColor, radius = 0.022, isDashed = false }) {
  const { solidGeoms, dashedGeoms } = useMemo(() => {
    if (!points || points.length < 2) return { solidGeoms: [], dashedGeoms: [] };

    const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(vectors);
    const totalLength = curve.getLength();

    if (!isDashed) {
      const geom = new THREE.TubeGeometry(
        curve, Math.max(20, points.length * 3), radius, 8, false
      );
      return { solidGeoms: [geom], dashedGeoms: [] };
    }

    const DASH_LENGTH = 0.25;
    const GAP_LENGTH  = 0.15;
    const CYCLE = DASH_LENGTH + GAP_LENGTH;
    const numCycles = Math.ceil(totalLength / CYCLE);
    const geoms = [];

    for (let i = 0; i < numCycles; i++) {
      const tStart = (i * CYCLE) / totalLength;
      const tEnd   = Math.min(1.0, (i * CYCLE + DASH_LENGTH) / totalLength);
      if (tEnd <= tStart) break;

      const steps = Math.max(4, Math.round((tEnd - tStart) * points.length * 3));
      const subPoints = [];
      for (let s = 0; s <= steps; s++) {
        const t = tStart + (tEnd - tStart) * (s / steps);
        subPoints.push(curve.getPoint(t));
      }
      if (subPoints.length < 2) continue;
      const subCurve = new THREE.CatmullRomCurve3(subPoints);
      geoms.push(new THREE.TubeGeometry(subCurve, steps, radius, 8, false));
    }
    return { solidGeoms: [], dashedGeoms: geoms };
  }, [points, radius, isDashed]);

  useEffect(() => () => {
    [...solidGeoms, ...dashedGeoms].forEach(geometry => geometry.dispose());
  }, [solidGeoms, dashedGeoms]);
  if (!solidGeoms.length && !dashedGeoms.length) return null;

  const materialProps = {
    color,
    emissive: emissiveColor || color,
    emissiveIntensity: isDashed ? 0.9 : 0.6,
    roughness: 0.2,
    metalness: 0.8,
    transparent: isDashed,
    opacity: isDashed ? 0.82 : 0.95,
  };

  return (
    <group>
      {solidGeoms.map((geom, i) => (
        <mesh key={i} geometry={geom}>
          <meshStandardMaterial {...materialProps} />
        </mesh>
      ))}
      {dashedGeoms.map((geom, i) => (
        <mesh key={i} geometry={geom}>
          <meshStandardMaterial {...materialProps} />
        </mesh>
      ))}
    </group>
  );
}

// Dust Impact Puff Particle Burst when ball contacts the pitch turf at bounce point
function BounceDustParticles({ bouncePoint, bounceTime = 0.45, currentTime = 0, theme }) {
  // Generate deterministic particle velocities once
  const particles = useMemo(() => {
    const list = [];
    const count = theme?.particles?.burstCount || 36;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.sin(i * 12.3) * 0.4);
      const speed = 0.6 + ((i * 37) % 100) / 100 * 1.5; // 0.6 - 2.1 m/s
      const upSpeed = 0.9 + ((i * 71) % 100) / 100 * 1.6; // 0.9 - 2.5 m/s
      const size = (theme?.particles?.size || 0.03) * (0.7 + ((i * 43) % 100) / 100 * 0.8);
      list.push({ angle, speed, upSpeed, size });
    }
    return list;
  }, [theme]);

  if (!bouncePoint) return null;

  const DUST_DURATION = 0.42;
  const elapsed = currentTime - bounceTime;

  // Active during contact & expansion window
  if (elapsed < 0 || elapsed > DUST_DURATION) return null;

  const progress = elapsed / DUST_DURATION; // 0 to 1
  const opacity = Math.max(0, (1 - progress) * 0.85);
  const dustColor = theme?.particles?.dustColor || '#e9c46a';

  return (
    <group position={[bouncePoint.x, bouncePoint.y, bouncePoint.z]}>
      {/* Shockwave expanding ring on ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[0.04 + progress * 0.4, 0.08 + progress * 0.45, 32]} />
        <meshBasicMaterial
          color={dustColor}
          transparent
          opacity={opacity * 0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Radial Dust Puff / Chalk Particles */}
      {particles.map((p, idx) => {
        // Outward radial dispersion + upward lift with gravity decay
        const r = p.speed * progress;
        const px = Math.cos(p.angle) * r;
        const pz = Math.sin(p.angle) * r;
        const py = Math.max(0.005, p.upSpeed * progress - 0.5 * 9.8 * Math.pow(progress * 0.35, 2));
        const currentScale = p.size * (1 + progress * 2.8);

        return (
          <mesh key={idx} position={[px, py, pz]}>
            <sphereGeometry args={[currentScale, 8, 8]} />
            <meshStandardMaterial
              color={dustColor}
              emissive={dustColor}
              emissiveIntensity={theme?.id === 'thermal' ? 1.5 : 0.4}
              transparent
              opacity={opacity}
              roughness={0.8}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// Comet Speed Tail / Glowing Trajectory Particles following the moving ball
function BallCometTail({ currentBallPos, allPoints, currentTime, theme }) {
  // Sample historical ball positions along the trajectory directly behind currentTime
  const trailSegments = useMemo(() => {
    if (!currentBallPos || !allPoints || allPoints.length < 2) return [];

    const segments = [];
    const NUM_SEGMENTS = 7;
    const TIME_STEP = 0.008; // ~16ms history steps

    for (let s = 1; s <= NUM_SEGMENTS; s++) {
      const pastTime = currentTime - s * TIME_STEP;
      if (pastTime < (allPoints[0].t || 0)) break;

      const interpolated = sampleTrajectoryAtTime(allPoints, pastTime);
      if (!interpolated) continue;

      const fraction = (NUM_SEGMENTS - s) / NUM_SEGMENTS; // 1 at ball, 0 at end of tail
      segments.push({
        position: [interpolated.x, interpolated.y, interpolated.z],
        radius: BALL_RADIUS * (0.2 + fraction * 0.7),
        opacity: Math.pow(fraction, 1.4) * 0.35
      });
    }

    return segments;
  }, [currentBallPos, allPoints, currentTime]);

  if (!trailSegments.length) return null;

  const tailColor = theme?.particles?.tailColor || '#ffffff';
  const glowColor = theme?.ball?.glowColor || '#ff4d6d';

  return (
    <group>
      {trailSegments.map((seg, idx) => (
        <mesh key={idx} position={seg.position}>
          <sphereGeometry args={[seg.radius, 12, 12]} />
          <meshBasicMaterial
            color={idx % 2 === 0 ? tailColor : glowColor}
            transparent
            opacity={seg.opacity}
          />
        </mesh>
      ))}
    </group>
  );
}

// Concentric Animated Halo at Pitch Bounce Spot
function PitchingSpotMarker({ bouncePoint, onSelectPoint, theme }) {
  const ringRef = useRef();

  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1;
      ringRef.current.scale.set(s, s, s);
    }
  });

  if (!bouncePoint) return null;

  const spotColor = theme?.trajectory?.postBounce || '#ffb703';

  return (
    <group position={[bouncePoint.x, 0.005, bouncePoint.z]}>
      {/* Outer pulsing ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.22, 32]} />
        <meshBasicMaterial color={spotColor} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner bullseye spot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.08, 32]} />
        <meshBasicMaterial color={theme?.ball?.color || '#e63946'} />
      </mesh>
      {/* Vertical guide line */}
      <line>
        <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0.45, 0)
        ])} />
        <lineDashedMaterial attach="material" color={spotColor} dashSize={0.05} gapSize={0.03} />
      </line>
      {/* Clickable interactive sensor */}
      <mesh
        position={[0, 0.05, 0]}
        onClick={() => onSelectPoint && onSelectPoint(bouncePoint)}
        visible={false}
      >
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// Glowing Pad Impact Sphere
function ImpactMarker({ impactPoint, onSelectPoint, theme }) {
  if (!impactPoint) return null;

  const impactColor = theme?.trajectory?.extrapolated || '#f72585';

  return (
    <group position={[impactPoint.x, impactPoint.y, impactPoint.z]}>
      {/* Impact glowing sphere */}
      <mesh onClick={() => onSelectPoint && onSelectPoint(impactPoint)}>
        <sphereGeometry args={[0.065, 24, 24]} />
        <meshStandardMaterial
          color={impactColor}
          emissive={impactColor}
          emissiveIntensity={1.0}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Drop line to pitch ground */}
      <line>
        <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, -impactPoint.y, 0)
        ])} />
        <lineBasicMaterial attach="material" color={impactColor} transparent opacity={0.6} />
      </line>
    </group>
  );
}

// Stumps Target Plane & Impact Marker at Y = 10.06m
function StumpsTargetPlane({ target, drsVerdict }) {
  if (!target) return null;

  const isHitting = drsVerdict?.wickets === 'HITTING';
  const isUmpiresCall = drsVerdict?.wickets === "UMPIRE'S CALL";
  const glowColor = isHitting ? '#e63946' : isUmpiresCall ? '#ffb703' : '#2a9d8f';

  return (
    <group position={[0, 0, target.y]}>
      {/* Stumps projected boundary box */}
      <mesh position={[0, STUMP_HEIGHT / 2, 0]}>
        <planeGeometry args={[STUMP_WIDTH + 0.04, STUMP_HEIGHT + 0.06]} />
        <meshBasicMaterial color={glowColor} wireframe transparent opacity={0.5} />
      </mesh>

      {/* Ball arrival position indicator */}
      <mesh position={[target.x, target.z, 0]}>
        <sphereGeometry args={[BALL_RADIUS, 20, 20]} />
        <meshStandardMaterial
          color={glowColor}
          emissive={glowColor}
          emissiveIntensity={0.8}
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
}

// Realistic 3D Batsman Cricket Pads with Cane Bolsters & Dynamic Impact / Thermal Flashing
function BatsmanPads({ impactPoint, currentBallPos, onSelectPoint, theme }) {
  const isImpacted = useMemo(() => {
    if (!impactPoint || !currentBallPos) return false;
    const dz = Math.abs(currentBallPos.z - impactPoint.z);
    const dy = Math.abs(currentBallPos.y - impactPoint.y);
    return Math.abs(currentBallPos.x - impactPoint.x) < 0.08 && dz < 0.08 && dy < 0.08;
  }, [impactPoint, currentBallPos]);

  const stanceZ = impactPoint ? impactPoint.z : 8.84;
  const stanceX = impactPoint ? impactPoint.x * 0.5 : 0.05;

  const padCfg = theme?.pads || THEME_CONFIGS.broadcast.pads;
  const isThermal = theme?.id === 'thermal';

  const renderPad = (padX, padZ, rotationY = 0) => {
    const padHeight = 0.58;
    const padWidth = 0.15;
    const ribs = [-0.042, 0, 0.042];

    const currentEmissive = isImpacted
      ? padCfg.impactEmissive
      : padCfg.emissive;
    const currentIntensity = isImpacted
      ? padCfg.impactIntensity
      : padCfg.emissiveIntensity;

    const ribColor = isImpacted ? padCfg.impactColor : padCfg.ribColor;
    const kneeColor = isImpacted ? padCfg.impactColor : padCfg.kneeColor;

    return (
      <group position={[padX, 0, padZ]} rotation={[0, rotationY, 0]}>
        {/* 3 Vertical Cane Bolsters / Ribs */}
        {ribs.map((rx, idx) => (
          <mesh key={idx} position={[rx, padHeight / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.022, 0.024, padHeight, 16]} />
            <meshStandardMaterial
              color={ribColor}
              roughness={0.4}
              metalness={0.05}
              emissive={currentEmissive}
              emissiveIntensity={currentIntensity}
            />
          </mesh>
        ))}

        {/* Knee Roll Cushion - HotSpot Thermal Zone */}
        <mesh position={[0, padHeight * 0.68, 0.015]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.032, 0.032, padWidth + 0.01, 16]} />
          <meshStandardMaterial
            color={kneeColor}
            roughness={0.4}
            emissive={isThermal && isImpacted ? '#ffffff' : currentEmissive}
            emissiveIntensity={isThermal && isImpacted ? 2.5 : currentIntensity}
          />
        </mesh>

        {/* Top Hat Thigh Guard Extension */}
        <mesh position={[0, padHeight + 0.07, -0.005]} castShadow>
          <boxGeometry args={[padWidth, 0.14, 0.035]} />
          <meshStandardMaterial
            color={isImpacted ? padCfg.impactColor : padCfg.baseColor}
            roughness={0.5}
            emissive={currentEmissive}
            emissiveIntensity={currentIntensity * 0.7}
          />
        </mesh>

        {/* Instep Shoe Arch (Bottom) */}
        <mesh position={[0, 0.035, 0.02]} castShadow>
          <boxGeometry args={[padWidth * 0.9, 0.07, 0.06]} />
          <meshStandardMaterial
            color={isImpacted ? padCfg.impactColor : padCfg.baseColor}
            roughness={0.6}
            emissive={currentEmissive}
            emissiveIntensity={currentIntensity * 0.5}
          />
        </mesh>

        {/* Rear Fastening Straps */}
        {[0.15, 0.35, 0.5].map((sy, sidx) => (
          <mesh key={`strap-${sidx}`} position={[0, sy, -0.028]}>
            <boxGeometry args={[padWidth * 1.05, 0.02, 0.01]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
        ))}
      </group>
    );
  };

  return (
    <group onClick={() => onSelectPoint && impactPoint && onSelectPoint(impactPoint)}>
      {/* Front Pad (leading leg facing bowler) */}
      {renderPad(stanceX - 0.08, stanceZ, -0.08)}

      {/* Back Pad (trailing leg) */}
      {renderPad(stanceX + 0.10, stanceZ + 0.18, 0.05)}

      {/* Interactive sensor hit-box */}
      <mesh position={[stanceX, 0.35, stanceZ + 0.09]} visible={false}>
        <boxGeometry args={[0.45, 0.75, 0.4]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// Moving Cricket Ball with Dynamic Trail Glow & Visible Rotating Seam
function CricketBall({ position, currentTime = 0, showGlow = true, theme }) {
  const meshRef = useRef();

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.x = currentTime * 28.0;
      meshRef.current.rotation.y = currentTime * 10.0;
    }
  });

  if (!position) return null;

  const ballCfg = theme?.ball || THEME_CONFIGS.broadcast.ball;

  return (
    <group position={[position.x, position.y, position.z]}>
      <group ref={meshRef}>
        <mesh castShadow>
          <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
          <meshStandardMaterial
            color={ballCfg.color}
            roughness={0.25}
            metalness={0.15}
            emissive={theme?.id === 'thermal' ? '#ffffff' : ballCfg.color}
            emissiveIntensity={theme?.id === 'thermal' ? 0.9 : 0.1}
          />
        </mesh>
        {/* Prominent White/Colored Raised Seam Line */}
        <mesh rotation={[0, Math.PI / 4, 0]} castShadow>
          <torusGeometry args={[BALL_RADIUS + 0.0012, 0.0028, 8, 36]} />
          <meshStandardMaterial color={ballCfg.seamColor} roughness={0.6} />
        </mesh>
        {/* Seam Stitches Texture Ring */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[BALL_RADIUS * 0.98, BALL_RADIUS + 0.001, 16]} />
          <meshBasicMaterial color={ballCfg.seamColor} transparent opacity={0.35} side={THREE.DoubleSide} />
        </mesh>
      </group>

      {/* Dynamic Aura Glow */}
      {showGlow && (
        <mesh>
          <sphereGeometry args={[BALL_RADIUS * 1.45, 16, 16]} />
          <meshBasicMaterial
            color={ballCfg.glowColor}
            transparent
            opacity={ballCfg.glowIntensity * 0.3}
          />
        </mesh>
      )}
    </group>
  );
}

// Camera Controller Supporting Smooth Orbit and Dynamic Chase Cam
// Main 3D Canvas Scene
function Scene({
  trajectoryData,
  isSimulation,
  reducedMotion,
  isPlaying,
  isSeeking,
  duration,
  currentTime,
  cameraView,
  showExtrapolation,
  showFullPath,
  showZones,
  showForceVectors = true,
  currentTelemetry = null,
  theme,
  ghostPreset = 'none',
  ghostTrajectoryData = null,
  onSelectPoint,
  showAvatar = true,
  stance = 'right_hand',
  batAction = 'auto',
  targetStumpsRef = null,
  shatterTrigger = false,
  onShatter = null,
  onReset = null
}) {
  const {
    preBouncePoints,
    postBouncePoints,
    extrapolatedPoints,
    bouncePoint,
    impactPoint,
    stumpTarget,
    allPoints
  } = useMemo(() => {
    if (!trajectoryData) return { allPoints: [] };

    const convert = (p) => {
      if (!p) return null;
      return {
        x: p.x || 0,
        y: Math.max(0.036, (p.z !== undefined ? p.z : 0.1)),
        z: p.y !== undefined ? p.y : 0,
        t: p.t || 0,
        speed_kmh: p.speed_kmh != null ? p.speed_kmh : null,
        phase: p.phase || 'trajectory'
      };
    };

    if (trajectoryData.pre_bounce_points) {
      const pre = (trajectoryData.pre_bounce_points || []).map(convert);
      const post = (trajectoryData.post_bounce_points || []).map(convert);
      const ext = (trajectoryData.extrapolated_points || []).map(convert);
      const bnc = convert(trajectoryData.bounce_point);
      const imp = convert(trajectoryData.impact_point);
      const all = prepareTrajectory(trajectoryData.points).map(convert);

      return {
        preBouncePoints: pre,
        postBouncePoints: post,
        extrapolatedPoints: ext,
        bouncePoint: bnc,
        impactPoint: imp,
        stumpTarget: trajectoryData.stump_plane_target,
        allPoints: all
      };
    }

    const pts = prepareTrajectory(trajectoryData.points).map(convert);
    if (pts.length === 0) return { allPoints: [] };

    let minZIdx = 0;
    let minZ = Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].y < minZ) {
        minZ = pts[i].y;
        minZIdx = i;
      }
    }

    const pre = pts.slice(0, minZIdx + 1);
    const post = pts.slice(minZIdx);

    return {
      preBouncePoints: pre,
      postBouncePoints: post,
      extrapolatedPoints: [],
      bouncePoint: isSimulation ? pts[minZIdx] : null,
      impactPoint: isSimulation ? pts[pts.length - 1] : null,
      stumpTarget: null,
      allPoints: pts
    };
  }, [trajectoryData, isSimulation]);

  // Interpolate ball position according to current playback time
  const sampledPoints = useMemo(() => prepareTrajectory(allPoints), [allPoints]);
  const currentBallPos = useMemo(() => sampleTrajectoryAtTime(sampledPoints, currentTime), [sampledPoints, currentTime]);

  const lightCfg = theme?.lighting || THEME_CONFIGS.broadcast.lighting;
  const trajCfg = theme?.trajectory || THEME_CONFIGS.broadcast.trajectory;

  // Bounce timestamp for particle puff synchronization
  const bounceTime = useMemo(() => {
    if (bouncePoint?.t) return bouncePoint.t;
    if (preBouncePoints?.length) return preBouncePoints[preBouncePoints.length - 1].t;
    return 0.45;
  }, [bouncePoint, preBouncePoints]);

  return (
    <>
      <ambientLight color={lightCfg.ambient} intensity={lightCfg.ambientIntensity} />
      <directionalLight
        position={[12, 22, 8]}
        color={lightCfg.keyColor}
        intensity={lightCfg.keyIntensity}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-bias={-0.0005}
      />
      <directionalLight
        position={[-10, 15, -12]}
        color={lightCfg.fillColor}
        intensity={lightCfg.fillIntensity}
      />
      <directionalLight
        position={[0, 8, 14]}
        color={lightCfg.rimColor}
        intensity={lightCfg.rimIntensity}
      />

      <CinematicCameraController
        view={reducedMotion && ['bullet_time', 'drone_flythrough', 'chase'].includes(cameraView) ? 'umpire' : cameraView}
        ballPosition={currentBallPos}
        bouncePoint={bouncePoint}
        impactPoint={impactPoint}
        trajectoryPoints={allPoints}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        isSeeking={isSeeking}
      />
      <CricketPitch showZones={showZones} theme={theme} pitchType={trajectoryData?.pitch_type} />

      {/* Multi-Phase Hawk-Eye Trajectory Ribbons */}
      {preBouncePoints && preBouncePoints.length > 1 && (
        <TrajectoryTube
          points={showFullPath ? preBouncePoints : preBouncePoints.filter(point => point.t >= currentTime - 0.3 && point.t <= currentTime)}
          color={trajCfg.preBounce}
          emissiveColor={trajCfg.preBounceEmissive}
          radius={0.024}
        />
      )}

      {postBouncePoints && postBouncePoints.length > 1 && (
        <TrajectoryTube
          points={showFullPath ? postBouncePoints : postBouncePoints.filter(point => point.t >= currentTime - 0.3 && point.t <= currentTime)}
          color={trajCfg.postBounce}
          emissiveColor={trajCfg.postBounceEmissive}
          radius={0.024}
        />
      )}

      {showExtrapolation && extrapolatedPoints && extrapolatedPoints.length > 1 && (
        <TrajectoryTube
          points={extrapolatedPoints}
          color={trajCfg.extrapolated}
          emissiveColor={trajCfg.extrapolatedEmissive}
          radius={0.02}
          isDashed={true}
        />
      )}

      {/* Multi-Trajectory Ghost Overlay (Side-by-side comparison) */}
      {ghostPreset !== 'none' && (
        <GhostTrajectoryOverlay
          reducedMotion={reducedMotion}
          primaryTrajectory={trajectoryData}
          ghostTrajectoryData={ghostTrajectoryData}
          ghostPreset={ghostPreset}
          currentTime={currentTime}
          showExtrapolation={showExtrapolation}
            showFullPath={showFullPath}
        />
      )}

      {/* Dust Impact Puff Particle Burst at Bounce Point */}
      {!reducedMotion && <BounceDustParticles
        bouncePoint={bouncePoint}
        bounceTime={bounceTime}
        currentTime={currentTime}
        theme={theme}
      />}

      {/* Comet Speed Tail / Glowing Trajectory Particles following the Ball */}
      {!reducedMotion && <BallCometTail
        currentBallPos={currentBallPos}
        allPoints={allPoints}
        currentTime={currentTime}
        theme={theme}
      />}

      {/* Smart LED Zing Stumps & Bails at Batsman End (Z = halfPitch = 10.06m) */}
      <DynamicStumps
        ref={targetStumpsRef}
        position={[0, 0, PITCH_LENGTH / 2]}
        isTargetEnd={true}
        hitStump={trajectoryData?.hit_stump || 'None'}
        drsVerdict={trajectoryData?.drs_evaluation}
        currentBallPos={currentBallPos}
        replayTime={currentTime}
        collisionEvent={trajectoryData?.collision_event || null}
        reducedMotion={reducedMotion}
        hasPadInterception={Boolean(trajectoryData?.has_pad_interception)}
        shatterTrigger={shatterTrigger}
        onShatter={onShatter}
        onReset={onReset}
      />

      {/* 3D Batsman Avatar at Popping Crease with Integrated Pads & Willow Bat */}
      {showAvatar ? (
        <BatsmanAvatar
          stance={stance}
          impactPoint={impactPoint}
          currentBallPos={currentBallPos}
          currentTime={currentTime}
          contactTime={impactPoint?.t ?? trajectoryData?.collision_event?.time ?? allPoints?.[allPoints.length - 1]?.t ?? 0}
          autoAction={isSimulation ? (trajectoryData?.event_type === 'not_out_missing' ? 'leave' : 'defend') : 'backlift'}
          reducedMotion={reducedMotion}
          batAction={batAction}
          onSelectPoint={onSelectPoint}
          visible={showAvatar}
        />
      ) : (
        <BatsmanPads
          impactPoint={impactPoint}
          currentBallPos={currentBallPos}
          onSelectPoint={onSelectPoint}
          theme={theme}
        />
      )}

      {/* 3D Event Markers */}
      <PitchingSpotMarker bouncePoint={bouncePoint} onSelectPoint={onSelectPoint} theme={theme} />
      <ImpactMarker impactPoint={impactPoint} onSelectPoint={onSelectPoint} theme={theme} />

      {showExtrapolation && stumpTarget && (
        <StumpsTargetPlane
          target={stumpTarget}
          drsVerdict={trajectoryData?.drs_evaluation}
        />
      )}

      {/* 3D Force Vectors: Velocity, Magnus, Gravity, Spin Axis */}
      <PhysicsVectorArrows replayTime={reducedMotion ? 0 : currentTime}
        ballPosition={currentBallPos}
        telemetry={currentTelemetry}
        visible={showForceVectors}
      />

      {/* Moving 3D Cricket Ball */}
      <CricketBall position={currentBallPos} currentTime={currentTime} theme={theme} />
    </>
  );
}

// Error boundary for WebGL / Canvas failure fallback
class WebGLErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("WebGL / Three.js 3D Viewer error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: '#08121e',
          color: '#cbd5e1',
          p: 3,
          textAlign: 'center'
        }}>
          <Typography variant="h6" sx={{ color: '#f87171', mb: 1, fontWeight: 700 }}>
            3D Graphics Unavailable
          </Typography>
          <Typography variant="body2" sx={{ maxWidth: 420, mb: 2, color: '#94a3b8', fontSize: '0.85rem' }}>
            WebGL context could not be initialized or encountered an error. Please verify hardware acceleration is enabled in your browser settings.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => this.setState({ hasError: false, error: null })}
            sx={{ color: '#38bdf8', borderColor: '#38bdf8' }}
          >
            Retry 3D View
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// Master Interactive 3D Viewer Component with Theme & UltraEdge Support
export default function HawkEyeViewer({
  trajectoryData,
  currentTime = 0,
  duration = 1.5,
  isPlaying = false,
  isSeeking = false,
  sourceAudioUrl = null,
  initialTheme = 'broadcast',
  isSimulation = true,
  ghostTrajectoryData = null,
  initialGhostPreset = 'none',
  onSeek = null,
  onOpenFlowHUD = null,
  onOpenReportCard = null
}) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [cameraView, setCameraView] = useState('side');
  const [ghostPreset, setGhostPreset] = useState(initialGhostPreset);
  const [showExtrapolation, setShowExtrapolation] = useState(isSimulation);
  const [showFullPath, setShowFullPath] = useState(isSimulation);
  const [showZones, setShowZones] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);

  // 3D Aerodynamic Force Vectors & Physics HUD State
  const [showForceVectors, setShowForceVectors] = useState(false);

  // Real-time Physics Telemetry computed for HUD overlay and 3D vector arrows
  const telemetryPoints = useMemo(() => prepareTrajectory(trajectoryData?.points), [trajectoryData]);
  const currentTelemetry = useMemo(() => sampleTrajectoryAtTime(telemetryPoints, currentTime), [telemetryPoints, currentTime]);

  // 3D Batsman Avatar & Dynamic Zing Stumps State
  const [showAvatar, setShowAvatar] = useState(isSimulation);
  const [stance, setStance] = useState('right_hand');
  const [batAction, setBatAction] = useState('auto');
  const targetStumpsRef = useRef(null);
  const [shatterTrigger, setShatterTrigger] = useState(false);
  const [isShattered, setIsShattered] = useState(false);

  const toggleShatterAction = () => {
    if (isShattered) {
      onSeek?.(0);
      if (targetStumpsRef.current) targetStumpsRef.current.reset();
      setIsShattered(false);
      setShatterTrigger(false);
    } else {
      if (targetStumpsRef.current) targetStumpsRef.current.shatter();
      setShatterTrigger(true);
      setIsShattered(true);
    }
  };

  // Visual Theme Engine State
  const [themeName, setThemeName] = useState(initialTheme);
  const [themeAnchorEl, setThemeAnchorEl] = useState(null);

  // UltraEdge Snickometer Drawer Overlay
  const [showUltraEdge, setShowUltraEdge] = useState(false);

  // TV Decision Flowchart In-Viewer Overlay
  const [showFlowHUDOverlay, setShowFlowHUDOverlay] = useState(false);

  const theme = useMemo(() => getThemeColors(themeName), [themeName]);
  const drs = typeof trajectoryData?.drs_evaluation?.decision === 'string' ? trajectoryData.drs_evaluation : null;

  return (
    <Box sx={{
      height: '100%',
      minHeight: 0,
      display: 'grid',
      minWidth: 0,
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: showUltraEdge ? 'minmax(180px, 1fr) minmax(0, 240px) auto' : 'minmax(0, 1fr) auto',
      position: 'relative',
      bgcolor: theme.background,
      overflowX: 'hidden',
      overflowY: showUltraEdge ? 'auto' : 'hidden',
      transition: 'background-color 0.4s ease'
    }}>
      <WebGLErrorBoundary>
        <Canvas
          shadows
          gl={{ preserveDrawingBuffer: true }}
          camera={{ position: [7, 5, 5], fov: 48, near: 0.1, far: 120 }}
        >
          <color attach="background" args={[theme.background]} />
          <fog attach="fog" args={[theme.fog.color, theme.fog.near, theme.fog.far]} />
          <Scene
            trajectoryData={trajectoryData}
            isSimulation={isSimulation}
            reducedMotion={reducedMotion}
            isPlaying={isPlaying}
            isSeeking={isSeeking}
            duration={duration}
            currentTime={currentTime}
            cameraView={cameraView}
            showExtrapolation={showExtrapolation}
            showFullPath={showFullPath}
            showZones={showZones}
            showForceVectors={showForceVectors}
            currentTelemetry={currentTelemetry}
            theme={theme}
            ghostPreset={ghostPreset}
            ghostTrajectoryData={ghostTrajectoryData}
            onSelectPoint={(p) => setSelectedPoint(p)}
            showAvatar={showAvatar}
            stance={stance}
            batAction={batAction}
            targetStumpsRef={targetStumpsRef}
            shatterTrigger={shatterTrigger}
            onShatter={() => setIsShattered(true)}
            onReset={() => { setIsShattered(false); setShatterTrigger(false); }}
          />
        </Canvas>
      </WebGLErrorBoundary>

      {/* Real-time Aerodynamic Force Vectors Telemetry Badge HUD */}
      <PhysicsTelemetryBadge
        telemetry={currentTelemetry}
        visible={showForceVectors}
        pitchType={trajectoryData?.pitch_type}
      />

      {/* Telemetry Pill for Ghost Divergence Comparison */}
      {ghostPreset !== 'none' && (
        <GhostDivergencePill
          primaryTrajectory={trajectoryData}
          ghostTrajectoryData={ghostTrajectoryData}
          ghostPreset={ghostPreset}
          currentTime={currentTime}
          onClearGhost={() => setGhostPreset('none')}
        />
      )}

      {/* Header Overlay: DRS Live Badge & Delivery Type */}
      <Box sx={{
        position: 'absolute',
        top: 14,
        left: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.8,
        pointerEvents: 'none',
        zIndex: 10
      }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip
            icon={<SportsCricket sx={{ fontSize: 16 }} />}
            label={isSimulation ? 'Simulated delivery · 3D' : 'Approximate reconstruction'}
            size="small"
            sx={{
              background: '#202733',
              color: 'white',
              fontWeight: 800,
              fontSize: '0.75rem',
              letterSpacing: 0.8,
              border: `1px solid ${theme.ui.borderColor}`
            }}
          />
          {drs && (
            <Chip
              label={drs.decision}
              size="small"
              sx={{
                bgcolor: drs.decision.includes('OUT') && !drs.decision.includes('NOT')
                  ? 'rgba(239,68,68,0.95)'
                  : drs.decision.includes('UMPIRE')
                  ? 'rgba(245,158,11,0.95)'
                  : 'rgba(34,197,94,0.95)',
                color: 'white',
                fontWeight: 800,
                fontSize: '0.75rem'
              }}
            />
          )}
        </Box>

        {trajectoryData?.title && (
          <Typography variant="caption" sx={{ color: '#e2e8f0', fontWeight: 600, textShadow: '0 2px 4px rgba(0,0,0,0.8)' }}>
            {trajectoryData.title} {trajectoryData.release_speed_kmh ? `• ${trajectoryData.release_speed_kmh} km/h` : ''}
          </Typography>
        )}
      </Box>

      <details className="viewer-tools"><summary>Scene tools</summary><div className="viewer-tools-content">
      {/* Top Right: Theme Switcher & Trajectory Color Legend */}
      <Box sx={{
        position: 'relative',
        top: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 1,
        zIndex: 10
      }}>
        {/* Quick Toolbar: Theme Selector Button & UltraEdge Toggle & Decision Flow */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, alignItems: 'center' }}>
          {/* Decision Flow HUD Button */}
          <Tooltip title="TV 3-Stage Decision Flowchart (Pitching → Impact → Wickets)">
            <Button
              size="small"
              variant={showFlowHUDOverlay ? 'contained' : 'outlined'}
              startIcon={<AccountTree sx={{ fontSize: 15 }} />}
              onClick={() => {
                if (onOpenFlowHUD) {
                  onOpenFlowHUD();
                } else {
                  setShowFlowHUDOverlay(!showFlowHUDOverlay);
                }
              }}
              sx={{
                bgcolor: showFlowHUDOverlay ? 'rgba(56, 189, 248, 0.9)' : 'rgba(10,22,40,0.85)',
                color: showFlowHUDOverlay ? '#020617' : '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backdropFilter: 'blur(8px)',
                fontWeight: 700,
                fontSize: '0.72rem',
                textTransform: 'none',
                py: 0.4,
                px: 1.1,
                borderRadius: 2,
                '&:hover': {
                  bgcolor: showFlowHUDOverlay ? '#38bdf8' : 'rgba(56, 189, 248, 0.15)',
                  borderColor: '#38bdf8'
                }
              }}
            >
              Flow HUD
            </Button>
          </Tooltip>

          {/* Match Report Card Button */}
          {onOpenReportCard && (
            <Tooltip title="Delivery report and reviewer notes">
              <Button
                size="small"
                variant="outlined"
                startIcon={<Article sx={{ fontSize: 15 }} />}
                onClick={onOpenReportCard}
                sx={{
                  bgcolor: 'rgba(10,22,40,0.85)',
                  color: '#4ade80',
                  borderColor: 'rgba(74, 222, 128, 0.4)',
                  backdropFilter: 'blur(8px)',
                  fontWeight: 700,
                  fontSize: '0.72rem',
                  textTransform: 'none',
                  py: 0.4,
                  px: 1.1,
                  borderRadius: 2,
                  '&:hover': {
                    bgcolor: 'rgba(74, 222, 128, 0.15)',
                    borderColor: '#4ade80'
                  }
                }}
              >
                Report
              </Button>
            </Tooltip>
          )}

          <Tooltip title="Toggle Ultra-Edge / Snickometer Soundwave Drawer">
            <Button
              size="small"
              variant={showUltraEdge ? 'contained' : 'outlined'}
              startIcon={<GraphicEq sx={{ fontSize: 16 }} />}
              onClick={() => setShowUltraEdge(!showUltraEdge)}
              sx={{
                bgcolor: showUltraEdge ? 'rgba(56, 189, 248, 0.9)' : 'rgba(10,22,40,0.85)',
                color: showUltraEdge ? '#020617' : '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backdropFilter: 'blur(8px)',
                fontWeight: 700,
                fontSize: '0.72rem',
                textTransform: 'none',
                py: 0.4,
                px: 1.2,
                borderRadius: 2,
                '&:hover': {
                  bgcolor: showUltraEdge ? '#38bdf8' : 'rgba(56, 189, 248, 0.15)',
                  borderColor: '#38bdf8'
                }
              }}
            >
              {isSimulation ? 'UltraEdge demo' : 'Audio inspection'}
            </Button>
          </Tooltip>

          {/* Interactive Shatter / Re-erect Zing Stumps Button */}
          <Tooltip title={isShattered ? "Re-erect Stumps (Reset)" : "Interactive Shatter Stumps & Bails (Physics)"}>
            <Button
              size="small"
              variant={isShattered ? 'contained' : 'outlined'}
              startIcon={isShattered ? <RestartAlt sx={{ fontSize: 15 }} /> : <FlashOn sx={{ fontSize: 15 }} />}
              onClick={toggleShatterAction}
              disabled={!isSimulation}
              sx={{
                bgcolor: isShattered ? 'rgba(239, 68, 68, 0.9)' : 'rgba(10,22,40,0.85)',
                color: isShattered ? '#ffffff' : '#f87171',
                borderColor: isShattered ? '#ef4444' : 'rgba(239, 68, 68, 0.5)',
                backdropFilter: 'blur(8px)',
                fontWeight: 700,
                fontSize: '0.72rem',
                textTransform: 'none',
                py: 0.4,
                px: 1.1,
                borderRadius: 2,
                boxShadow: isShattered ? '0 0 14px rgba(239, 68, 68, 0.65)' : 'none',
                '&:hover': {
                  bgcolor: isShattered ? '#dc2626' : 'rgba(239, 68, 68, 0.2)',
                  borderColor: '#ef4444'
                }
              }}
            >
              {isShattered ? 'Reset Wickets' : 'Shatter Stumps'}
            </Button>
          </Tooltip>

          <Button
            size="small"
            variant="outlined"
            startIcon={<Palette sx={{ fontSize: 16, color: theme.ui.accent }} />}
            endIcon={<ExpandMore sx={{ fontSize: 16 }} />}
            onClick={(e) => setThemeAnchorEl(e.currentTarget)}
            sx={{
              bgcolor: 'rgba(10,22,40,0.85)',
              color: '#e2e8f0',
              borderColor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(8px)',
              fontWeight: 700,
              fontSize: '0.72rem',
              textTransform: 'none',
              py: 0.4,
              px: 1.2,
              borderRadius: 2,
              '&:hover': {
                borderColor: theme.ui.accent,
                bgcolor: 'rgba(255,255,255,0.08)'
              }
            }}
          >
            {theme.label}
          </Button>
        </Box>

        {/* Theme Menu Dropdown */}
        <Menu
          anchorEl={themeAnchorEl}
          open={Boolean(themeAnchorEl)}
          onClose={() => setThemeAnchorEl(null)}
          PaperProps={{
            sx: {
              bgcolor: '#0a1626',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 2,
              minWidth: 190,
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)'
            }
          }}
        >
          <MenuItem
            selected={themeName === 'broadcast'}
            onClick={() => { setThemeName('broadcast'); setThemeAnchorEl(null); }}
          >
            <ListItemIcon><LiveTv sx={{ color: '#22c55e', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Classic Broadcast" secondary="Natural Grass & Sky" secondaryTypographyProps={{ color: '#94a3b8', fontSize: '0.68rem' }} />
          </MenuItem>
          <MenuItem
            selected={themeName === 'cyberpunk'}
            onClick={() => { setThemeName('cyberpunk'); setThemeAnchorEl(null); }}
          >
            <ListItemIcon><AutoAwesome sx={{ color: '#00f0ff', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Cyberpunk Neon" secondary="Grid Turf & Laser Trajectory" secondaryTypographyProps={{ color: '#94a3b8', fontSize: '0.68rem' }} />
          </MenuItem>
          <MenuItem
            selected={themeName === 'golden'}
            onClick={() => { setThemeName('golden'); setThemeAnchorEl(null); }}
          >
            <ListItemIcon><WbSunny sx={{ color: '#f59e0b', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Golden Hour" secondary="Sunset Amber Lighting" secondaryTypographyProps={{ color: '#94a3b8', fontSize: '0.68rem' }} />
          </MenuItem>
          <MenuItem
            selected={themeName === 'thermal'}
            onClick={() => { setThemeName('thermal'); setThemeAnchorEl(null); }}
          >
            <ListItemIcon><Whatshot sx={{ color: '#ff0055', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Thermal HotSpot" secondary="Simulated thermal styling" secondaryTypographyProps={{ color: '#94a3b8', fontSize: '0.68rem' }} />
          </MenuItem>
        </Menu>

        {/* Trajectory Color Legend */}
        <Paper sx={{
          bgcolor: theme.ui.panelBg || 'rgba(10,22,40,0.85)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${theme.ui.borderColor}`,
          borderRadius: 2,
          p: 1.2,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.6
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 14, height: 4, bgcolor: theme.trajectory.preBounce, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Pre-Bounce Arc</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 14, height: 4, bgcolor: theme.trajectory.postBounce, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Post-Bounce Arc</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 14, height: 4, bgcolor: theme.trajectory.extrapolated, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Projected Path</Typography>
          </Box>
          {ghostPreset !== 'none' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ width: 14, height: 4, bgcolor: '#00f5ff', borderRadius: 1, boxShadow: '0 0 6px #a855f7' }} />
              <Typography variant="caption" sx={{ color: '#00f5ff', fontSize: '0.7rem', fontWeight: 700 }}>Ghost Trajectory</Typography>
            </Box>
          )}
        </Paper>
      </Box>

      </div></details>
      {/* Point Inspector Tooltip Card (Pop-up on marker click) */}
      {selectedPoint && (
        <Paper sx={{
          position: 'absolute',
          top: 130,
          right: 14,
          bgcolor: 'rgba(15,23,42,0.92)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${theme.ui.accent}`,
          borderRadius: 2,
          p: 1.5,
          minWidth: 180,
          color: 'white',
          zIndex: 10
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: theme.ui.accent, textTransform: 'uppercase' }}>
              Point Telemetry
            </Typography>
            <IconButton aria-label="Close point telemetry" size="small" onClick={() => setSelectedPoint(null)} sx={{ color: '#94a3b8', p: 0.2 }}>
              <Close sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Phase: <strong>{selectedPoint.phase || 'Trajectory'}</strong>
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Pitch X: <strong>{selectedPoint.x?.toFixed(2)} m</strong>
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Pitch Z (Dist): <strong>{selectedPoint.z?.toFixed(2)} m</strong>
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Height (Y): <strong>{selectedPoint.y?.toFixed(2)} m</strong>
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
            Speed: {selectedPoint.speed_kmh != null ? (
              <strong style={{ color: '#4ade80' }}>{selectedPoint.speed_kmh} km/h</strong>
            ) : (
              <span style={{ color: '#94a3b8' }}>— (Uncalibrated)</span>
            )}
          </Typography>
        </Paper>
      )}

      {/* UltraEdge Drawer Overlay (Docked directly above controls when toggled) */}
      {showUltraEdge && (
        <Box sx={{
          position: 'relative',
          gridColumn: '1 / -1',
          width: '100%',
          minWidth: 0,
          maxHeight: 240,
          overflowX: 'hidden',
          overflowY: 'auto',
          maxWidth: 720,
          zIndex: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.85)'
        }}>
          <UltraEdgeVisualizer
            currentTime={currentTime}
            duration={trajectoryData?.video_duration || duration || 1.5}
            trajectoryData={trajectoryData}
            isPlaying={isPlaying}
            isSeeking={isSeeking}
            sourceAudioUrl={sourceAudioUrl}
            isSimulation={isSimulation}
            onSeek={onSeek}
            compact={true}
          />
        </Box>
      )}

      {/* In-Viewer TV Decision Flowchart HUD Overlay */}
      {showFlowHUDOverlay && (
        <Box sx={{
          position: 'absolute',
          top: 60,
          left: '50%',
          transform: 'translateX(-50%)',
          width: { xs: '96%', sm: '90%', md: '80%' },
          maxWidth: 820,
          zIndex: 30,
          boxShadow: '0 20px 60px rgba(0,0,0,0.9)'
        }}>
          <DecisionFlowHUD
            isOverlay={true}
            trajectoryData={trajectoryData}
            autoPlaySequence={true}
            onClose={() => setShowFlowHUDOverlay(false)}
          />
        </Box>
      )}

      {/* Bottom Center: Interactive Camera Switcher & Toggles */}
      <Box className="viewer-camera-bar" sx={{
        position: 'relative',
        bottom: 'auto',
        left: 'auto',
        transform: 'none',
        maxWidth: '100%',
        width: '100%',
        bgcolor: theme.ui.panelBg || 'rgba(10,22,40,0.88)',
        borderTop: '1px solid',
        borderColor: 'divider',
        borderRadius: 0,
        p: 0.8,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        zIndex: 10
      }}>
        <ToggleButtonGroup size="small" aria-label="Camera angle" value={cameraView} exclusive onChange={(_, value) => value && setCameraView(value)}>
          <ToggleButton value="umpire">Umpire</ToggleButton>
          <ToggleButton value="side">Side</ToggleButton>
          <ToggleButton value="aerial">Top</ToggleButton>
          <ToggleButton value="orbit">Orbit</ToggleButton>
        </ToggleButtonGroup>
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <Select value={['umpire', 'side', 'aerial', 'orbit'].includes(cameraView) ? '' : cameraView}
            displayEmpty inputProps={{ 'aria-label': 'More camera angles' }} onChange={event => setCameraView(event.target.value)}>
            <MenuItem value="" disabled>More cameras</MenuItem>
            <MenuItem value="chase">Chase Cam</MenuItem><MenuItem value="batsman">Batsman POV</MenuItem>
            <MenuItem value="bowler">Bowler</MenuItem><MenuItem value="impact">Impact Zoom</MenuItem>
            <MenuItem value="bullet_time">Bullet Time</MenuItem><MenuItem value="drone_flythrough">Drone Cam</MenuItem>
          </Select>
        </FormControl>
        <details className="scene-options"><summary>Layers, comparison & avatar</summary><div className="scene-options-content">
        <FormControlLabel control={<Switch checked={showFullPath} onChange={event => setShowFullPath(event.target.checked)} />} label="Full trajectory" />
        {/* Ghost Delivery Selection Dropdown */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, borderLeft: '1px solid rgba(255,255,255,0.2)', pl: 1 }}>
          <Tooltip title="Compare delivery side-by-side with an ethereal Ghost Trajectory (e.g. Inswinger vs Outswinger, Leg-break vs Googly)">
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                inputProps={{ "aria-label": "Compare with ghost delivery" }}
                value={ghostPreset}
                onChange={(e) => setGhostPreset(e.target.value)}
                displayEmpty
                size="small"
                sx={{
                  color: '#e2e8f0',
                  bgcolor: ghostPreset !== 'none' ? 'rgba(168,85,247,0.22)' : 'rgba(255,255,255,0.06)',
                  fontSize: '0.70rem',
                  fontWeight: 700,
                  height: 30,
                  borderRadius: 2,
                  border: ghostPreset !== 'none' ? '1px solid rgba(168,85,247,0.6)' : '1px solid rgba(255,255,255,0.15)',
                  '& .MuiSelect-select': { py: 0.4, px: 1, display: 'flex', alignItems: 'center', gap: 0.6 },
                  '& .MuiSvgIcon-root': { color: '#c084fc', fontSize: 17 }
                }}
              >
                <MenuItem value="none" sx={{ fontSize: '0.72rem' }}>
                  <em>Ghost: None</em>
                </MenuItem>
                {GHOST_PRESETS.map((p) => (
                  <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.72rem' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color }} />
                      <span>{p.name}</span>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Tooltip>
        </Box>

        {/* Feature Switches */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, borderLeft: '1px solid rgba(255,255,255,0.2)', pl: 1 }}>
          <Tooltip title="Toggle Extrapolated Path">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showExtrapolation}
                  onChange={(e) => setShowExtrapolation(e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: theme.trajectory.extrapolated } }}
                />
              }
              label={<Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.68rem' }}>Predict</Typography>}
              sx={{ m: 0 }}
            />
          </Tooltip>

          {/* 3D Force Vectors: ON/OFF */}
          <Tooltip title="Toggle 3D Force Vectors (Cyan Velocity, Neon Pink Magnus, Yellow Gravity, White Spin Axis)">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showForceVectors}
                  onChange={(e) => setShowForceVectors(e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#00e5ff' } }}
                />
              }
              label={<Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.68rem' }}>Vectors</Typography>}
              sx={{ m: 0 }}
            />
          </Tooltip>

          <Tooltip title="Toggle Pitch Length Zones (Yorker, Full, Good Length, Bouncer)">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showZones}
                  onChange={(e) => setShowZones(e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#2a9d8f' } }}
                />
              }
              label={<Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.68rem' }}>Zones</Typography>}
              sx={{ m: 0 }}
            />
          </Tooltip>

          {/* 3D Batsman Avatar Switch */}
          <Tooltip title="Toggle Procedural 3D Batsman Avatar (Helmet, Team Jersey, Willow Bat & Gloves)">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showAvatar}
                  onChange={(e) => setShowAvatar(e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#38bdf8' } }}
                />
              }
              label={<Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.68rem' }}>Avatar</Typography>}
              sx={{ m: 0 }}
            />
          </Tooltip>

          {/* Batsman Stance Toggle (Right Hand vs Left Hand) */}
          {showAvatar && (
            <Tooltip title="Batsman Stance: Right-Hand (RHB) or Left-Hand (LHB)">
              <ToggleButtonGroup
                size="small"
                value={stance}
                exclusive
                onChange={(_, v) => v && setStance(v)}
                sx={{
                  height: 24,
                  '& .MuiToggleButton-root': {
                    color: '#cbd5e1',
                    borderColor: 'rgba(255,255,255,0.15)',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    px: 0.8,
                    py: 0,
                    textTransform: 'none'
                  },
                  '& .Mui-selected': {
                    bgcolor: 'rgba(56, 189, 248, 0.85) !important',
                    color: '#020617 !important'
                  }
                }}
              >
                <ToggleButton value="right_hand">RHB</ToggleButton>
                <ToggleButton value="left_hand">LHB</ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
          )}

          {/* Bat Action / Stroke Mode Selector */}
          {showAvatar && (
            <Tooltip title="Bat Kinematics: Auto Stroke on Crease Arrival, Forward Defend, Drive, or Leave">
              <ToggleButtonGroup
                size="small"
                value={batAction}
                exclusive
                onChange={(_, v) => v && setBatAction(v)}
                sx={{
                  height: 24,
                  '& .MuiToggleButton-root': {
                    color: '#cbd5e1',
                    borderColor: 'rgba(255,255,255,0.15)',
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    px: 0.7,
                    py: 0,
                    textTransform: 'none'
                  },
                  '& .Mui-selected': {
                    bgcolor: 'rgba(245, 158, 11, 0.85) !important',
                    color: '#020617 !important'
                  }
                }}
              >
                <ToggleButton value="auto">Auto</ToggleButton>
                <ToggleButton value="defend">Defend</ToggleButton>
                <ToggleButton value="drive">Drive</ToggleButton>
                <ToggleButton value="leave">Leave</ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
          )}
        </Box>
        </div></details>
      </Box>
    </Box>
  );
}
