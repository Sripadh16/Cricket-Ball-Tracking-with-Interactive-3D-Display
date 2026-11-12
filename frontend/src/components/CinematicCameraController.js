import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// Camera Presets dictionary including standard and cinematic modes
export const CAMERA_PRESETS = {
  orbit: { position: [7, 5, 5], target: [0, 0.4, 0], name: 'Free Orbit' },
  chase: { position: [0, 2.0, -12.0], target: [0, 0.5, 0], name: 'Chase Cam' },
  batsman: { position: [0, 1.6, 9.2], target: [0, 1.2, -10], name: 'Batsman POV' },
  umpire: { position: [0, 1.7, 13.5], target: [0, 0.6, 0], name: 'Umpire' },
  bowler: { position: [0, 1.8, -13.5], target: [0, 0.6, 0], name: 'Bowler' },
  side: { position: [14, 3.5, 2], target: [0, 0.5, 2], name: 'Side Arc' },
  aerial: { position: [0, 22, 0], target: [0, 0, 0], name: 'Pitch Map' },
  impact: { position: [1.8, 0.85, 9.8], target: [0, 0.45, 9.1], name: 'Impact Zoom' },
  bullet_time: { position: [2.2, 0.9, 9.2], target: [0, 0.45, 8.8], name: 'Bullet Time' },
  drone_flythrough: { position: [0.35, 2.4, -12.5], target: [0, 0.6, 0], name: 'Drone Cam' }
};

/**
 * CinematicCameraController
 * 
 * Supports:
 * 1. Standard Static/Orbit Camera Views (orbit, batsman, umpire, bowler, side, aerial, impact)
 * 2. Ball Chase Cam: trailing directly behind the ball with dynamic look-ahead
 * 3. Bullet Time 360° Sweep: Matrix-style continuous orbit around impact / bounce point in slow motion
 * 4. Drone Flythrough: Dynamic spline fly-cam swooping low along the pitch from bowler release into stumps
 */
export default function CinematicCameraController({
  view = 'orbit',
  ballPosition,
  bouncePoint,
  impactPoint,
  trajectoryPoints = [],
  currentTime = 0,
  duration = 1.5,
  isPlaying = false,
  isSeeking = false,
  bulletTargetMode = 'auto' // 'auto' | 'impact' | 'bounce'
}) {
  const { camera } = useThree();
  const controlsRef = useRef();

  // Internal persistent animation timers for smooth interpolation
  const prevViewRef = useRef(view);

  // Determine bullet time focal point (in Three.js coordinates)
  const bulletFocalPoint = useMemo(() => {
    // Priority: impact point -> bounce point -> default crease
    if (bulletTargetMode === 'bounce' && bouncePoint) {
      return new THREE.Vector3(bouncePoint.x || 0, Math.max(0.04, bouncePoint.y || 0.04), bouncePoint.z || 4.8);
    }
    if (impactPoint) {
      return new THREE.Vector3(impactPoint.x || 0, Math.max(0.15, impactPoint.y || 0.45), impactPoint.z || 8.8);
    }
    if (bouncePoint) {
      return new THREE.Vector3(bouncePoint.x || 0, Math.max(0.04, bouncePoint.y || 0.04), bouncePoint.z || 4.8);
    }
    return new THREE.Vector3(0, 0.45, 8.8);
  }, [bouncePoint, impactPoint, bulletTargetMode]);

  // Construct dynamic Catmull-Rom spline curve for the Drone Flythrough
  const droneSpline = useMemo(() => {
    const keypoints = [
      new THREE.Vector3(4.5, 5, -12),
      new THREE.Vector3(4, 4.5, -5),
      new THREE.Vector3(3.5, 3.8, 3),
      new THREE.Vector3(3, 3.2, 11)
    ];

    return new THREE.CatmullRomCurve3(keypoints, false, 'catmullrom', 0.25);
  }, []);

  // Handle switching to static presets smoothly
  useEffect(() => {
    if (view === 'chase' || view === 'bullet_time' || view === 'drone_flythrough') {
      // Dynamic modes handled per-frame
      prevViewRef.current = view;
      return;
    }

    const preset = CAMERA_PRESETS[view];
    if (preset && camera) {
      // If switching from another view, smoothly transition or position
      camera.position.set(...preset.position);
      if (controlsRef.current) {
        controlsRef.current.target.set(...preset.target);
        controlsRef.current.update();
      }
    }
    prevViewRef.current = view;
  }, [view, camera]);

  // Per-frame cinematic animation loop
  useFrame((state, delta) => {
    if (!camera || !controlsRef.current) return;

    // -------------------------------------------------------------------------
    // Mode 1: BULLET TIME 360° Matrix-style Orbit Sweep
    // -------------------------------------------------------------------------
    if (view === 'bullet_time') {
      // Disable user pan during cinematic sweep
      controlsRef.current.enablePan = false;

      // Progress derived directly from replay time so seeking/pausing is deterministic
      const normProgress = Math.max(0, Math.min(1, currentTime / Math.max(0.1, duration)));
      const eased = normProgress * normProgress * (3 - 2 * normProgress);
      const angle = -0.7 + eased * 1.75;

      const radius = 2.1; // Orbit distance around focal point (meters)
      const focal = bulletFocalPoint;

      // Compute circular orbit with subtle cinematic wave bobbing
      const targetCamX = focal.x + radius * Math.sin(angle);
      const targetCamZ = focal.z + radius * Math.cos(angle);
      const targetCamY = focal.y + 0.7;

      const targetCamPos = new THREE.Vector3(targetCamX, targetCamY, targetCamZ);
      const lookTarget = new THREE.Vector3(focal.x, focal.y + 0.08, focal.z);

      camera.position.copy(targetCamPos);
      controlsRef.current.target.copy(lookTarget);
      controlsRef.current.update();
      return;
    }

    // -------------------------------------------------------------------------
    // Mode 2: DRONE FLYTHROUGH Dynamic Spline Fly-Cam
    // -------------------------------------------------------------------------
    if (view === 'drone_flythrough') {
      controlsRef.current.enablePan = false;

      // Progress tied deterministically to delivery replay timestamp
      const progress = Math.max(0, Math.min(1, currentTime / Math.max(0.1, duration)));

      // Smooth ease-in-out curve along the spline
      const easedProgress = progress * progress * (3 - 2 * progress);

      const dronePos = droneSpline.getPointAt(easedProgress);
      const lookTarget = new THREE.Vector3(0, 0.45, -8 + easedProgress * 18);

      camera.position.copy(dronePos);
      controlsRef.current.target.copy(lookTarget);
      controlsRef.current.update();
      return;
    }

    // -------------------------------------------------------------------------
    // Mode 3: CHASE CAM (Third-Person Dynamic Ball Tracking)
    // -------------------------------------------------------------------------
    if (view === 'chase' && ballPosition) {
      controlsRef.current.enablePan = true;

      // Position camera slightly behind and above the ball
      const chaseCamPos = new THREE.Vector3(
        ballPosition.x * 0.7,
        ballPosition.y + 1.15,
        ballPosition.z - 4.0
      );
      const chaseTarget = new THREE.Vector3(
        ballPosition.x,
        ballPosition.y,
        ballPosition.z + 4.2
      );

      camera.position.copy(chaseCamPos);
      controlsRef.current.target.copy(chaseTarget);
      controlsRef.current.update();
      return;
    }

    // Mode 4: Standard Orbit Controls
    controlsRef.current.enablePan = true;
  });

  return (
    <OrbitControls
      ref={controlsRef}
      enablePan={true}
      enableZoom={true}
      dampingFactor={0.08}
      enableDamping={view === 'orbit'}
      maxPolarAngle={Math.PI / 2 + 0.05}
      minDistance={1.0}
      maxDistance={70}
    />
  );
}
