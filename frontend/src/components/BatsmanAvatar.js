import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { strokeEnvelope } from '../utils/replayMotion';
import * as THREE from 'three';

// Procedural dynamic canvas texture for athletic team jersey back
function createJerseyNumberTexture(number = '18', name = 'HAWK-EYE') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Background gradient (Royal Team Blue)
  const grad = ctx.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#1e3a8a');
  grad.addColorStop(1, '#0f172a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Athletic accent stripes
  ctx.fillStyle = '#f59e0b'; // Gold
  ctx.fillRect(40, 20, 432, 8);
  ctx.fillStyle = '#38bdf8'; // Sky blue
  ctx.fillRect(60, 36, 392, 4);

  // Player Name
  ctx.font = 'bold 44px "Arial Black", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '6px';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 8;
  ctx.fillText(name, 256, 110);

  // Player Number with double outline
  ctx.font = '900 230px "Arial Black", sans-serif';
  ctx.letterSpacing = '-4px';
  // Gold outer shadow/stroke
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#f59e0b';
  ctx.strokeText(number, 256, 350);
  // White body
  ctx.fillStyle = '#ffffff';
  ctx.fillText(number, 256, 350);

  // ICC / HawkEye DRS emblem at bottom
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('★ DRS OFFICIAL ★', 256, 440);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Procedural texture for Willow Bat decals & grain
function createBatDecalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Natural English Willow base
  ctx.fillStyle = '#f4e3c1';
  ctx.fillRect(0, 0, 256, 512);

  // Subtle wood grain lines
  ctx.strokeStyle = '#e6cda3';
  ctx.lineWidth = 1.5;
  for (let x = 12; x < 256; x += 18) {
    ctx.beginPath();
    ctx.moveTo(x + (Math.random() * 4 - 2), 0);
    ctx.bezierCurveTo(
      x + 4, 180,
      x - 4, 340,
      x + (Math.random() * 4 - 2), 512
    );
    ctx.stroke();
  }

  // Central chevron branding sticker (Kookaburra / Gray-Nicolls style)
  ctx.fillStyle = '#e11d48'; // Chrome Crimson
  ctx.beginPath();
  ctx.moveTo(128, 60);
  ctx.lineTo(210, 160);
  ctx.lineTo(170, 160);
  ctx.lineTo(128, 105);
  ctx.lineTo(86, 160);
  ctx.lineTo(46, 160);
  ctx.closePath();
  ctx.fill();

  // Gold accent streak
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(128, 115);
  ctx.lineTo(190, 195);
  ctx.lineTo(165, 195);
  ctx.lineTo(128, 150);
  ctx.lineTo(91, 195);
  ctx.lineTo(66, 195);
  ctx.closePath();
  ctx.fill();

  // Bold brand banner
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(40, 215, 176, 44);
  ctx.font = '900 24px "Arial Black", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText('WILLOW', 128, 246);

  // Red edge stripe
  ctx.fillStyle = '#e11d48';
  ctx.fillRect(20, 275, 216, 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Procedural 3D Cricket Batsman Avatar
 *
 * Features:
 * - Visor Helmet with titanium wire grill, ear pads, and peak.
 * - Athletic team jersey with dynamic player number backplate & crest.
 * - Padded batting sausage-finger gloves gripping the willow handle.
 * - English willow cricket bat with cane handle, colored grip, and backlift angle.
 * - Integrated seamless 3D cricket batting pads with cane bolsters & impact flashing.
 * - Stance prop: 'right_hand' | 'left_hand' (mirrors across pitch width).
 * - Bat swing / leave / defend animation with smooth kinematics.
 */
export default function BatsmanAvatar({
  stance = 'right_hand',
  impactPoint = null,
  currentBallPos = null,
  currentTime = 0,
  contactTime = 0,
  autoAction = 'backlift',
  reducedMotion = false,
  batAction = 'auto', // 'auto' | 'defend' | 'leave' | 'drive' | 'backlift'
  visible = true,
  onSelectPoint = null,
  playerNumber = '18',
  playerName = 'VIRAT'
}) {
  const batRigRef = useRef();
  const headRef = useRef();

  const isLeftHand = stance === 'left_hand';
  const stanceDir = isLeftHand ? -1 : 1;

  // Base crease coordinates
  // Popping crease is at Z = 8.84m
  const stanceZ = impactPoint ? impactPoint.z : 8.84;
  const stanceX = (impactPoint ? impactPoint.x * 0.45 : 0.08) * (isLeftHand ? -1 : 1);

  // Dynamic impact detection for pad flashing
  const isImpacted = useMemo(() => {
    if (!impactPoint || !currentBallPos) return false;
    const dz = Math.abs(currentBallPos.z - impactPoint.z);
    const dy = Math.abs(currentBallPos.y - impactPoint.y);
    const dx = Math.abs(currentBallPos.x - impactPoint.x);
    return dx < 0.08 && dz < 0.08 && dy < 0.08;
  }, [impactPoint, currentBallPos]);

  // Procedural textures
  const jerseyTexture = useMemo(
    () => createJerseyNumberTexture(playerNumber, playerName),
    [playerNumber, playerName]
  );
  const batTexture = useMemo(() => createBatDecalTexture(), []);

  // Frame animation loop for bat swing / leave / forward defence kinematics
  useFrame((_, delta) => {
    if (!batRigRef.current) return;

    // Determine current target stroke based on batAction or ball proximity
    let targetStroke = batAction;
    if (batAction === 'auto') targetStroke = autoAction;

    // Kinematic target transforms for Bat Rig
    let targetRotX = 0;
    let targetRotY = 0;
    let targetRotZ = 0;
    let targetPosX = 0;
    let targetPosY = 0;
    let targetPosZ = 0;

    switch (targetStroke) {
      case 'defend':
        // Forward defensive: bat swings down to meet ball at front pad, face turned downward
        targetRotX = 0.58; // tilted forward down
        targetRotY = stanceDir * -0.25;
        targetRotZ = stanceDir * -0.15;
        targetPosX = stanceDir * -0.12;
        targetPosY = -0.24;
        targetPosZ = -0.32;
        break;

      case 'drive':
        // Full flowing cover / on-drive through the line
        targetRotX = 0.85;
        targetRotY = stanceDir * -0.45;
        targetRotZ = stanceDir * -0.28;
        targetPosX = stanceDir * -0.16;
        targetPosY = -0.18;
        targetPosZ = -0.42;
        break;

      case 'leave':
        // Shoulder arms / duck: hands pulled up high to chest, bat held vertical high outside line
        targetRotX = -0.92; // bat pointed up high
        targetRotY = stanceDir * 0.35;
        targetRotZ = stanceDir * 0.45;
        targetPosX = stanceDir * 0.14;
        targetPosY = 0.22;
        targetPosZ = 0.12;
        break;

      case 'backlift':
      default:
        // Poised backlift stance: bat raised behind rear hip at ~30° angle
        targetRotX = -0.42;
        targetRotY = stanceDir * 0.22;
        targetRotZ = stanceDir * 0.28;
        targetPosX = 0;
        targetPosY = 0;
        targetPosZ = 0;
        break;
    }

    // One continuous stroke envelope, evaluated at replay time rather than frame delta.
    const blend = reducedMotion ? 0 : strokeEnvelope(currentTime, contactTime);
    batRigRef.current.rotation.set(
      THREE.MathUtils.lerp(-0.42, targetRotX, blend),
      THREE.MathUtils.lerp(stanceDir * 0.22, targetRotY, blend),
      THREE.MathUtils.lerp(stanceDir * 0.28, targetRotZ, blend)
    );
    batRigRef.current.position.set(targetPosX * blend, targetPosY * blend, targetPosZ * blend);
    if (headRef.current) {
      const look = currentBallPos ? THREE.MathUtils.clamp((currentBallPos.x - stanceX) * 0.15, -0.25, 0.25) : 0;
      headRef.current.rotation.y = reducedMotion ? 0 : look * stanceDir;
    }
  });

  if (!visible) return null;

  // Stance layout coordinates
  // Front leg (leading towards bowler at -Z)
  const frontLegX = stanceDir * -0.09;
  const frontLegZ = -0.08;
  // Back leg (trailing towards stumps at +Z)
  const backLegX = stanceDir * 0.11;
  const backLegZ = 0.16;

  // Materials
  const skinMaterial = (
    <meshStandardMaterial color="#d49a6a" roughness={0.65} metalness={0.05} />
  );
  const jerseyBlue = '#1e3a8a';
  const jerseyAccent = '#f59e0b';
  const trouserColor = '#f8fafc';
  const gloveColor = '#ffffff';

  return (
    <group
      position={[stanceX, 0, stanceZ]}
      onClick={() => onSelectPoint && impactPoint && onSelectPoint(impactPoint)}
    >
      {/* ================================================================= */}
      {/* 1. CRICKET FOOTWEAR & SPIKES                                      */}
      {/* ================================================================= */}
      {/* Front Foot (angled slightly towards cover/bowler) */}
      <group position={[frontLegX, 0, frontLegZ]} rotation={[0, stanceDir * 0.28, 0]}>
        <mesh position={[0, 0.035, -0.03]} castShadow>
          <boxGeometry args={[0.095, 0.065, 0.23]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
        {/* Cleat Sole */}
        <mesh position={[0, 0.007, -0.03]} receiveShadow>
          <boxGeometry args={[0.098, 0.014, 0.235]} />
          <meshStandardMaterial color="#334155" roughness={0.8} />
        </mesh>
        {/* Athletic Accent Stripe */}
        <mesh position={[stanceDir * 0.048, 0.04, -0.03]}>
          <boxGeometry args={[0.005, 0.02, 0.14]} />
          <meshStandardMaterial color="#2563eb" />
        </mesh>
      </group>

      {/* Back Foot (parallel to crease line) */}
      <group position={[backLegX, 0, backLegZ]} rotation={[0, stanceDir * 1.45, 0]}>
        <mesh position={[0, 0.035, -0.03]} castShadow>
          <boxGeometry args={[0.095, 0.065, 0.23]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.007, -0.03]} receiveShadow>
          <boxGeometry args={[0.098, 0.014, 0.235]} />
          <meshStandardMaterial color="#334155" roughness={0.8} />
        </mesh>
        <mesh position={[0.048, 0.04, -0.03]}>
          <boxGeometry args={[0.005, 0.02, 0.14]} />
          <meshStandardMaterial color="#2563eb" />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 2. INTEGRATED 3D BATTING PADS WITH IMPACT FLASHING                */}
      {/* ================================================================= */}
      {/* Helper function for Cane Bolster Batting Pad */}
      {[
        { x: frontLegX, z: frontLegZ, rotY: stanceDir * -0.12, isFront: true },
        { x: backLegX, z: backLegZ, rotY: stanceDir * 0.18, isFront: false }
      ].map((pad, pidx) => {
        const padHeight = 0.58;
        const padWidth = 0.15;
        const ribs = [-0.042, 0, 0.042];
        const padGlow = isImpacted && pad.isFront;

        return (
          <group key={pidx} position={[pad.x, 0, pad.z]} rotation={[0, pad.rotY, 0]}>
            {/* 3 Vertical Cane Bolsters / Ribs */}
            {ribs.map((rx, idx) => (
              <mesh key={idx} position={[rx, padHeight / 2, 0]} castShadow receiveShadow>
                <cylinderGeometry args={[0.022, 0.024, padHeight, 16]} />
                <meshStandardMaterial
                  color={padGlow ? '#f72585' : '#f8fafc'}
                  roughness={0.35}
                  metalness={0.08}
                  emissive={padGlow ? '#f72585' : '#000000'}
                  emissiveIntensity={padGlow ? 0.85 : 0}
                />
              </mesh>
            ))}

            {/* Horizontal Knee Roll Cushion */}
            <mesh position={[0, padHeight * 0.68, 0.016]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.032, 0.032, padWidth + 0.01, 16]} />
              <meshStandardMaterial
                color={padGlow ? '#ff4d6d' : '#f1f5f9'}
                roughness={0.4}
                emissive={padGlow ? '#ff4d6d' : '#000000'}
                emissiveIntensity={padGlow ? 0.75 : 0}
              />
            </mesh>

            {/* Top Hat Thigh Extension */}
            <mesh position={[0, padHeight + 0.07, -0.005]} castShadow>
              <boxGeometry args={[padWidth, 0.14, 0.035]} />
              <meshStandardMaterial
                color={padGlow ? '#f72585' : '#e2e8f0'}
                roughness={0.45}
                emissive={padGlow ? '#f72585' : '#000000'}
                emissiveIntensity={padGlow ? 0.55 : 0}
              />
            </mesh>

            {/* Instep Shoe Arch (Bottom) */}
            <mesh position={[0, 0.035, 0.02]} castShadow>
              <boxGeometry args={[padWidth * 0.9, 0.07, 0.06]} />
              <meshStandardMaterial
                color={padGlow ? '#f72585' : '#cbd5e1'}
                roughness={0.5}
                emissive={padGlow ? '#f72585' : '#000000'}
                emissiveIntensity={padGlow ? 0.45 : 0}
              />
            </mesh>

            {/* Fastening Straps */}
            {[0.16, 0.36, 0.52].map((sy, sidx) => (
              <mesh key={`s-${sidx}`} position={[0, sy, -0.028]}>
                <boxGeometry args={[padWidth * 1.04, 0.022, 0.012]} />
                <meshStandardMaterial color="#334155" roughness={0.7} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* ================================================================= */}
      {/* 3. THIGHS & CRICKET FLANNELS (TROUSERS)                           */}
      {/* ================================================================= */}
      {/* Front Thigh with inner thigh guard padding */}
      <group position={[frontLegX, 0.72, frontLegZ + 0.02]} rotation={[0.16, 0, 0.08 * stanceDir]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.078, 0.065, 0.38, 16]} />
          <meshStandardMaterial color={trouserColor} roughness={0.7} />
        </mesh>
        {/* Thigh Guard Contour */}
        <mesh position={[stanceDir * -0.02, 0.02, -0.04]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.09, 0.24, 0.03]} />
          <meshStandardMaterial color="#e2e8f0" roughness={0.6} />
        </mesh>
      </group>

      {/* Back Thigh */}
      <group position={[backLegX, 0.73, backLegZ - 0.01]} rotation={[-0.12, 0, -0.08 * stanceDir]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.08, 0.068, 0.38, 16]} />
          <meshStandardMaterial color={trouserColor} roughness={0.7} />
        </mesh>
      </group>

      {/* Pelvis & Athletic Waistband */}
      <group position={[stanceDir * 0.01, 0.94, 0.04]}>
        <mesh castShadow>
          <boxGeometry args={[0.31, 0.16, 0.22]} />
          <meshStandardMaterial color={trouserColor} roughness={0.7} />
        </mesh>
        {/* Belt line */}
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[0.315, 0.03, 0.225]} />
          <meshStandardMaterial color="#1e293b" roughness={0.5} />
        </mesh>
      </group>

      {/* ================================================================= */}
      {/* 4. ATHLETIC TORSO & TEAM JERSEY WITH PLAYER NUMBER                */}
      {/* ================================================================= */}
      <group position={[stanceDir * 0.01, 1.15, 0.03]} rotation={[0.06, stanceDir * -0.32, 0]}>
        {/* Main Athletic V-Taper Torso */}
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.33, 0.36, 0.21]} />
          <meshStandardMaterial color={jerseyBlue} roughness={0.5} metalness={0.1} />
        </mesh>

        {/* Chest Plate / Upper Sternum */}
        <mesh position={[0, 0.10, -0.01]}>
          <boxGeometry args={[0.34, 0.16, 0.22]} />
          <meshStandardMaterial color={jerseyBlue} roughness={0.5} />
        </mesh>

        {/* Jersey Back Panel with dynamic canvas texture (Player Name & #18) */}
        {jerseyTexture && (
          <mesh position={[0, 0.02, 0.108]} rotation={[0, 0, 0]}>
            <planeGeometry args={[0.31, 0.33]} />
            <meshStandardMaterial
              map={jerseyTexture}
              roughness={0.4}
              metalness={0.05}
            />
          </mesh>
        )}

        {/* Team Crest / DRS Badge on Front Left Chest */}
        <mesh position={[stanceDir * 0.09, 0.10, -0.108]}>
          <planeGeometry args={[0.06, 0.06]} />
          <meshStandardMaterial color={jerseyAccent} roughness={0.3} metalness={0.3} />
        </mesh>

        {/* Athletic Gold Side Stripes */}
        {[-0.168, 0.168].map((sx, sxi) => (
          <mesh key={sxi} position={[sx, 0, 0]}>
            <boxGeometry args={[0.008, 0.32, 0.15]} />
            <meshStandardMaterial color={jerseyAccent} />
          </mesh>
        ))}

        {/* V-Neck Athletic Collar */}
        <mesh position={[0, 0.19, -0.06]} rotation={[0.4, 0, 0]}>
          <boxGeometry args={[0.13, 0.025, 0.11]} />
          <meshStandardMaterial color="#f8fafc" />
        </mesh>

        {/* Neck */}
        <mesh position={[0, 0.22, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.062, 0.12, 16]} />
          {skinMaterial}
        </mesh>

        {/* =============================================================== */}
        {/* 5. HELMET WITH PROTECTIVE VISOR GRILL, PEAK & NAPE GUARD        */}
        {/* =============================================================== */}
        <group ref={headRef} position={[0, 0.38, 0]}>
          {/* Batsman Head */}
          <mesh castShadow>
            <sphereGeometry args={[0.11, 20, 20]} />
            {skinMaterial}
          </mesh>

          {/* Helmet Outer Shell (Ergonomic dome) */}
          <mesh position={[0, 0.02, 0.005]} castShadow>
            <sphereGeometry args={[0.124, 24, 24]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} metalness={0.2} />
          </mesh>

          {/* Helmet Visor Peak / Brim */}
          <mesh position={[0, 0.035, -0.115]} rotation={[0.22, 0, 0]} castShadow>
            <boxGeometry args={[0.19, 0.016, 0.09]} />
            <meshStandardMaterial color="#0f172a" roughness={0.3} />
          </mesh>

          {/* Protective Visor Grill (Titanium wireframe faceguard) */}
          <group position={[0, -0.04, -0.10]}>
            {/* Horizontal bars */}
            {[-0.03, 0.0, 0.03, 0.06].map((by, bidx) => (
              <mesh key={`bar-${bidx}`} position={[0, by, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.0028, 0.0028, 0.17, 10]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
              </mesh>
            ))}

            {/* Vertical cross struts */}
            {[-0.05, 0, 0.05].map((bx, vidx) => (
              <mesh key={`vstrut-${vidx}`} position={[bx, 0.015, 0]}>
                <cylinderGeometry args={[0.0028, 0.0028, 0.10, 8]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
              </mesh>
            ))}

            {/* Chin Guard Cushion */}
            <mesh position={[0, -0.045, 0.01]}>
              <boxGeometry args={[0.12, 0.022, 0.03]} />
              <meshStandardMaterial color="#1e293b" roughness={0.8} />
            </mesh>
          </group>

          {/* Ear Protection Shells & Screws on both sides */}
          {[-0.122, 0.122].map((ex, eidx) => (
            <group key={`ear-${eidx}`} position={[ex, -0.02, 0.01]} rotation={[0, 0, Math.PI / 2]}>
              <mesh>
                <cylinderGeometry args={[0.032, 0.032, 0.012, 16]} />
                <meshStandardMaterial color="#1e293b" roughness={0.6} />
              </mesh>
              {/* Metallic pivot bolt */}
              <mesh position={[0, ex > 0 ? 0.007 : -0.007, 0]}>
                <cylinderGeometry args={[0.008, 0.008, 0.005, 12]} />
                <meshStandardMaterial color="#e2e8f0" metalness={0.9} />
              </mesh>
            </group>
          ))}

          {/* Nape / Neck Guard at the rear */}
          <mesh position={[0, -0.06, 0.10]} rotation={[-0.25, 0, 0]} castShadow>
            <boxGeometry args={[0.16, 0.065, 0.035]} />
            <meshStandardMaterial color="#1e293b" roughness={0.8} />
          </mesh>
        </group>

        {/* =============================================================== */}
        {/* 6. SHOULDERS, ARMS & BATTING GLOVES                             */}
        {/* =============================================================== */}
        {/* Leading Shoulder (Left for RHB, facing bowler at -Z) */}
        <group position={[stanceDir * -0.18, 0.14, -0.04]}>
          <mesh castShadow>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial color={jerseyBlue} />
          </mesh>
          {/* Upper Arm / Bicep */}
          <mesh position={[stanceDir * -0.03, -0.11, 0.03]} rotation={[0.3, 0, stanceDir * 0.25]} castShadow>
            <cylinderGeometry args={[0.048, 0.042, 0.20, 16]} />
            <meshStandardMaterial color={jerseyBlue} />
          </mesh>
          {/* Elbow Guard on Leading Arm */}
          <mesh position={[stanceDir * -0.04, -0.22, 0.06]} rotation={[0, 0, 0]}>
            <sphereGeometry args={[0.052, 16, 16]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} />
          </mesh>
        </group>

        {/* Trailing Shoulder (Right for RHB) */}
        <group position={[stanceDir * 0.18, 0.13, 0.05]}>
          <mesh castShadow>
            <sphereGeometry args={[0.06, 16, 16]} />
            <meshStandardMaterial color={jerseyBlue} />
          </mesh>
          {/* Upper Arm */}
          <mesh position={[stanceDir * 0.02, -0.11, -0.02]} rotation={[-0.2, 0, stanceDir * -0.3]} castShadow>
            <cylinderGeometry args={[0.048, 0.042, 0.20, 16]} />
            <meshStandardMaterial color={jerseyBlue} />
          </mesh>
        </group>

        {/* =============================================================== */}
        {/* 7. KINEMATIC BAT RIG & WILLOW BAT WITH CANE HANDLE              */}
        {/* =============================================================== */}
        {/* The entire hands + bat assembly pivots from this ref */}
        <group ref={batRigRef} position={[stanceDir * -0.04, -0.18, -0.08]}>
          {/* Leading Hand (Top Hand on Handle) */}
          <group position={[stanceDir * -0.02, 0.12, 0.02]}>
            {/* Glove Sausage-Roll Fingers */}
            {[0, 0.02, 0.04].map((fy, fidx) => (
              <mesh key={`tf-${fidx}`} position={[0, fy, 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.012, 0.012, 0.075, 12]} />
                <meshStandardMaterial color={gloveColor} roughness={0.4} />
              </mesh>
            ))}
            {/* Knuckle Roll Accents */}
            <mesh position={[stanceDir * -0.03, 0.02, 0.035]}>
              <boxGeometry args={[0.02, 0.06, 0.02]} />
              <meshStandardMaterial color="#2563eb" />
            </mesh>
            {/* Padded Wristband */}
            <mesh position={[0, 0.07, 0.01]}>
              <cylinderGeometry args={[0.038, 0.036, 0.035, 16]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
          </group>

          {/* Trailing Hand (Bottom Hand near Bat Shoulder) */}
          <group position={[stanceDir * 0.01, -0.01, 0.01]}>
            {[0, 0.02, 0.04].map((fy, fidx) => (
              <mesh key={`bf-${fidx}`} position={[0, fy, 0.02]} rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.012, 0.012, 0.075, 12]} />
                <meshStandardMaterial color={gloveColor} roughness={0.4} />
              </mesh>
            ))}
            {/* Thumb Guard */}
            <mesh position={[stanceDir * 0.03, 0.02, 0.02]}>
              <sphereGeometry args={[0.016, 12, 12]} />
              <meshStandardMaterial color={gloveColor} />
            </mesh>
            {/* Padded Wristband */}
            <mesh position={[0, 0.06, 0.01]}>
              <cylinderGeometry args={[0.038, 0.036, 0.035, 16]} />
              <meshStandardMaterial color="#1e293b" />
            </mesh>
          </group>

          {/* ------------------------------------------------------------- */}
          {/* THE WILLOW CRICKET BAT                                        */}
          {/* ------------------------------------------------------------- */}
          <group position={[0, 0, 0]}>
            {/* Cane Handle with Textured Rubber Grip */}
            <mesh position={[0, 0.08, 0]} castShadow>
              <cylinderGeometry args={[0.016, 0.018, 0.28, 16]} />
              <meshStandardMaterial
                color="#e11d48" // Crimson Rubber Grip
                roughness={0.8}
                metalness={0.05}
              />
            </mesh>

            {/* Rubber Grip Top Cap */}
            <mesh position={[0, 0.22, 0]}>
              <cylinderGeometry args={[0.017, 0.017, 0.015, 16]} />
              <meshStandardMaterial color="#111827" />
            </mesh>

            {/* Sloping Bat Shoulder */}
            <mesh position={[0, -0.08, 0]} castShadow>
              <cylinderGeometry args={[0.024, 0.055, 0.07, 16]} />
              <meshStandardMaterial color="#eed9b3" roughness={0.5} />
            </mesh>

            {/* Main English Willow Blade with Decals & Spine */}
            <group position={[0, -0.42, 0]}>
              {/* Blade Body */}
              <mesh castShadow receiveShadow>
                <boxGeometry args={[0.108, 0.62, 0.038]} />
                <meshStandardMaterial
                  color="#f5ebe0"
                  roughness={0.4}
                  metalness={0.05}
                />
              </mesh>

              {/* Front Face with Decals */}
              {batTexture && (
                <mesh position={[0, 0, -0.02]}>
                  <planeGeometry args={[0.104, 0.60]} />
                  <meshStandardMaterial
                    map={batTexture}
                    roughness={0.3}
                  />
                </mesh>
              )}

              {/* Convex Back Spine (Thick mid-ridge profile) */}
              <mesh position={[0, 0.02, 0.024]} rotation={[0, 0, Math.PI / 4]} castShadow>
                <boxGeometry args={[0.05, 0.52, 0.05]} />
                <meshStandardMaterial color="#ecd6b0" roughness={0.45} />
              </mesh>

              {/* Rounded Protective Bat Toe Guard (Bottom) */}
              <mesh position={[0, -0.315, 0]} castShadow>
                <boxGeometry args={[0.106, 0.018, 0.036]} />
                <meshStandardMaterial color="#111827" roughness={0.9} />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      {/* Interactive Raycast Target Box */}
      <mesh position={[0, 0.85, 0]} visible={false}>
        <boxGeometry args={[0.7, 1.7, 0.6]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
