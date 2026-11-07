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
  bulletTargetMode = 'auto' // 'auto' | 'impact' | 'bounce'
}) {
  const { camera } = useThree();
  const controlsRef = useRef();

  // Internal persistent animation timers for smooth interpolation
  const sweepAngleRef = useRef(0);
  const droneProgressRef = useRef(0);
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
    const keypoints = [];

    // 1. Bowler delivery stride high perspective
    keypoints.push(new THREE.Vector3(0.35, 2.5, -13.0));
    // 2. Swoop behind bowler release point
    keypoints.push(new THREE.Vector3(0.25, 1.9, -9.0));
    // 3. Swoop low down to pitch turf
    keypoints.push(new THREE.Vector3(0.15, 0.55, -2.0));

    // 4. Banking past pitch bounce point
    if (bouncePoint) {
      keypoints.push(new THREE.Vector3(
        (bouncePoint.x || 0) + 0.32,
        Math.max(0.32, (bouncePoint.y || 0.05) + 0.25),
        (bouncePoint.z || 4.8) - 0.4
      ));
    } else {
      keypoints.push(new THREE.Vector3(0.18, 0.42, 4.8));
    }

    // 5. Swooping past pad impact
    if (impactPoint) {
      keypoints.push(new THREE.Vector3(
        (impactPoint.x || 0) + 0.22,
        Math.max(0.45, (impactPoint.y || 0.4) + 0.2),
        (impactPoint.z || 8.8) - 0.2
      ));
    } else {
      keypoints.push(new THREE.Vector3(0.10, 0.55, 8.8));
    }

    // 6. Direct rush into the batsman's stumps
    keypoints.push(new THREE.Vector3(0.0, 0.72, 10.3));
    // 7. Framing the timber and flying bails from behind
    keypoints.push(new THREE.Vector3(0.0, 0.95, 11.8));

    return new THREE.CatmullRomCurve3(keypoints, false, 'catmullrom', 0.25);
  }, [bouncePoint, impactPoint]);

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

      // Increment rotation angle smoothly (cinematic slow motion sweep)
      const sweepSpeed = 0.55; // radians per second
      sweepAngleRef.current += sweepSpeed * delta;
      const angle = sweepAngleRef.current;

      const radius = 2.1; // Orbit distance around focal point (meters)
      const focal = bulletFocalPoint;

      // Compute circular orbit with subtle cinematic wave bobbing
      const targetCamX = focal.x + radius * Math.sin(angle);
      const targetCamZ = focal.z + radius * Math.cos(angle);
      const targetCamY = focal.y + 0.38 + 0.12 * Math.sin(angle * 2.0);

      const targetCamPos = new THREE.Vector3(targetCamX, targetCamY, targetCamZ);
      const lookTarget = new THREE.Vector3(focal.x, focal.y + 0.08, focal.z);

      // Smooth interpolation using Three.js Vector3.lerp with damping
      camera.position.lerp(targetCamPos, 0.085);
      controlsRef.current.target.lerp(lookTarget, 0.085);
      controlsRef.current.update();
      return;
    }

    // -------------------------------------------------------------------------
    // Mode 2: DRONE FLYTHROUGH Dynamic Spline Fly-Cam
    // -------------------------------------------------------------------------
    if (view === 'drone_flythrough') {
      controlsRef.current.enablePan = false;

      // Swoop continuously down the pitch or sync with currentTime
      const loopDuration = 4.5; // seconds per flythrough swoop
      droneProgressRef.current = (droneProgressRef.current + delta / loopDuration) % 1.0;
      const progress = droneProgressRef.current;

      // Smooth ease-in-out curve along the spline
      // s-curve: 3p^2 - 2p^3
      const easedProgress = progress * progress * (3 - 2 * progress);

      const dronePos = droneSpline.getPoint(easedProgress);
      // Look slightly ahead along the curve for natural banking flight
      const lookAheadProgress = Math.min(1.0, easedProgress + 0.08);
      const lookTarget = droneSpline.getPoint(lookAheadProgress);

      // If moving ball is available and nearby, bias look target toward ball
      if (ballPosition) {
        lookTarget.lerp(new THREE.Vector3(ballPosition.x, ballPosition.y, ballPosition.z), 0.35);
      }

      // Smooth interpolation using Vector3.lerp
      camera.position.lerp(dronePos, 0.08);
      controlsRef.current.target.lerp(lookTarget, 0.08);
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
        ballPosition.y + 0.55,
        ballPosition.z - 2.2
      );
      const chaseTarget = new THREE.Vector3(
        ballPosition.x,
        ballPosition.y,
        ballPosition.z + 4.2
      );

      camera.position.lerp(chaseCamPos, 0.12);
      controlsRef.current.target.lerp(chaseTarget, 0.12);
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
      enableDamping={true}
      maxPolarAngle={Math.PI / 2 + 0.05}
      minDistance={1.0}
      maxDistance={70}
    />
  );
}
