import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Box, Paper, Typography, Chip, Tooltip } from '@mui/material';
import { Speed, RotateRight, Air, Waves } from '@mui/icons-material';

/**
 * 3D Vector Arrow with glowing cylinder shaft and cone arrowhead.
 * Orients from (0,1,0) along the provided direction vector.
 */
function VectorArrow({
  origin = [0, 0, 0],
  direction = [0, 1, 0],
  length = 0.5,
  color = '#00e5ff',
  radius = 0.007,
  headLength = 0.08,
  headRadius = 0.020,
  opacity = 0.95
}) {
  const dirVec = useMemo(() => {
    const v = new THREE.Vector3(...direction);
    return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }, [direction]);

  const quaternion = useMemo(() => {
    const defaultUp = new THREE.Vector3(0, 1, 0);
    return new THREE.Quaternion().setFromUnitVectors(defaultUp, dirVec);
  }, [dirVec]);

  const safeLength = Math.max(0.12, length);
  const actualHeadLen = Math.min(safeLength * 0.4, headLength);
  const shaftLen = safeLength - actualHeadLen;

  return (
    <group position={origin} quaternion={quaternion}>
      {/* Arrow Shaft (Cylinder) */}
      <mesh position={[0, shaftLen / 2, 0]}>
        <cylinderGeometry args={[radius, radius, shaftLen, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.8}
          roughness={0.2}
          metalness={0.8}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Arrowhead (Cone) */}
      <mesh position={[0, shaftLen + actualHeadLen / 2, 0]}>
        <coneGeometry args={[headRadius, actualHeadLen, 20]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.0}
          roughness={0.15}
          metalness={0.9}
          transparent
          opacity={opacity}
        />
      </mesh>
    </group>
  );
}

/**
 * Spin Axis indicator & Rotating Equatorial Seam Ring.
 * Visualizes the spin orientation and angular velocity in real-time.
 */
function SpinOrientationRing({
  origin = [0, 0, 0],
  spinAxis = [0, 1, 0],
  spinRpm = 0,
  replayTime = 0,
  radius = 0.048,
  color = '#ffffff'
}) {
  const ringRef = useRef();

  const axisVec = useMemo(() => {
    const v = new THREE.Vector3(...spinAxis);
    return v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 1, 0);
  }, [spinAxis]);

  const baseQuaternion = useMemo(() => {
    const defaultUp = new THREE.Vector3(0, 1, 0);
    return new THREE.Quaternion().setFromUnitVectors(defaultUp, axisVec);
  }, [axisVec]);

  useFrame((_, delta) => {
    if (ringRef.current) {
      // Rotation speed proportional to spin RPM
      const radPerSec = (spinRpm * 2 * Math.PI) / 60;
      ringRef.current.rotation.y = radPerSec * replayTime * 0.08;
    }
  });

  return (
    <group position={origin} quaternion={baseQuaternion}>
      {/* Rotating Equatorial Ring */}
      <group ref={ringRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 0.95, radius * 1.15, 32]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            roughness={0.3}
            metalness={0.7}
            transparent
            opacity={0.75}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Small seam tick markers on the rotating ring */}
        {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((angle, i) => (
          <mesh
            key={i}
            position={[
              Math.cos(angle) * radius * 1.05,
              0,
              Math.sin(angle) * radius * 1.05
            ]}
          >
            <sphereGeometry args={[0.0035, 8, 8]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        ))}
      </group>

      {/* Spin Axis Pointer Arrow */}
      <VectorArrow
        origin={[0, 0, 0]}
        direction={[0, 1, 0]}
        length={0.28}
        color="#ffffff"
        radius={0.004}
        headLength={0.05}
        headRadius={0.012}
        opacity={0.9}
      />
      <VectorArrow
        origin={[0, 0, 0]}
        direction={[0, -1, 0]}
        length={0.28}
        color="#cbd5e1"
        radius={0.004}
        headLength={0.05}
        headRadius={0.012}
        opacity={0.6}
      />
    </group>
  );
}

/**
 * 3D Physics Force Vectors rendered inside Three.js scene originating from moving ball.
 */
export function PhysicsVectorArrows({
  ballPosition,
  telemetry,
  visible = true,
  replayTime = 0
}) {
  if (!visible || !ballPosition) return null;

  const origin = [ballPosition.x, ballPosition.y, ballPosition.z];

  // Convert backend vectors (x=lateral, y=length, z=height) into Three.js (x=lateral, y=height, z=length)
  const toThreeCoords = (v) => {
    if (!v || v.length < 3) return [0, 0, 1];
    return [v[0], v[2], v[1]];
  };

  // 1. Velocity Vector (Cyan) - truthful representation without fabricated fallbacks
  const rawVel = telemetry?.velocity_vector;
  const hasVel = Array.isArray(rawVel) && rawVel.length === 3 && rawVel.every(Number.isFinite);
  const threeVel = hasVel ? toThreeCoords(rawVel) : null;
  const speedMs = hasVel ? Math.sqrt(rawVel[0] ** 2 + rawVel[1] ** 2 + rawVel[2] ** 2) : 0;
  const velLength = Math.max(0.25, Math.min(1.1, 0.25 + (speedMs / 40.0) * 0.55));
  const showVel = hasVel && speedMs > 0.5;

  // 2. Magnus Aerodynamic Force Vector (Neon Magenta / Pink)
  const rawMagnus = telemetry?.magnus_vector;
  const hasMagnusVec = Array.isArray(rawMagnus) && rawMagnus.length === 3 && rawMagnus.every(Number.isFinite);
  const threeMagnus = hasMagnusVec ? toThreeCoords(rawMagnus) : null;
  const magnusForceN = telemetry?.magnus_force_n ?? (hasMagnusVec ? Math.sqrt(rawMagnus[0] ** 2 + rawMagnus[1] ** 2 + rawMagnus[2] ** 2) : 0);
  const magnusLength = Math.max(0.25, Math.min(0.95, 0.25 + (magnusForceN / 0.6) * 0.45));
  const showMagnus = hasMagnusVec && magnusForceN > 0.02;

  // 3. Gravity Vector (Yellow Downward)
  const showGravity = Array.isArray(telemetry?.gravity_vector) && telemetry.gravity_vector.every(Number.isFinite) && Math.hypot(...telemetry.gravity_vector) > 0;
  const gravityDir = showGravity ? toThreeCoords(telemetry.gravity_vector) : [0, 0, 0];
  const gravityLength = 0.45;

  // 4. Spin Axis Vector (White)
  const rawSpin = telemetry?.spin_vector;
  const hasSpin = Array.isArray(rawSpin) && rawSpin.length === 3 && rawSpin.every(Number.isFinite);
  const threeSpin = hasSpin ? toThreeCoords(rawSpin) : null;
  const spinRpm = telemetry?.spin_rpm ?? null;
  const showSpin = hasSpin && spinRpm != null && spinRpm > 50;

  return (
    <group>
      {/* 1. Velocity Vector: Cyan */}
      {showVel && (
        <VectorArrow
          origin={origin}
          direction={threeVel}
          length={velLength}
          color="#00e5ff"
          radius={0.0075}
          headLength={0.08}
          headRadius={0.022}
        />
      )}

      {/* 2. Magnus Aerodynamic Lateral Drift / Dipping Force: Neon Magenta */}
      {showMagnus && (
        <VectorArrow
          origin={origin}
          direction={threeMagnus}
          length={magnusLength}
          color="#f72585"
          radius={0.008}
          headLength={0.08}
          headRadius={0.024}
        />
      )}

      {/* 3. Gravity Force: Yellow (Downward) */}
      {showGravity && (
        <VectorArrow
          origin={origin}
          direction={gravityDir}
          length={gravityLength}
          color="#ffd166"
          radius={0.0065}
          headLength={0.07}
          headRadius={0.018}
        />
      )}

      {/* 4. Spin Axis & Rotating Seam Orientation Ring: White */}
      {showSpin && (
        <SpinOrientationRing
          origin={origin}
          spinAxis={threeSpin}
          spinRpm={spinRpm}
          replayTime={replayTime}
          radius={0.048}
          color="#ffffff"
        />
      )}
    </group>
  );
}

/**
 * Real-Time Physics Telemetry Badge HUD Component (2D UI Overlay).
 * Displays Lift/Drift Force (N), Spin RPM, Reynolds Number, and vector color key.
 */
export function PhysicsTelemetryBadge({
  telemetry,
  visible = true,
  pitchType = 'standard_hard'
}) {
  if (!visible) return null;

  const magnusForceN = Number.isFinite(telemetry?.magnus_force_n)
    ? Number(telemetry.magnus_force_n).toFixed(3)
    : null;

  const spinRpm = Number.isFinite(telemetry?.spin_rpm)
    ? Math.round(telemetry.spin_rpm)
    : null;

  const reynoldsNum = Number.isFinite(telemetry?.reynolds_number)
    ? Math.round(telemetry.reynolds_number).toLocaleString()
    : null;

  const dragForceN = Number.isFinite(telemetry?.drag_force_n)
    ? Number(telemetry.drag_force_n).toFixed(3)
    : null;

  const speedKmh = Number.isFinite(telemetry?.speed_kmh)
    ? Number(telemetry.speed_kmh).toFixed(1)
    : null;

  const pitchLabels = {
    standard_hard: 'Standard Hard',
    green_seamer: 'Green Seamer (Max Seam Kick)',
    dry_dusty: 'Dry & Dusty (High Turn)',
    damp_clay: 'Damp Clay (Low Skid)'
  };

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'absolute',
        top: 80,
        left: 14,
        bgcolor: 'rgba(8, 18, 30, 0.90)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0, 229, 255, 0.25)',
        borderRadius: 2.5,
        p: 1.5,
        minWidth: 240,
        color: '#f8fafc',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.65)',
        zIndex: 10,
        pointerEvents: 'auto'
      }}
    >
      {/* Title Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, borderBottom: '1px solid rgba(255,255,255,0.1)', pb: 0.8 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
          <Waves sx={{ color: '#00e5ff', fontSize: 18 }} />
          <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.8, color: '#38bdf8', textTransform: 'uppercase' }}>
            Aerodynamics HUD
          </Typography>
        </Box>
        <Chip
          label="REAL-TIME"
          size="small"
          sx={{
            height: 18,
            fontSize: '0.62rem',
            fontWeight: 700,
            bgcolor: 'rgba(34, 197, 94, 0.2)',
            color: '#4ade80',
            border: '1px solid rgba(34, 197, 94, 0.4)'
          }}
        />
      </Box>

      {/* Key Aerodynamic Telemetry Metrics */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
        {/* Magnus Aerodynamic Force */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip title="Aerodynamic Lift / Lateral Drift force generated by ball spin (Magnus Effect)">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#f72585', boxShadow: '0 0 6px #f72585' }} />
              <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                Magnus Force:
              </Typography>
            </Box>
          </Tooltip>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#ff4d6d', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {magnusForceN != null ? `${magnusForceN} N` : '—'}
          </Typography>
        </Box>

        {/* Spin Rate */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip title="Angular rotational velocity in Revolutions Per Minute (RPM)">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <RotateRight sx={{ color: '#ffffff', fontSize: 13 }} />
              <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                Spin Rate:
              </Typography>
            </Box>
          </Tooltip>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#ffffff', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {spinRpm != null ? `${spinRpm.toLocaleString()} RPM` : '—'}
          </Typography>
        </Box>

        {/* Reynolds Number */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip title="Non-dimensional ratio of inertial to viscous air forces determining laminar-to-turbulent boundary layer transition">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Air sx={{ color: '#38bdf8', fontSize: 13 }} />
              <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                Reynolds No (Re):
              </Typography>
            </Box>
          </Tooltip>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {reynoldsNum != null ? reynoldsNum : '—'}
          </Typography>
        </Box>

        {/* Aerodynamic Air Drag */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip title="Opposing aerodynamic drag force: F_d = -0.5 * C_d * rho * A * v^2">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#94a3b8' }} />
              <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
                Air Drag:
              </Typography>
            </Box>
          </Tooltip>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#cbd5e1', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {dragForceN != null ? `${dragForceN} N` : '—'}
          </Typography>
        </Box>

        {/* Ball Speed */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
            <Speed sx={{ color: '#00e5ff', fontSize: 13 }} />
            <Typography variant="caption" sx={{ color: '#cbd5e1', fontSize: '0.72rem' }}>
              Speed:
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#00e5ff', fontSize: '0.78rem', fontFamily: 'monospace' }}>
            {speedKmh != null ? `${speedKmh} km/h` : '—'}
          </Typography>
        </Box>
      </Box>

      {/* 3D Force Vectors Color Legend */}
      <Box sx={{ mt: 1.2, pt: 0.8, borderTop: '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 10, height: 3, bgcolor: '#00e5ff', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.64rem' }}>Velocity v</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 10, height: 3, bgcolor: '#f72585', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.64rem' }}>Magnus F_M</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 10, height: 3, bgcolor: '#ffd166', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.64rem' }}>Gravity g</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 10, height: 3, bgcolor: '#ffffff', borderRadius: 1 }} />
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.64rem' }}>Spin Axis omega</Typography>
        </Box>
      </Box>

      {/* Pitch Surface indicator */}
      <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
        Model estimates. Arrows use separate visual scales for m/s, N and spin direction; lengths are not comparable across quantities.
      </Typography>
      {pitchType && (
        <Box sx={{ mt: 0.8, bgcolor: 'rgba(255,255,255,0.05)', p: 0.6, borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.62rem', display: 'block' }}>
            Turf: <strong style={{ color: '#e2e8f0' }}>{pitchLabels[pitchType] || pitchType}</strong>
          </Typography>
        </Box>
      )}
    </Paper>
  );
}

export default PhysicsVectorArrows;
