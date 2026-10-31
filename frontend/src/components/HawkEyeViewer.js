import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import {
  Box, Typography, ToggleButton, ToggleButtonGroup, Chip,
  FormControlLabel, Switch, Paper, Tooltip, IconButton
} from '@mui/material';
import { SportsCricket } from '@mui/icons-material';
import * as THREE from 'three';

// Standard Cricket Pitch Dimensions (meters)
const PITCH_LENGTH = 20.12;  // 22 yards
const PITCH_WIDTH = 3.05;    // 10 feet
const STUMP_HEIGHT = 0.711;  // 28 inches
const STUMP_WIDTH = 0.2286;  // 9 inches
const BALL_RADIUS = 0.036;

const CAMERA_PRESETS = {
  orbit: { position: [7, 5, 5], target: [0, 0.4, 0] },
  umpire: { position: [0, 1.7, 13.5], target: [0, 0.6, 0] },
  batsman: { position: [0, 1.6, 9.2], target: [0, 1.2, -10] },
  bowler: { position: [0, 1.8, -13.5], target: [0, 0.6, 0] },
  side: { position: [14, 3.5, 2], target: [0, 0.5, 2] },
  aerial: { position: [0, 22, 0], target: [0, 0, 0] }
};

// 3D Stumps & Bails component
function Stumps({ position, isTargetEnd = false, hitStump = 'None' }) {
  const stumpSpacing = 0.057; // 5.7cm apart
  const stumps = [
    { name: 'Leg Stump', x: -stumpSpacing },
    { name: 'Middle Stump', x: 0 },
    { name: 'Off Stump', x: stumpSpacing }
  ];

  return (
    <group position={position}>
      {stumps.map((s, idx) => {
        const isHit = isTargetEnd && hitStump.includes(s.name.split(' ')[0]);
        return (
          <mesh key={idx} position={[s.x, STUMP_HEIGHT / 2, 0]} castShadow>
            <cylinderGeometry args={[0.018, 0.018, STUMP_HEIGHT, 16]} />
            <meshStandardMaterial
              color={isHit ? '#ff1744' : '#d4a373'}
              roughness={0.3}
              metalness={0.1}
              emissive={isHit ? '#ff1744' : '#000000'}
              emissiveIntensity={isHit ? 0.6 : 0}
            />
          </mesh>
        );
      })}

      {/* Two Bails */}
      <mesh position={[-0.028, STUMP_HEIGHT + 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.055, 12]} />
        <meshStandardMaterial color="#faedcd" roughness={0.4} />
      </mesh>
      <mesh position={[0.028, STUMP_HEIGHT + 0.015, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.055, 12]} />
        <meshStandardMaterial color="#faedcd" roughness={0.4} />
      </mesh>
    </group>
  );
}

// Detailed Cricket Pitch with Crease Markings & Optional Length Zones
function CricketPitch({ showZones = false }) {
  const halfPitch = PITCH_LENGTH / 2;
  const poppingCreaseDist = 1.22; // 1.22m in front of bowling crease

  return (
    <group>
      {/* Stadium Outfield Grass */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]} receiveShadow>
        <circleGeometry args={[36, 64]} />
        <meshStandardMaterial color="#1b4332" roughness={0.8} />
      </mesh>

      {/* Boundary Rope */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[34.8, 35.0, 64]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </mesh>

      {/* Pitch Turf Surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow>
        <planeGeometry args={[PITCH_WIDTH, PITCH_LENGTH + 3.0]} />
        <meshStandardMaterial color="#d4a373" roughness={0.9} />
      </mesh>

      {/* Bowling Creases (2.64m wide line passing through stumps) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -halfPitch]}>
        <planeGeometry args={[2.64, 0.06]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, halfPitch]}>
        <planeGeometry args={[2.64, 0.06]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Popping Creases (1.22m in front of stumps, minimum 3.66m long) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -halfPitch + poppingCreaseDist]}>
        <planeGeometry args={[3.2, 0.06]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, halfPitch - poppingCreaseDist]}>
        <planeGeometry args={[3.2, 0.06]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* Return Creases (perpendicular side boundaries at bowling crease) */}
      {[-1.32, 1.32].map((x, i) => (
        <React.Fragment key={i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, -halfPitch + 0.61]}>
            <planeGeometry args={[0.06, 1.8]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.002, halfPitch - 0.61]}>
            <planeGeometry args={[0.06, 1.8]} />
            <meshBasicMaterial color="#ffffff" />
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

      {/* Stumps at both ends */}
      <Stumps position={[0, 0, -halfPitch]} />
      <Stumps position={[0, 0, halfPitch]} isTargetEnd={true} />
    </group>
  );
}

// Glowing CatmullRom Trajectory Ribbon
function TrajectoryTube({ points, color, emissiveColor, radius = 0.022, isDashed = false }) {
  const geometry = useMemo(() => {
    if (!points || points.length < 2) return null;
    const vectors = points.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(vectors);
    return new THREE.TubeGeometry(curve, Math.max(20, points.length * 3), radius, 8, false);
  }, [points, radius]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        emissive={emissiveColor || color}
        emissiveIntensity={isDashed ? 0.9 : 0.6}
        roughness={0.2}
        metalness={0.8}
        transparent={isDashed}
        opacity={isDashed ? 0.75 : 0.95}
      />
    </mesh>
  );
}

// Concentric Animated Halo at Pitch Bounce Spot
function PitchingSpotMarker({ bouncePoint, onSelectPoint }) {
  const ringRef = useRef();

  useFrame(({ clock }) => {
    if (ringRef.current) {
      const s = 1 + Math.sin(clock.getElapsedTime() * 4) * 0.12;
      ringRef.current.scale.set(s, s, s);
    }
  });

  if (!bouncePoint) return null;

  return (
    <group position={[bouncePoint.x, 0.005, bouncePoint.z]}>
      {/* Outer pulsing ring */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.22, 32]} />
        <meshBasicMaterial color="#ffb703" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      {/* Inner bullseye spot */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.08, 32]} />
        <meshBasicMaterial color="#e63946" />
      </mesh>
      {/* Vertical guide line */}
      <line>
        <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0.45, 0)
        ])} />
        <lineDashedMaterial attach="material" color="#ffb703" dashSize={0.05} gapSize={0.03} />
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
function ImpactMarker({ impactPoint, onSelectPoint }) {
  if (!impactPoint) return null;

  return (
    <group position={[impactPoint.x, impactPoint.y, impactPoint.z]}>
      {/* Impact glowing sphere */}
      <mesh onClick={() => onSelectPoint && onSelectPoint(impactPoint)}>
        <sphereGeometry args={[0.065, 24, 24]} />
        <meshStandardMaterial
          color="#f72585"
          emissive="#f72585"
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
        <lineBasicMaterial attach="material" color="#f72585" transparent opacity={0.6} />
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

// Moving Cricket Ball with Dynamic Trail Glow
function CricketBall({ position, showGlow = true }) {
  const meshRef = useRef();

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.x += 0.15;
      meshRef.current.rotation.y += 0.2;
    }
  });

  if (!position) return null;

  return (
    <group position={[position.x, position.y, position.z]}>
      <mesh ref={meshRef} castShadow>
        <sphereGeometry args={[BALL_RADIUS, 24, 24]} />
        <meshStandardMaterial color="#c1121f" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Seam line */}
      <mesh rotation={[0, Math.PI / 4, 0]}>
        <torusGeometry args={[BALL_RADIUS + 0.001, 0.003, 8, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
      {/* Dynamic aura */}
      {showGlow && (
        <mesh>
          <sphereGeometry args={[BALL_RADIUS * 1.5, 16, 16]} />
          <meshBasicMaterial color="#ff4d6d" transparent opacity={0.25} />
        </mesh>
      )}
    </group>
  );
}

// Camera Controller Supporting Smooth Orbit and Dynamic Chase Cam
function CameraController({ view, ballPosition }) {
  const { camera } = useThree();
  const controlsRef = useRef();

  useEffect(() => {
    if (view === 'chase') return; // Handled per-frame
    const preset = CAMERA_PRESETS[view];
    if (preset && camera) {
      camera.position.set(...preset.position);
      if (controlsRef.current) {
        controlsRef.current.target.set(...preset.target);
        controlsRef.current.update();
      }
    }
  }, [view, camera]);

  useFrame(() => {
    if (view === 'chase' && ballPosition && camera) {
      // Position camera slightly behind and above the moving ball
      camera.position.lerp(
        new THREE.Vector3(ballPosition.x, ballPosition.y + 0.5, ballPosition.z - 2.2),
        0.12
      );
      if (controlsRef.current) {
        controlsRef.current.target.lerp(
          new THREE.Vector3(ballPosition.x, ballPosition.y, ballPosition.z + 4.0),
          0.12
        );
        controlsRef.current.update();
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      maxPolarAngle={Math.PI / 2 + 0.05}
      minDistance={1.2}
      maxDistance={65}
    />
  );
}

// Main 3D Canvas Scene
function Scene({
  trajectoryData,
  currentTime,
  cameraView,
  showExtrapolation,
  showZones,
  onSelectPoint
}) {
  // Map raw trajectory coordinates into Three.js coordinates:
  // Three.js X = cricket X (width)
  // Three.js Y = cricket Z (height above pitch)
  // Three.js Z = cricket Y (pitch length axis)
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

    // Standardized coordinate converter
    const convert = (p) => {
      if (!p) return null;
      return {
        x: p.x || 0,
        y: Math.max(0.036, (p.z !== undefined ? p.z : 0.1)),
        z: p.y !== undefined ? p.y : 0,
        t: p.t || 0,
        speed_kmh: p.speed_kmh || 135,
        phase: p.phase || 'trajectory'
      };
    };

    // Case 1: Structured payload with phases (from DeliveryPhysicsSimulator or upgraded CV)
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

    // Case 2: Unstructured points list (e.g. legacy/raw OpenCV detections)
    const pts = (trajectoryData.points || []).map(convert).filter(Boolean);
    if (pts.length === 0) return { allPoints: [] };

    // Find bounce candidate (minimum height)
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

    // Find two points enclosing currentTime
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

  return (
    <>
      <ambientLight intensity={0.65} />
      <directionalLight
        position={[15, 25, 10]}
        intensity={1.0}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-15, 20, -10]} intensity={0.4} />

      <CameraController view={cameraView} ballPosition={currentBallPos} />
      <CricketPitch showZones={showZones} />

      {/* Multi-Phase Hawk-Eye Trajectory Ribbons */}
      {preBouncePoints && preBouncePoints.length > 1 && (
        <TrajectoryTube
          points={preBouncePoints}
          color="#00e5ff"
          emissiveColor="#00b4d8"
          radius={0.024}
        />
      )}

      {postBouncePoints && postBouncePoints.length > 1 && (
        <TrajectoryTube
          points={postBouncePoints}
          color="#ffb703"
          emissiveColor="#fb8500"
          radius={0.024}
        />
      )}

      {showExtrapolation && extrapolatedPoints && extrapolatedPoints.length > 1 && (
        <TrajectoryTube
          points={extrapolatedPoints}
          color="#f72585"
          emissiveColor="#b5179e"
          radius={0.02}
          isDashed={true}
        />
      )}

      {/* 3D Event Markers */}
      <PitchingSpotMarker bouncePoint={bouncePoint} onSelectPoint={onSelectPoint} />
      <ImpactMarker impactPoint={impactPoint} onSelectPoint={onSelectPoint} />

      {showExtrapolation && stumpTarget && (
        <StumpsTargetPlane
          target={stumpTarget}
          drsVerdict={trajectoryData?.drs_evaluation}
        />
      )}

      {/* Moving 3D Cricket Ball */}
      <CricketBall position={currentBallPos} />
    </>
  );
}

// Master Interactive 3D Viewer Component
export default function HawkEyeViewer({ trajectoryData, currentTime = 0 }) {
  const [cameraView, setCameraView] = useState('orbit');
  const [showExtrapolation, setShowExtrapolation] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState(null);

  const drs = trajectoryData?.drs_evaluation;

  return (
    <Box sx={{ height: '100%', position: 'relative', bgcolor: '#08121e', overflow: 'hidden' }}>
      <Canvas
        shadows
        camera={{ position: [7, 5, 5], fov: 48, near: 0.1, far: 120 }}
      >
        <color attach="background" args={['#08121e']} />
        <fog attach="fog" args={['#08121e', 35, 75]} />
        <Scene
          trajectoryData={trajectoryData}
          currentTime={currentTime}
          cameraView={cameraView}
          showExtrapolation={showExtrapolation}
          showZones={showZones}
          onSelectPoint={(p) => setSelectedPoint(p)}
        />
      </Canvas>

      {/* Header Overlay: DRS Live Badge & Delivery Type */}
      <Box sx={{
        position: 'absolute',
        top: 14,
        left: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.8,
        pointerEvents: 'none'
      }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Chip
            icon={<SportsCricket sx={{ fontSize: 16 }} />}
            label="HAWK-EYE 3D"
            size="small"
            sx={{
              bgcolor: 'rgba(230,57,70,0.9)',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.75rem',
              letterSpacing: 0.8
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

      {/* Trajectory Color Legend (Top Right) */}
      <Paper sx={{
        position: 'absolute',
        top: 14,
        right: 14,
        bgcolor: 'rgba(10,22,40,0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 2,
        p: 1.2,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.6
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 14, height: 4, bgcolor: '#00e5ff', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Pre-Bounce Arc</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 14, height: 4, bgcolor: '#ffb703', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Post-Bounce Arc</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 14, height: 4, bgcolor: '#f72585', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#e2e8f0', fontSize: '0.7rem' }}>Projected Path</Typography>
        </Box>
      </Paper>

      {/* Point Inspector Tooltip Card (Pop-up on marker click) */}
      {selectedPoint && (
        <Paper sx={{
          position: 'absolute',
          top: 110,
          right: 14,
          bgcolor: 'rgba(15,23,42,0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(247,37,133,0.5)',
          borderRadius: 2,
          p: 1.5,
          minWidth: 180,
          color: 'white',
          zIndex: 10
        }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#f72585', textTransform: 'uppercase' }}>
              Point Telemetry
            </Typography>
            <IconButton size="small" onClick={() => setSelectedPoint(null)} sx={{ color: '#94a3b8', p: 0.2 }}>
              ×
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
          {selectedPoint.speed_kmh && (
            <Typography variant="body2" sx={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 600 }}>
              Speed: {selectedPoint.speed_kmh} km/h
            </Typography>
          )}
        </Paper>
      )}

      {/* Bottom Center: Interactive Camera Switcher & Toggles */}
      <Box sx={{
        position: 'absolute',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        bgcolor: 'rgba(10,22,40,0.88)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 3,
        p: 0.8,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
      }}>
        {/* Camera Views */}
        <ToggleButtonGroup
          size="small"
          value={cameraView}
          exclusive
          onChange={(_, v) => v && setCameraView(v)}
          sx={{
            '& .MuiToggleButton-root': {
              color: '#cbd5e1',
              borderColor: 'rgba(255,255,255,0.15)',
              fontSize: '0.72rem',
              fontWeight: 600,
              px: 1.2,
              py: 0.5,
              textTransform: 'none'
            },
            '& .Mui-selected': {
              bgcolor: 'rgba(230,57,70,0.85) !important',
              color: 'white !important'
            }
          }}
        >
          <ToggleButton value="orbit">Free Orbit</ToggleButton>
          <ToggleButton value="chase">Chase Cam</ToggleButton>
          <ToggleButton value="batsman">Batsman POV</ToggleButton>
          <ToggleButton value="umpire">Umpire</ToggleButton>
          <ToggleButton value="bowler">Bowler</ToggleButton>
          <ToggleButton value="side">Side Arc</ToggleButton>
          <ToggleButton value="aerial">Pitch Map</ToggleButton>
        </ToggleButtonGroup>

        {/* Feature Switches */}
        <Box sx={{ display: 'flex', gap: 1, borderLeft: '1px solid rgba(255,255,255,0.2)', pl: 1 }}>
          <Tooltip title="Toggle Extrapolated Path">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showExtrapolation}
                  onChange={(e) => setShowExtrapolation(e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#f72585' } }}
                />
              }
              label={<Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.68rem' }}>Predict</Typography>}
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
        </Box>
      </Box>
    </Box>
  );
}
