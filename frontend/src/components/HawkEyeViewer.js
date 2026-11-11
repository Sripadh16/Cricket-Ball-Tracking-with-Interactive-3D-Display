import React, { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  Box, Typography, ToggleButton, ToggleButtonGroup, Chip,
  FormControlLabel, Switch, Paper, Tooltip, IconButton, Button,
  Menu, MenuItem, ListItemIcon, ListItemText, Select, FormControl,
  Popover, Divider
} from '@mui/material';
import {
  SportsCricket, Palette, Whatshot, WbSunny, LiveTv,
  GraphicEq, AutoAwesome, Close, ExpandMore, AccountTree, Article,
  SlowMotionVideo, FlightTakeoff, RestartAlt, FlashOn,
  ThreeSixty, Videocam, Visibility, Person, Tune, Layers, Speed, Timeline, Check
} from '@mui/icons-material';
import DecisionFlowHUD from './DecisionFlowHUD';
import * as THREE from 'three';
import { THEME_CONFIGS, getThemeColors } from './ThemeEngine';
import UltraEdgeVisualizer from './UltraEdgeVisualizer';
import BatsmanAvatar from './BatsmanAvatar';
import DynamicStumps from './DynamicStumps';
import GhostTrajectoryOverlay, { GhostDivergencePill, GHOST_PRESETS } from './GhostTrajectoryOverlay';
import CinematicCameraController from './CinematicCameraController';
import PhysicsVectorArrows, { PhysicsTelemetryBadge } from './PhysicsVectorsHUD';

// Standard Cricket Pitch Dimensions (meters)
const PITCH_LENGTH = 20.12;  // 22 yards
const PITCH_WIDTH = 3.05;    // 10 feet
const STUMP_HEIGHT = 0.711;  // 28 inches
const STUMP_WIDTH = 0.2286;  // 9 inches
const BALL_RADIUS = 0.036;

// 3D Stumps & Bails component with Theme-aware Materials
function Stumps({ position, isTargetEnd = false, hitStump = 'None', theme }) {
  const stumpSpacing = 0.057; // 5.7cm apart
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
            <cylinderGeometry args={[0.018, 0.018, STUMP_HEIGHT, 16]} />
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
      <mesh position={[-0.028, STUMP_HEIGHT + 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.055, 12]} />
        <meshStandardMaterial color={themeStumps.bailsColor} roughness={0.4} />
      </mesh>
      <mesh position={[0.028, STUMP_HEIGHT + 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.055, 12]} />
        <meshStandardMaterial color={themeStumps.bailsColor} roughness={0.4} />
      </mesh>
    </group>
  );
}

// Detailed Cricket Pitch with Crease Markings, Grid Overlay & Optional Length Zones
function CricketPitch({ showZones = false, theme }) {
  const halfPitch = PITCH_LENGTH / 2;
  const poppingCreaseDist = 1.22; // 1.22m in front of bowling crease

  const pConfig = theme?.pitch || THEME_CONFIGS.broadcast.pitch;

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
    const NUM_SEGMENTS = 10;
    const TIME_STEP = 0.016; // ~16ms history steps

    for (let s = 1; s <= NUM_SEGMENTS; s++) {
      const pastTime = currentTime - s * TIME_STEP;
      if (pastTime < (allPoints[0].t || 0)) break;

      // Locate enclosing points in trajectory
      let idx = 0;
      for (let i = 0; i < allPoints.length - 1; i++) {
        if (allPoints[i].t <= pastTime) idx = i;
        else break;
      }

      const p1 = allPoints[idx];
      const p2 = allPoints[Math.min(idx + 1, allPoints.length - 1)];

      let interpolated;
      if (p1 === p2 || p1.t === p2.t) {
        interpolated = p1;
      } else {
        const t = (pastTime - p1.t) / (p2.t - p1.t);
        const clampedT = Math.max(0, Math.min(1, t));
        interpolated = {
          x: p1.x + (p2.x - p1.x) * clampedT,
          y: p1.y + (p2.y - p1.y) * clampedT,
          z: p1.z + (p2.z - p1.z) * clampedT
        };
      }

      const fraction = (NUM_SEGMENTS - s) / NUM_SEGMENTS; // 1 at ball, 0 at end of tail
      segments.push({
        position: [interpolated.x, interpolated.y, interpolated.z],
        radius: BALL_RADIUS * (0.2 + fraction * 0.7),
        opacity: Math.pow(fraction, 1.4) * 0.75
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
      const s = 1 + Math.sin(clock.getElapsedTime() * 4) * 0.12;
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
    return dz < 0.40 && dy < 0.50;
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
function CricketBall({ position, showGlow = true, theme }) {
  const meshRef = useRef();

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += 14.0 * delta;
      meshRef.current.rotation.y += 5.0 * delta;
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
  currentTime,
  cameraView,
  showExtrapolation,
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
      const all = (trajectoryData.points || []).map(convert);

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

    const pts = (trajectoryData.points || []).map(convert).filter(Boolean);
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
      bouncePoint: pts[minZIdx],
      impactPoint: pts[pts.length - 1],
      stumpTarget: null,
      allPoints: pts
    };
  }, [trajectoryData]);

  // Interpolate ball position according to current playback time
  const currentBallPos = useMemo(() => {
    if (allPoints.length === 0) return null;
    if (allPoints.length === 1) return allPoints[0];

    let idx = 0;
    for (let i = 0; i < allPoints.length - 1; i++) {
      if (allPoints[i].t <= currentTime) idx = i;
      else break;
    }

    const p1 = allPoints[idx];
    const p2 = allPoints[Math.min(idx + 1, allPoints.length - 1)];
    if (p1 === p2 || p1.t === p2.t) return p1;

    const t = (currentTime - p1.t) / (p2.t - p1.t);
    const clampedT = Math.max(0, Math.min(1, t));

    return {
      x: p1.x + (p2.x - p1.x) * clampedT,
      y: p1.y + (p2.y - p1.y) * clampedT,
      z: p1.z + (p2.z - p1.z) * clampedT
    };
  }, [allPoints, currentTime]);

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
        view={cameraView}
        ballPosition={currentBallPos}
        bouncePoint={bouncePoint}
        impactPoint={impactPoint}
        trajectoryPoints={allPoints}
        currentTime={currentTime}
      />
      <CricketPitch showZones={showZones} theme={theme} />

      {/* Multi-Phase Hawk-Eye Trajectory Ribbons */}
      {preBouncePoints && preBouncePoints.length > 1 && (
        <TrajectoryTube
          points={preBouncePoints}
          color={trajCfg.preBounce}
          emissiveColor={trajCfg.preBounceEmissive}
          radius={0.024}
        />
      )}

      {postBouncePoints && postBouncePoints.length > 1 && (
        <TrajectoryTube
          points={postBouncePoints}
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
          primaryTrajectory={trajectoryData}
          ghostTrajectoryData={ghostTrajectoryData}
          ghostPreset={ghostPreset}
          currentTime={currentTime}
          showExtrapolation={showExtrapolation}
        />
      )}

      {/* Dust Impact Puff Particle Burst at Bounce Point */}
      <BounceDustParticles
        bouncePoint={bouncePoint}
        bounceTime={bounceTime}
        currentTime={currentTime}
        theme={theme}
      />

      {/* Comet Speed Tail / Glowing Trajectory Particles following the Ball */}
      <BallCometTail
        currentBallPos={currentBallPos}
        allPoints={allPoints}
        currentTime={currentTime}
        theme={theme}
      />

      {/* Smart LED Zing Stumps & Bails at Batsman End (Z = halfPitch = 10.06m) */}
      <DynamicStumps
        ref={targetStumpsRef}
        position={[0, 0, PITCH_LENGTH / 2]}
        isTargetEnd={true}
        hitStump={trajectoryData?.hit_stump || 'None'}
        drsVerdict={trajectoryData?.drs_evaluation}
        currentBallPos={currentBallPos}
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
      <PhysicsVectorArrows
        ballPosition={currentBallPos}
        telemetry={currentTelemetry}
        visible={showForceVectors}
      />

      {/* Moving 3D Cricket Ball */}
      <CricketBall position={currentBallPos} theme={theme} />
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
  initialTheme = 'broadcast',
  ghostTrajectoryData = null,
  initialGhostPreset = 'none',
  onSeek = null,
  onOpenFlowHUD = null,
  onOpenReportCard = null
}) {
  const [cameraView, setCameraView] = useState('orbit');
  const [ghostPreset, setGhostPreset] = useState(initialGhostPreset);
  const [showExtrapolation, setShowExtrapolation] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);

  // 3D Aerodynamic Force Vectors & Physics HUD State (default false for clean canvas)
  const [showForceVectors, setShowForceVectors] = useState(false);

  // Menu Anchors for Clean Grouped Controls
  const [moreViewsAnchorEl, setMoreViewsAnchorEl] = useState(null);
  const [batterAnchorEl, setBatterAnchorEl] = useState(null);

  // Real-time Physics Telemetry computed for HUD overlay and 3D vector arrows
  const currentTelemetry = useMemo(() => {
    const pts = trajectoryData?.points;
    if (!pts || pts.length === 0) return null;
    let idx = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].t <= currentTime) idx = i;
      else break;
    }
    const p1 = pts[idx];

    const vx = p1.vx !== undefined ? p1.vx : (p1.velocity_vector ? p1.velocity_vector[0] : 0);
    const vy = p1.vy !== undefined ? p1.vy : (p1.velocity_vector ? p1.velocity_vector[1] : 35);
    const vz = p1.vz !== undefined ? p1.vz : (p1.velocity_vector ? p1.velocity_vector[2] : -2);

    return {
      velocity_vector: p1.velocity_vector || [vx, vy, vz],
      magnus_vector: p1.magnus_vector || [0.35, 0, 0.15],
      gravity_vector: p1.gravity_vector || [0, 0, -1.53],
      spin_vector: p1.spin_vector || [-150, 0, -40],
      spin_rpm: p1.spin_rpm || trajectoryData?.spin_rpm || 2100,
      magnus_force_n: p1.magnus_force_n !== undefined
        ? p1.magnus_force_n
        : (p1.magnus_vector ? Math.sqrt(p1.magnus_vector[0]**2 + p1.magnus_vector[1]**2 + p1.magnus_vector[2]**2) : 0.42),
      drag_force_n: p1.drag_force_n || 0.85,
      reynolds_number: p1.reynolds_number || 172000,
      speed_kmh: p1.speed_kmh || (Math.sqrt(vx**2 + vy**2 + vz**2) * 3.6),
      phase: p1.phase || 'trajectory'
    };
  }, [trajectoryData, currentTime]);

  // 3D Batsman Avatar & Dynamic Zing Stumps State
  const [showAvatar, setShowAvatar] = useState(true);
  const [stance, setStance] = useState('right_hand');
  const [batAction, setBatAction] = useState('auto');
  const targetStumpsRef = useRef(null);
  const [shatterTrigger, setShatterTrigger] = useState(false);
  const [isShattered, setIsShattered] = useState(false);

  const toggleShatterAction = () => {
    if (isShattered) {
      if (targetStumpsRef.current) targetStumpsRef.current.reset();
      setIsShattered(false);
      setShatterTrigger(false);
    } else {
      if (targetStumpsRef.current) targetStumpsRef.current.shatter();
      else setShatterTrigger(true);
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
  const drs = trajectoryData?.drs_evaluation;

  return (
    <Box sx={{
      height: '100%',
      position: 'relative',
      bgcolor: theme.background,
      overflow: 'hidden',
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
            currentTime={currentTime}
            cameraView={cameraView}
            showExtrapolation={showExtrapolation}
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
            label="HAWK-EYE 3D"
            size="small"
            sx={{
              background: theme.ui.badgeBg || 'rgba(230,57,70,0.9)',
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

      {/* Top Right: Theme Switcher & Trajectory Color Legend */}
      <Box sx={{
        position: 'absolute',
        top: 14,
        right: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 0.8,
        zIndex: 10
      }}>
        {/* Quick Toolbar: Theme Selector Button & UltraEdge Toggle */}
        <Box sx={{ display: 'flex', gap: 0.8, alignItems: 'center' }}>
          <Tooltip title="Toggle Ultra-Edge / Snickometer Soundwave Drawer">
            <Button
              size="small"
              variant={showUltraEdge ? 'contained' : 'outlined'}
              startIcon={<GraphicEq sx={{ fontSize: 15 }} />}
              onClick={() => setShowUltraEdge(!showUltraEdge)}
              sx={{
                bgcolor: showUltraEdge ? 'rgba(56, 189, 248, 0.9)' : 'rgba(10,22,40,0.85)',
                color: showUltraEdge ? '#020617' : '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.4)',
                backdropFilter: 'blur(8px)',
                fontWeight: 700,
                fontSize: '0.72rem',
                textTransform: 'none',
                py: 0.35,
                px: 1.1,
                borderRadius: 2,
                '&:hover': {
                  bgcolor: showUltraEdge ? '#38bdf8' : 'rgba(56, 189, 248, 0.15)',
                  borderColor: '#38bdf8'
                }
              }}
            >
              Ultra-Edge
            </Button>
          </Tooltip>

          <Button
            size="small"
            variant="outlined"
            startIcon={<Palette sx={{ fontSize: 15, color: theme.ui.accent }} />}
            endIcon={<ExpandMore sx={{ fontSize: 15 }} />}
            onClick={(e) => setThemeAnchorEl(e.currentTarget)}
            sx={{
              bgcolor: 'rgba(10,22,40,0.85)',
              color: '#e2e8f0',
              borderColor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(8px)',
              fontWeight: 700,
              fontSize: '0.72rem',
              textTransform: 'none',
              py: 0.35,
              px: 1.1,
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
            <ListItemText primary="Thermal HotSpot" secondary="Infrared Heat Signature" secondaryTypographyProps={{ color: '#94a3b8', fontSize: '0.68rem' }} />
          </MenuItem>
        </Menu>

        {/* Trajectory Color Legend (Sleek Horizontal Pill) */}
        <Paper sx={{
          bgcolor: 'rgba(10,22,40,0.85)',
          backdropFilter: 'blur(8px)',
          border: `1px solid ${theme.ui.borderColor}`,
          borderRadius: 2,
          px: 1.2,
          py: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.2
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 10, height: 3.5, bgcolor: theme.trajectory.preBounce, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.65rem', fontWeight: 600 }}>Pre-Bounce</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 10, height: 3.5, bgcolor: theme.trajectory.postBounce, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.65rem', fontWeight: 600 }}>Post-Bounce</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Box sx={{ width: 10, height: 3.5, bgcolor: theme.trajectory.extrapolated, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.65rem', fontWeight: 600 }}>Projected</Typography>
          </Box>
          {ghostPreset !== 'none' && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Box sx={{ width: 10, height: 3.5, bgcolor: '#00f5ff', borderRadius: 1, boxShadow: '0 0 6px #a855f7' }} />
              <Typography variant="caption" sx={{ color: '#00f5ff', fontSize: '0.65rem', fontWeight: 700 }}>Ghost</Typography>
            </Box>
          )}
        </Paper>
      </Box>

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
            <IconButton size="small" onClick={() => setSelectedPoint(null)} sx={{ color: '#94a3b8', p: 0.2 }}>
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
          position: 'absolute',
          bottom: 74,
          left: '50%',
          transform: 'translateX(-50%)',
          width: { xs: '95%', sm: '85%', md: '72%' },
          maxWidth: 720,
          zIndex: 20,
          boxShadow: '0 12px 40px rgba(0,0,0,0.85)'
        }}>
          <UltraEdgeVisualizer
            currentTime={currentTime}
            duration={trajectoryData?.video_duration || 1.5}
            trajectoryData={trajectoryData}
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

      {/* Bottom Center: Professional Broadcast Camera & Controls Dock */}
      <Box sx={{
        position: 'absolute',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        bgcolor: 'rgba(8, 18, 32, 0.92)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${theme.ui.borderColor}`,
        borderRadius: 3,
        p: 0.6,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
        zIndex: 10,
        maxWidth: '96vw',
        overflowX: 'auto'
      }}>
        {/* Core Camera Views */}
        <ToggleButtonGroup
          size="small"
          value={['orbit', 'chase', 'batsman', 'umpire'].includes(cameraView) ? cameraView : null}
          exclusive
          onChange={(_, v) => v && setCameraView(v)}
          sx={{
            height: 30,
            '& .MuiToggleButton-root': {
              color: '#cbd5e1',
              borderColor: 'rgba(255,255,255,0.15)',
              fontSize: '0.72rem',
              fontWeight: 600,
              px: 1.2,
              py: 0.3,
              textTransform: 'none',
              gap: 0.5
            },
            '& .Mui-selected': {
              bgcolor: `${theme.ui.accent} !important`,
              color: theme.id === 'cyberpunk' || theme.id === 'golden' ? '#000000 !important' : 'white !important',
              fontWeight: 700
            }
          }}
        >
          <ToggleButton value="orbit">
            <ThreeSixty sx={{ fontSize: 15 }} />
            Orbit
          </ToggleButton>
          <ToggleButton value="chase">
            <Videocam sx={{ fontSize: 15 }} />
            Chase
          </ToggleButton>
          <ToggleButton value="batsman">
            <Visibility sx={{ fontSize: 15 }} />
            Batter
          </ToggleButton>
          <ToggleButton value="umpire">
            <SportsCricket sx={{ fontSize: 15 }} />
            Umpire
          </ToggleButton>
        </ToggleButtonGroup>

        {/* More Camera Angles Dropdown */}
        <Button
          size="small"
          variant={!['orbit', 'chase', 'batsman', 'umpire'].includes(cameraView) ? 'contained' : 'outlined'}
          endIcon={<ExpandMore sx={{ fontSize: 16 }} />}
          onClick={(e) => setMoreViewsAnchorEl(e.currentTarget)}
          sx={{
            height: 30,
            fontSize: '0.72rem',
            fontWeight: 600,
            textTransform: 'none',
            px: 1,
            borderRadius: 1.5,
            bgcolor: !['orbit', 'chase', 'batsman', 'umpire'].includes(cameraView) ? theme.ui.accent : 'rgba(255,255,255,0.06)',
            color: !['orbit', 'chase', 'batsman', 'umpire'].includes(cameraView) ? '#020617' : '#cbd5e1',
            borderColor: !['orbit', 'chase', 'batsman', 'umpire'].includes(cameraView) ? theme.ui.accent : 'rgba(255,255,255,0.18)'
          }}
        >
          {cameraView === 'bowler' ? 'Bowler POV' :
           cameraView === 'side' ? 'Side Arc' :
           cameraView === 'aerial' ? 'Pitch Map' :
           cameraView === 'impact' ? 'Impact Zoom' :
           cameraView === 'bullet_time' ? 'Bullet Time' :
           cameraView === 'drone_flythrough' ? 'Drone Cam' : 'More Angles'}
        </Button>

        <Menu
          anchorEl={moreViewsAnchorEl}
          open={Boolean(moreViewsAnchorEl)}
          onClose={() => setMoreViewsAnchorEl(null)}
          PaperProps={{
            sx: { bgcolor: '#0a1626', color: 'white', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 2 }
          }}
        >
          <MenuItem selected={cameraView === 'bowler'} onClick={() => { setCameraView('bowler'); setMoreViewsAnchorEl(null); }}>
            <ListItemText primary="Bowler End POV" secondary="View from bowler's run-up" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
          <MenuItem selected={cameraView === 'side'} onClick={() => { setCameraView('side'); setMoreViewsAnchorEl(null); }}>
            <ListItemText primary="Side Arc (Elevation)" secondary="Full pitch trajectory elevation profile" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
          <MenuItem selected={cameraView === 'aerial'} onClick={() => { setCameraView('aerial'); setMoreViewsAnchorEl(null); }}>
            <ListItemText primary="Pitch Map (Top-Down 2D)" secondary="Overhead pitching length distribution" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
          <MenuItem selected={cameraView === 'impact'} onClick={() => { setCameraView('impact'); setMoreViewsAnchorEl(null); }}>
            <ListItemText primary="Impact Close-Up Zoom" secondary="Close-in focus on wicket and pads" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
          <MenuItem selected={cameraView === 'bullet_time'} onClick={() => { setCameraView('bullet_time'); setMoreViewsAnchorEl(null); }}>
            <ListItemIcon><SlowMotionVideo sx={{ color: '#c084fc', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Bullet Time (Matrix 360°)" secondary="Cinematic orbital freeze-frame sweep" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
          <MenuItem selected={cameraView === 'drone_flythrough'} onClick={() => { setCameraView('drone_flythrough'); setMoreViewsAnchorEl(null); }}>
            <ListItemIcon><FlightTakeoff sx={{ color: '#38bdf8', fontSize: 18 }} /></ListItemIcon>
            <ListItemText primary="Drone Flythrough" secondary="Dynamic aerial flight down the pitch" secondaryTypographyProps={{ fontSize: '0.68rem', color: '#94a3b8' }} />
          </MenuItem>
        </Menu>

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.15)', my: 0.5 }} />

        {/* Feature Switches: Predict, Vectors, Zones */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Toggle Extrapolated Path">
            <Button
              size="small"
              variant={showExtrapolation ? 'contained' : 'outlined'}
              startIcon={<Timeline sx={{ fontSize: 14 }} />}
              onClick={() => setShowExtrapolation(!showExtrapolation)}
              sx={{
                height: 30,
                fontSize: '0.7rem',
                fontWeight: 600,
                px: 1,
                py: 0.2,
                borderRadius: 1.5,
                bgcolor: showExtrapolation ? 'rgba(230, 57, 70, 0.25)' : 'transparent',
                color: showExtrapolation ? '#ff4d6d' : '#94a3b8',
                borderColor: showExtrapolation ? '#ff4d6d' : 'rgba(255,255,255,0.15)',
                textTransform: 'none'
              }}
            >
              Predict
            </Button>
          </Tooltip>

          <Tooltip title="Toggle Aerodynamic Force Vectors & Physics HUD">
            <Button
              size="small"
              variant={showForceVectors ? 'contained' : 'outlined'}
              startIcon={<Speed sx={{ fontSize: 14 }} />}
              onClick={() => setShowForceVectors(!showForceVectors)}
              sx={{
                height: 30,
                fontSize: '0.7rem',
                fontWeight: 600,
                px: 1,
                py: 0.2,
                borderRadius: 1.5,
                bgcolor: showForceVectors ? 'rgba(0, 229, 255, 0.2)' : 'transparent',
                color: showForceVectors ? '#00e5ff' : '#94a3b8',
                borderColor: showForceVectors ? '#00e5ff' : 'rgba(255,255,255,0.15)',
                textTransform: 'none'
              }}
            >
              Vectors
            </Button>
          </Tooltip>

          <Tooltip title="Toggle Pitch Length Zones (Yorker, Full, Good Length, Short)">
            <Button
              size="small"
              variant={showZones ? 'contained' : 'outlined'}
              startIcon={<Layers sx={{ fontSize: 14 }} />}
              onClick={() => setShowZones(!showZones)}
              sx={{
                height: 30,
                fontSize: '0.7rem',
                fontWeight: 600,
                px: 1,
                py: 0.2,
                borderRadius: 1.5,
                bgcolor: showZones ? 'rgba(42, 157, 143, 0.25)' : 'transparent',
                color: showZones ? '#4ade80' : '#94a3b8',
                borderColor: showZones ? '#4ade80' : 'rgba(255,255,255,0.15)',
                textTransform: 'none'
              }}
            >
              Zones
            </Button>
          </Tooltip>
        </Box>

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.15)', my: 0.5 }} />

        {/* Batter Avatar Configuration Dropdown */}
        <Button
          size="small"
          variant={showAvatar ? 'contained' : 'outlined'}
          startIcon={<Person sx={{ fontSize: 15 }} />}
          endIcon={<ExpandMore sx={{ fontSize: 15 }} />}
          onClick={(e) => setBatterAnchorEl(e.currentTarget)}
          sx={{
            height: 30,
            fontSize: '0.7rem',
            fontWeight: 600,
            textTransform: 'none',
            px: 1,
            borderRadius: 1.5,
            bgcolor: showAvatar ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.06)',
            color: showAvatar ? '#38bdf8' : '#cbd5e1',
            borderColor: showAvatar ? '#38bdf8' : 'rgba(255,255,255,0.18)'
          }}
        >
          {showAvatar ? `Batter (${stance === 'right_hand' ? 'RHB' : 'LHB'})` : 'Batter'}
        </Button>

        <Popover
          open={Boolean(batterAnchorEl)}
          anchorEl={batterAnchorEl}
          onClose={() => setBatterAnchorEl(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          PaperProps={{
            sx: {
              bgcolor: '#0a1626',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 2.5,
              p: 1.8,
              minWidth: 220,
              boxShadow: '0 12px 32px rgba(0,0,0,0.8)'
            }
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#e2e8f0' }}>Show 3D Batter</Typography>
              <Switch
                size="small"
                checked={showAvatar}
                onChange={(e) => setShowAvatar(e.target.checked)}
                sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#38bdf8' } }}
              />
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>Batting Stance</Typography>
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
                    px: 1.2,
                    py: 0
                  },
                  '& .Mui-selected': { bgcolor: 'rgba(56, 189, 248, 0.85) !important', color: '#020617 !important' }
                }}
              >
                <ToggleButton value="right_hand">Right Hand (RHB)</ToggleButton>
                <ToggleButton value="left_hand">Left Hand (LHB)</ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.68rem' }}>Shot Kinematics</Typography>
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
                    px: 0.8,
                    py: 0
                  },
                  '& .Mui-selected': { bgcolor: 'rgba(245, 158, 11, 0.85) !important', color: '#020617 !important' }
                }}
              >
                <ToggleButton value="auto">Auto</ToggleButton>
                <ToggleButton value="defend">Defend</ToggleButton>
                <ToggleButton value="drive">Drive</ToggleButton>
                <ToggleButton value="leave">Leave</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Box>
        </Popover>

        <Divider orientation="vertical" flexItem sx={{ borderColor: 'rgba(255,255,255,0.15)', my: 0.5 }} />

        {/* Ghost Trajectory Selector */}
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <Select
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
              borderRadius: 1.5,
              border: ghostPreset !== 'none' ? '1px solid rgba(168,85,247,0.6)' : '1px solid rgba(255,255,255,0.15)',
              '& .MuiSelect-select': { py: 0.3, px: 1, display: 'flex', alignItems: 'center', gap: 0.5 },
              '& .MuiSvgIcon-root': { color: '#c084fc', fontSize: 16 }
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

        {/* Conditional Reset Wickets Button */}
        {isShattered && (
          <Button
            size="small"
            variant="contained"
            startIcon={<RestartAlt sx={{ fontSize: 15 }} />}
            onClick={toggleShatterAction}
            sx={{
              height: 30,
              fontSize: '0.7rem',
              fontWeight: 700,
              textTransform: 'none',
              bgcolor: '#ef4444',
              color: 'white',
              px: 1,
              borderRadius: 1.5,
              boxShadow: '0 0 12px rgba(239, 68, 68, 0.7)',
              '&:hover': { bgcolor: '#dc2626' }
            }}
          >
            Reset Wickets
          </Button>
        )}
      </Box>
    </Box>
  );
}
