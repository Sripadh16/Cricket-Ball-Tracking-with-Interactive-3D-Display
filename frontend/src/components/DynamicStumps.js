import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Standard Cricket Stumps Dimensions (meters)
const STUMP_HEIGHT = 0.711; // 28 inches
const STUMP_RADIUS = 0.018; // 3.6cm diameter
const STUMP_SPACING = 0.057; // 5.7cm apart
const BAIL_LENGTH = 0.054;
const BAIL_RADIUS = 0.006;

// Initial resting positions and orientations
const INITIAL_BODIES = {
  leg: {
    name: 'Leg Stump',
    basePos: [-STUMP_SPACING, STUMP_HEIGHT / 2, 0],
    baseRot: [0, 0, 0]
  },
  middle: {
    name: 'Middle Stump',
    basePos: [0, STUMP_HEIGHT / 2, 0],
    baseRot: [0, 0, 0]
  },
  off: {
    name: 'Off Stump',
    basePos: [STUMP_SPACING, STUMP_HEIGHT / 2, 0],
    baseRot: [0, 0, 0]
  },
  leftBail: {
    name: 'Left Bail',
    basePos: [-0.0285, STUMP_HEIGHT + 0.012, 0],
    baseRot: [0, 0, Math.PI / 2]
  },
  rightBail: {
    name: 'Right Bail',
    basePos: [0.0285, STUMP_HEIGHT + 0.012, 0],
    baseRot: [0, 0, Math.PI / 2]
  }
};

/**
 * Smart Dynamic Zing Stumps & Bails with Rigid-Body Impact Physics
 *
 * Features:
 * - High-intensity embedded Red Zing LEDs on stumps and bails.
 * - Point light illumination casting dramatic crimson glow across pitch upon impact.
 * - Interactive 3D "Shatter Stumps" physics simulation:
 *   * Stumps tilt and tumble with realistic gravity (g = 9.8 m/s²) and ground restitution bounces.
 *   * Lightweight bails catapult upwards and cartwheel through the air.
 * - Triggered automatically when trajectory verdict is "HITTING" or "BOWLED" as ball reaches stumps,
 *   or interactively via manual trigger button or direct 3D mesh click.
 * - Re-erect / reset capability restoring wickets to pristine upright stance.
 */
const DynamicStumps = forwardRef(function DynamicStumps(
  {
    position = [0, 0, 0],
    isTargetEnd = false,
    hitStump = 'None',
    drsVerdict = null,
    currentBallPos = null,
    shatterTrigger = false,
    onShatter = null,
    onReset = null,
    autoShatter = true
  },
  ref
) {
  // Mesh refs for each body part
  const legRef = useRef();
  const middleRef = useRef();
  const offRef = useRef();
  const leftBailRef = useRef();
  const rightBailRef = useRef();
  const pointLightRef = useRef();

  // Physics simulation state for all 5 pieces
  const physicsState = useRef({
    isShattered: false,
    ledActive: false,
    flashIntensity: 0,
    hasAutoTriggered: false,
    bodies: {
      leg: {
        pos: new THREE.Vector3(...INITIAL_BODIES.leg.basePos),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(...INITIAL_BODIES.leg.baseRot),
        angVel: new THREE.Vector3(0, 0, 0),
        resting: true
      },
      middle: {
        pos: new THREE.Vector3(...INITIAL_BODIES.middle.basePos),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(...INITIAL_BODIES.middle.baseRot),
        angVel: new THREE.Vector3(0, 0, 0),
        resting: true
      },
      off: {
        pos: new THREE.Vector3(...INITIAL_BODIES.off.basePos),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(...INITIAL_BODIES.off.baseRot),
        angVel: new THREE.Vector3(0, 0, 0),
        resting: true
      },
      leftBail: {
        pos: new THREE.Vector3(...INITIAL_BODIES.leftBail.basePos),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(...INITIAL_BODIES.leftBail.baseRot),
        angVel: new THREE.Vector3(0, 0, 0),
        resting: true
      },
      rightBail: {
        pos: new THREE.Vector3(...INITIAL_BODIES.rightBail.basePos),
        vel: new THREE.Vector3(0, 0, 0),
        rot: new THREE.Euler(...INITIAL_BODIES.rightBail.baseRot),
        angVel: new THREE.Vector3(0, 0, 0),
        resting: true
      }
    }
  });

  const [isShatteredState, setIsShatteredState] = useState(false);

  // Trigger Shatter Physics
  const shatter = useCallback((impulseStrength = 1.0) => {
    const s = physicsState.current;
    if (s.isShattered) return;

    s.isShattered = true;
    s.ledActive = true;
    s.flashIntensity = 2.5;
    setIsShatteredState(true);

    // Determine impact bias (middle, off, or leg)
    const hit = (hitStump || '').toLowerCase();
    const isOffHit = hit.includes('off');
    const isLegHit = hit.includes('leg');

    // Middle Stump: pushed backward with violent cartwheel
    s.bodies.middle.vel.set(
      (Math.random() - 0.5) * 0.8 * impulseStrength,
      (1.8 + Math.random() * 1.2) * impulseStrength,
      (3.6 + Math.random() * 1.8) * impulseStrength
    );
    s.bodies.middle.angVel.set(
      -(6 + Math.random() * 5),
      (Math.random() - 0.5) * 4,
      (Math.random() - 0.5) * 6
    );
    s.bodies.middle.resting = false;

    // Off Stump: pushed backward and tilted outward to off-side (+X)
    s.bodies.off.vel.set(
      (1.4 + Math.random() * 1.0) * (isOffHit ? 1.5 : 1.0) * impulseStrength,
      (2.0 + Math.random() * 1.0) * impulseStrength,
      (2.8 + Math.random() * 1.4) * impulseStrength
    );
    s.bodies.off.angVel.set(-5, 4, -(7 + Math.random() * 6));
    s.bodies.off.resting = false;

    // Leg Stump: pushed backward and tilted outward to leg-side (-X)
    s.bodies.leg.vel.set(
      -(1.4 + Math.random() * 1.0) * (isLegHit ? 1.5 : 1.0) * impulseStrength,
      (2.0 + Math.random() * 1.0) * impulseStrength,
      (2.8 + Math.random() * 1.4) * impulseStrength
    );
    s.bodies.leg.angVel.set(-5, -4, (7 + Math.random() * 6));
    s.bodies.leg.resting = false;

    // Left Bail: Lightweight, flies high with rapid tumble
    s.bodies.leftBail.vel.set(
      (-1.2 + (Math.random() - 0.5) * 1.2) * impulseStrength,
      (5.4 + Math.random() * 2.2) * impulseStrength,
      (2.2 + Math.random() * 1.6) * impulseStrength
    );
    s.bodies.leftBail.angVel.set(16, 10, 22);
    s.bodies.leftBail.resting = false;

    // Right Bail: Flies high and away
    s.bodies.rightBail.vel.set(
      (1.2 + (Math.random() - 0.5) * 1.2) * impulseStrength,
      (5.8 + Math.random() * 2.2) * impulseStrength,
      (2.4 + Math.random() * 1.6) * impulseStrength
    );
    s.bodies.rightBail.angVel.set(-18, -8, -24);
    s.bodies.rightBail.resting = false;

    if (onShatter) onShatter();
  }, [hitStump, onShatter]);

  // Reset / Re-erect Wickets
  const reset = useCallback(() => {
    const s = physicsState.current;
    s.isShattered = false;
    s.ledActive = false;
    s.flashIntensity = 0;
    s.hasAutoTriggered = false;
    setIsShatteredState(false);

    Object.keys(INITIAL_BODIES).forEach((key) => {
      s.bodies[key].pos.set(...INITIAL_BODIES[key].basePos);
      s.bodies[key].vel.set(0, 0, 0);
      s.bodies[key].rot.set(...INITIAL_BODIES[key].baseRot);
      s.bodies[key].angVel.set(0, 0, 0);
      s.bodies[key].resting = true;
    });

    // Reset visual mesh transforms
    if (legRef.current) {
      legRef.current.position.set(...INITIAL_BODIES.leg.basePos);
      legRef.current.rotation.set(...INITIAL_BODIES.leg.baseRot);
    }
    if (middleRef.current) {
      middleRef.current.position.set(...INITIAL_BODIES.middle.basePos);
      middleRef.current.rotation.set(...INITIAL_BODIES.middle.baseRot);
    }
    if (offRef.current) {
      offRef.current.position.set(...INITIAL_BODIES.off.basePos);
      offRef.current.rotation.set(...INITIAL_BODIES.off.baseRot);
    }
    if (leftBailRef.current) {
      leftBailRef.current.position.set(...INITIAL_BODIES.leftBail.basePos);
      leftBailRef.current.rotation.set(...INITIAL_BODIES.leftBail.baseRot);
    }
    if (rightBailRef.current) {
      rightBailRef.current.position.set(...INITIAL_BODIES.rightBail.basePos);
      rightBailRef.current.rotation.set(...INITIAL_BODIES.rightBail.baseRot);
    }

    if (onReset) onReset();
  }, [onReset]);

  // Expose imperative API to parent via ref
  useImperativeHandle(ref, () => ({
    shatter: (strength) => shatter(strength),
    reset: () => reset(),
    isShattered: () => physicsState.current.isShattered
  }));

  // Watch shatterTrigger prop from parent
  useEffect(() => {
    if (shatterTrigger && !physicsState.current.isShattered) {
      shatter();
    }
  }, [shatterTrigger, shatter]);

  // Frame physics update loop (Gravity, Rigid-Body Euler Integration, Restitution)
  useFrame((state, delta) => {
    const s = physicsState.current;
    const dt = Math.min(delta, 0.04); // clamp frame drop
    const g = 9.8; // Standard realistic gravity (m/s²)

    // Automatic trigger detection:
    // If target end and ball arrives at stumps (Z >= 9.85m), check if verdict is HITTING or BOWLED
    if (isTargetEnd && autoShatter && !s.hasAutoTriggered && !s.isShattered && currentBallPos) {
      const isNearStumpsZ = Math.abs(currentBallPos.z - position[2]) < 0.35;
      const isStumpsHeight = currentBallPos.y <= STUMP_HEIGHT + 0.08 && currentBallPos.y >= 0;
      const isStumpsWidth = Math.abs(currentBallPos.x - position[0]) <= 0.16;

      const verdictHitting =
        drsVerdict?.wickets === 'HITTING' ||
        drsVerdict?.decision?.includes('OUT') ||
        hitStump !== 'None';

      if (isNearStumpsZ && isStumpsHeight && isStumpsWidth && verdictHitting) {
        s.hasAutoTriggered = true;
        shatter(1.1);
      } else if (isNearStumpsZ && isStumpsHeight && isStumpsWidth) {
        // Flash LEDs on ball graze / close proximity
        s.ledActive = true;
        s.flashIntensity = 1.2;
      }
    }

    // Decay flash intensity smoothly
    if (s.ledActive && !s.isShattered) {
      s.flashIntensity = Math.max(0, s.flashIntensity - dt * 2.0);
      if (s.flashIntensity <= 0) s.ledActive = false;
    }

    // Point Light strobe effect when active
    if (pointLightRef.current) {
      if (s.ledActive) {
        const strobe = 1.8 + Math.sin(state.clock.getElapsedTime() * 30) * 0.7;
        pointLightRef.current.intensity = s.isShattered ? strobe * 2.2 : s.flashIntensity * 2.0;
      } else {
        pointLightRef.current.intensity = 0;
      }
    }

    // Only update body integration if shattered
    if (!s.isShattered) return;

    // Helper to integrate single rigid body
    const integrateBody = (meshRef, body, groundFloor, restitution) => {
      if (!meshRef.current || body.resting) return;

      // Gravity
      body.vel.y -= g * dt;

      // Air resistance
      body.vel.x *= Math.pow(0.985, dt * 60);
      body.vel.z *= Math.pow(0.985, dt * 60);

      // Position update
      body.pos.x += body.vel.x * dt;
      body.pos.y += body.vel.y * dt;
      body.pos.z += body.vel.z * dt;

      // Rotation update
      body.rot.x += body.angVel.x * dt;
      body.rot.y += body.angVel.y * dt;
      body.rot.z += body.angVel.z * dt;

      // Pitch Ground Collision
      if (body.pos.y <= groundFloor) {
        body.pos.y = groundFloor;
        // Bounce restitution
        body.vel.y = -body.vel.y * restitution;

        // Ground friction
        body.vel.x *= 0.62;
        body.vel.z *= 0.62;
        body.angVel.x *= 0.65;
        body.angVel.y *= 0.65;
        body.angVel.z *= 0.65;

        // Sleep check
        if (Math.abs(body.vel.y) < 0.15 && Math.abs(body.vel.x) < 0.1 && Math.abs(body.vel.z) < 0.1) {
          body.vel.set(0, 0, 0);
          body.angVel.set(0, 0, 0);
          body.resting = true;
        }
      }

      // Sync Three.js mesh
      meshRef.current.position.copy(body.pos);
      meshRef.current.rotation.copy(body.rot);
    };

    // Integrate all 3 Stumps (ground height ~ 0.05m radius offset)
    integrateBody(legRef, s.bodies.leg, 0.045, 0.32);
    integrateBody(middleRef, s.bodies.middle, 0.045, 0.32);
    integrateBody(offRef, s.bodies.off, 0.045, 0.32);

    // Integrate 2 Bails (ground height ~ 0.008m radius offset)
    integrateBody(leftBailRef, s.bodies.leftBail, 0.008, 0.42);
    integrateBody(rightBailRef, s.bodies.rightBail, 0.008, 0.42);
  });

  const isLit = physicsState.current.ledActive || isShatteredState;
  const ledColor = '#ff1744'; // High intensity Red Zing LED
  const woodColor = '#d4a373';

  return (
    <group position={position}>
      {/* Dynamic Red Point Light Illuminating Pitch and Stumps */}
      <pointLight
        ref={pointLightRef}
        position={[0, STUMP_HEIGHT * 0.7, 0]}
        color={ledColor}
        intensity={0}
        distance={4.0}
        decay={2}
      />

      {/* ================================================================= */}
      {/* 1. LEG STUMP                                                      */}
      {/* ================================================================= */}
      <group
        ref={legRef}
        position={INITIAL_BODIES.leg.basePos}
        onClick={() => shatter(1.0)}
      >
        {/* Main Wood Post */}
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[STUMP_RADIUS, STUMP_RADIUS, STUMP_HEIGHT, 16]} />
          <meshStandardMaterial
            color={isLit ? '#ff2a55' : woodColor}
            roughness={0.35}
            metalness={0.15}
            emissive={isLit ? ledColor : '#000000'}
            emissiveIntensity={isLit ? 0.7 : 0}
          />
        </mesh>

        {/* Embedded Red Zing LED Center Strip (Front Face) */}
        <mesh position={[0, 0, -STUMP_RADIUS - 0.001]}>
          <boxGeometry args={[0.008, STUMP_HEIGHT * 0.85, 0.003]} />
          <meshStandardMaterial
            color={isLit ? '#ffffff' : '#450a0a'}
            emissive={ledColor}
            emissiveIntensity={isLit ? 3.0 : 0.05}
            roughness={0.2}
          />
        </mesh>

        {/* Ground Spike Pin (Bottom) */}
        <mesh position={[0, -STUMP_HEIGHT / 2 - 0.02, 0]}>
          <cylinderGeometry args={[0.008, 0.002, 0.04, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} />
        </mesh>

        {/* Top Groove Spigot Cup */}
        <mesh position={[0, STUMP_HEIGHT / 2 + 0.006, 0]}>
          <cylinderGeometry args={[STUMP_RADIUS * 0.85, STUMP_RADIUS, 0.012, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.5} />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 2. MIDDLE STUMP                                                   */}
      {/* ================================================================= */}
      <group
        ref={middleRef}
        position={INITIAL_BODIES.middle.basePos}
        onClick={() => shatter(1.0)}
      >
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[STUMP_RADIUS, STUMP_RADIUS, STUMP_HEIGHT, 16]} />
          <meshStandardMaterial
            color={isLit ? '#ff2a55' : woodColor}
            roughness={0.35}
            metalness={0.15}
            emissive={isLit ? ledColor : '#000000'}
            emissiveIntensity={isLit ? 0.7 : 0}
          />
        </mesh>

        {/* Embedded Red Zing LED Center Strip */}
        <mesh position={[0, 0, -STUMP_RADIUS - 0.001]}>
          <boxGeometry args={[0.008, STUMP_HEIGHT * 0.85, 0.003]} />
          <meshStandardMaterial
            color={isLit ? '#ffffff' : '#450a0a'}
            emissive={ledColor}
            emissiveIntensity={isLit ? 3.0 : 0.05}
            roughness={0.2}
          />
        </mesh>

        <mesh position={[0, -STUMP_HEIGHT / 2 - 0.02, 0]}>
          <cylinderGeometry args={[0.008, 0.002, 0.04, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} />
        </mesh>

        <mesh position={[0, STUMP_HEIGHT / 2 + 0.006, 0]}>
          <cylinderGeometry args={[STUMP_RADIUS * 0.85, STUMP_RADIUS, 0.012, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.5} />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 3. OFF STUMP                                                      */}
      {/* ================================================================= */}
      <group
        ref={offRef}
        position={INITIAL_BODIES.off.basePos}
        onClick={() => shatter(1.0)}
      >
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[STUMP_RADIUS, STUMP_RADIUS, STUMP_HEIGHT, 16]} />
          <meshStandardMaterial
            color={isLit ? '#ff2a55' : woodColor}
            roughness={0.35}
            metalness={0.15}
            emissive={isLit ? ledColor : '#000000'}
            emissiveIntensity={isLit ? 0.7 : 0}
          />
        </mesh>

        {/* Embedded Red Zing LED Center Strip */}
        <mesh position={[0, 0, -STUMP_RADIUS - 0.001]}>
          <boxGeometry args={[0.008, STUMP_HEIGHT * 0.85, 0.003]} />
          <meshStandardMaterial
            color={isLit ? '#ffffff' : '#450a0a'}
            emissive={ledColor}
            emissiveIntensity={isLit ? 3.0 : 0.05}
            roughness={0.2}
          />
        </mesh>

        <mesh position={[0, -STUMP_HEIGHT / 2 - 0.02, 0]}>
          <cylinderGeometry args={[0.008, 0.002, 0.04, 12]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} />
        </mesh>

        <mesh position={[0, STUMP_HEIGHT / 2 + 0.006, 0]}>
          <cylinderGeometry args={[STUMP_RADIUS * 0.85, STUMP_RADIUS, 0.012, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.5} />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 4. LEFT ZING BAIL (Polycarbonate Barrel + Micro LED Spigots)     */}
      {/* ================================================================= */}
      <group
        ref={leftBailRef}
        position={INITIAL_BODIES.leftBail.basePos}
        rotation={INITIAL_BODIES.leftBail.baseRot}
        onClick={() => shatter(1.0)}
      >
        {/* Polycarbonate clear bail casing */}
        <mesh castShadow>
          <cylinderGeometry args={[BAIL_RADIUS, BAIL_RADIUS, BAIL_LENGTH, 12]} />
          <meshStandardMaterial
            color={isLit ? '#ff4d6d' : '#faedcd'}
            roughness={0.2}
            metalness={0.1}
            transparent
            opacity={0.92}
            emissive={isLit ? ledColor : '#000000'}
            emissiveIntensity={isLit ? 2.5 : 0}
          />
        </mesh>

        {/* Internal High-Output Red LED Core */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[BAIL_RADIUS * 0.5, BAIL_RADIUS * 0.5, BAIL_LENGTH * 0.75, 8]} />
          <meshStandardMaterial
            color={isLit ? '#ffffff' : '#7f1d1d'}
            emissive={ledColor}
            emissiveIntensity={isLit ? 3.5 : 0.1}
          />
        </mesh>

        {/* End Spigots (Resting pins) */}
        {[-BAIL_LENGTH / 2, BAIL_LENGTH / 2].map((sy, sidx) => (
          <mesh key={sidx} position={[0, sy, 0]}>
            <cylinderGeometry args={[0.0035, 0.0035, 0.008, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} />
          </mesh>
        ))}
      </group>

      {/* ================================================================= */}
      {/* 5. RIGHT ZING BAIL                                                */}
      {/* ================================================================= */}
      <group
        ref={rightBailRef}
        position={INITIAL_BODIES.rightBail.basePos}
        rotation={INITIAL_BODIES.rightBail.baseRot}
        onClick={() => shatter(1.0)}
      >
        <mesh castShadow>
          <cylinderGeometry args={[BAIL_RADIUS, BAIL_RADIUS, BAIL_LENGTH, 12]} />
          <meshStandardMaterial
            color={isLit ? '#ff4d6d' : '#faedcd'}
            roughness={0.2}
            metalness={0.1}
            transparent
            opacity={0.92}
            emissive={isLit ? ledColor : '#000000'}
            emissiveIntensity={isLit ? 2.5 : 0}
          />
        </mesh>

        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[BAIL_RADIUS * 0.5, BAIL_RADIUS * 0.5, BAIL_LENGTH * 0.75, 8]} />
          <meshStandardMaterial
            color={isLit ? '#ffffff' : '#7f1d1d'}
            emissive={ledColor}
            emissiveIntensity={isLit ? 3.5 : 0.1}
          />
        </mesh>

        {[-BAIL_LENGTH / 2, BAIL_LENGTH / 2].map((sy, sidx) => (
          <mesh key={sidx} position={[0, sy, 0]}>
            <cylinderGeometry args={[0.0035, 0.0035, 0.008, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Clickable Invisible Hitbox to easily trigger / test shattering */}
      <mesh position={[0, STUMP_HEIGHT / 2, 0]} onClick={() => (isShatteredState ? reset() : shatter())} visible={false}>
        <boxGeometry args={[STUMP_SPACING * 3, STUMP_HEIGHT * 1.2, 0.15]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
});

export default DynamicStumps;
