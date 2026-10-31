"""
Sample delivery generator with realistic cricket physics and Hawk-Eye DRS simulation.
Provides physically modeled deliveries for instant interactive 3D demonstration
and testing of the CV + Computer Graphics pipeline.
"""
import numpy as np
from typing import Dict, Any, List

# Pitch standard constants (meters)
PITCH_LENGTH = 20.12  # 22 yards
STUMP_Y = PITCH_LENGTH / 2  # 10.06m (Batsman stumps)
BOWLER_STUMP_Y = -PITCH_LENGTH / 2  # -10.06m (Bowler stumps)
STUMP_HEIGHT = 0.711  # 28 inches
STUMP_WIDTH = 0.2286  # 9 inches total width (-0.1143m to +0.1143m)
BALL_RADIUS = 0.036   # ~7.2cm diameter
GRAVITY = 9.81        # m/s^2

class DeliveryPhysicsSimulator:
    """
    Simulates a cricket ball delivery using classical Newtonian physics:
    - Parabolic ballistic arc before bounce
    - Realistic turf bounce reflection (restitution & seam friction)
    - Post-bounce trajectory
    - Pad impact & Hawk-Eye extrapolation to the stumps plane
    """

    @staticmethod
    def generate_delivery(
        delivery_type: str = "inswinger_lbw",
        fps: float = 60.0
    ) -> Dict[str, Any]:
        """
        Generate a full 3D trajectory with DRS evaluation for preset delivery types.
        Supported types:
        - 'inswinger_lbw': Fast inswing hitting middle stump (OUT)
        - 'offcutter_bowled': Good length off-cutter clipping top of off stump (OUT - Bowled)
        - 'bouncer_missing': Short pitched bouncer passing over stumps (NOT OUT)
        - 'legspin_umpires_call': Leg break clipping outer edge of off bail (UMPIRE'S CALL)
        """
        if delivery_type == "inswinger_lbw":
            params = {
                "title": "Fast Inswinger - LBW Out",
                "bowler_type": "Right-Arm Fast (142 km/h)",
                "release_speed_kmh": 142.0,
                "release_pos": [0.25, -9.5, 2.05],
                "pitch_target": [0.06, 4.8],  # Pitches 4.8m from pitch center
                "swing_accel": -0.12,         # Aerodynamic inswing towards stumps
                "seam_deviation_x": -0.015,   # Deviation on turf contact
                "restitution": 0.45,          # Standard turf restitution
                "has_pad_impact": True,
                "impact_y": 8.8,              # Struck pad ~1.26m in front of stumps
            }
        elif delivery_type == "offcutter_bowled":
            params = {
                "title": "Good Length Off-Cutter - Bowled",
                "bowler_type": "Right-Arm Fast-Medium (132 km/h)",
                "release_speed_kmh": 132.0,
                "release_pos": [0.45, -9.5, 2.15],
                "pitch_target": [0.22, 4.2],  # Pitches outside off stump
                "swing_accel": -0.08,
                "seam_deviation_x": -0.012,   # Cuts back into off stump
                "restitution": 0.44,
                "has_pad_impact": False,      # Clean bowled
                "impact_y": 10.06,
            }
        elif delivery_type == "bouncer_missing":
            params = {
                "title": "Sharp Bouncer - Missing Stumps",
                "bowler_type": "Right-Arm Express (148 km/h)",
                "release_speed_kmh": 148.0,
                "release_pos": [0.40, -9.5, 2.25],
                "pitch_target": [0.02, -1.5], # Short pitch (way back)
                "swing_accel": 0.05,
                "seam_deviation_x": 0.04,
                "restitution": 0.68,          # High bounce
                "has_pad_impact": True,
                "impact_y": 8.6,
            }
        elif delivery_type == "legspin_umpires_call":
            params = {
                "title": "Leg Break - Umpire's Call",
                "bowler_type": "Right-Arm Leg Spin (88 km/h)",
                "release_speed_kmh": 88.0,
                "release_pos": [0.35, -9.0, 1.95],
                "pitch_target": [-0.04, 5.0], # Pitches on middle-leg line
                "swing_accel": 0.15,          # Drift
                "seam_deviation_x": 0.22,     # Turns away towards off stump
                "restitution": 0.52,
                "has_pad_impact": True,
                "impact_y": 8.9,
            }
        else:
            # Default fallback
            return DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw", fps)

        return DeliveryPhysicsSimulator._simulate_trajectory(params, fps)

    @staticmethod
    def _simulate_trajectory(params: Dict[str, Any], fps: float) -> Dict[str, Any]:
        dt = 1.0 / fps
        speed_ms = params["release_speed_kmh"] / 3.6
        x0, y0, z0 = params["release_pos"]
        pitch_x, pitch_y = params["pitch_target"]

        # Calculate time to pitch based on initial speed along Y
        # Average Vy is approx 95% of total speed
        vy0 = speed_ms * 0.98
        time_to_pitch = (pitch_y - y0) / vy0

        # Vertical velocity to land at pitch_y: Z(t_p) = 0 = z0 + vz0 * t_p - 0.5 * g * t_p^2
        # vz0 = (0.5 * g * t_p^2 - z0) / t_p
        vz0 = (0.5 * GRAVITY * (time_to_pitch ** 2) - z0) / time_to_pitch

        # Horizontal velocity to reach pitch_x with swing acceleration
        # X(t_p) = x0 + vx0 * t_p + 0.5 * a_swing * t_p^2
        vx0 = (pitch_x - x0 - 0.5 * params["swing_accel"] * (time_to_pitch ** 2)) / time_to_pitch

        points: List[Dict[str, Any]] = []
        pre_bounce_points: List[Dict[str, Any]] = []
        post_bounce_points: List[Dict[str, Any]] = []
        extrapolated_points: List[Dict[str, Any]] = []

        # 1. Simulate Pre-Bounce Flight
        t = 0.0
        x, y, z = x0, y0, z0
        vx, vy, vz = vx0, vy0, vz0
        while y < pitch_y and z > 0.036:
            pt = {
                "x": round(float(x), 4),
                "y": round(float(y), 4),
                "z": round(float(z), 4),
                "t": round(float(t), 4),
                "speed_kmh": round(float(np.sqrt(vx**2 + vy**2 + vz**2) * 3.6), 1),
                "phase": "pre_bounce",
                "confidence": 0.95
            }
            points.append(pt)
            pre_bounce_points.append(pt)

            # Integrate forward
            vx += params["swing_accel"] * dt
            vz -= GRAVITY * dt
            vy -= 0.12 * vy * dt  # subtle air drag
            x += vx * dt
            y += vy * dt
            z += vz * dt
            t += dt

        # Bounce Event
        bounce_point = {
            "x": round(float(x), 4),
            "y": round(float(pitch_y), 4),
            "z": 0.036,
            "t": round(float(t), 4),
            "speed_kmh": round(float(np.sqrt(vx**2 + vy**2 + vz**2) * 3.6), 1),
            "phase": "bounce"
        }
        points.append(bounce_point)

        # 2. Reflect velocities after bounce
        vz = abs(vz) * params["restitution"]
        vy = vy * 0.78  # ground friction slows forward momentum
        vx = vx + params["seam_deviation_x"] * 1.8  # lateral deviation from pitch contact
        z = 0.036
        bounce_speed_kmh = round(float(np.sqrt(vx**2 + vy**2 + vz**2) * 3.6), 1)

        # 3. Simulate Post-Bounce Flight up to Pad Impact (or Stumps)
        has_impact = params["has_pad_impact"]
        target_impact_y = params["impact_y"] if has_impact else STUMP_Y
        impact_point = None

        while y < target_impact_y and z > 0:
            pt = {
                "x": round(float(x), 4),
                "y": round(float(y), 4),
                "z": round(float(z), 4),
                "t": round(float(t), 4),
                "speed_kmh": round(float(np.sqrt(vx**2 + vy**2 + vz**2) * 3.6), 1),
                "phase": "post_bounce",
                "confidence": 0.92
            }
            points.append(pt)
            post_bounce_points.append(pt)

            vz -= GRAVITY * dt
            vy -= 0.1 * vy * dt
            x += vx * dt
            y += vy * dt
            z += vz * dt
            t += dt

        if has_impact:
            impact_point = {
                "x": round(float(x), 4),
                "y": round(float(y), 4),
                "z": round(float(max(0.05, z)), 4),
                "t": round(float(t), 4),
                "speed_kmh": round(float(np.sqrt(vx**2 + vy**2 + vz**2) * 3.6), 1),
                "phase": "impact"
            }
            points.append(impact_point)

        # 4. Hawk-Eye Physics Extrapolation: Continue flight from impact to stumps (Y = 10.06m)
        pred_x, pred_y, pred_z = x, y, z
        pred_vx, pred_vy, pred_vz = vx, vy, vz
        pred_t = t

        while pred_y <= STUMP_Y + 0.3:
            pt = {
                "x": round(float(pred_x), 4),
                "y": round(float(pred_y), 4),
                "z": round(float(max(0.01, pred_z)), 4),
                "t": round(float(pred_t), 4),
                "speed_kmh": round(float(np.sqrt(pred_vx**2 + pred_vy**2 + pred_vz**2) * 3.6), 1),
                "phase": "extrapolated",
                "confidence": 0.88
            }
            extrapolated_points.append(pt)

            pred_vz -= GRAVITY * dt
            pred_x += pred_vx * dt
            pred_y += pred_vy * dt
            pred_z += pred_vz * dt
            pred_t += dt

        # Interpolate exact point at Stumps Plane (Y = 10.06m)
        stump_plane_z = pred_z
        stump_plane_x = pred_x
        for ep in extrapolated_points:
            if ep["y"] >= STUMP_Y:
                stump_plane_x = ep["x"]
                stump_plane_z = ep["z"]
                break

        # DRS Decision Evaluation according to standard ICC Hawk-Eye rules:
        # Stumps width: -0.1143m to +0.1143m. Margin: 50% ball radius = 0.018m
        stump_half_width = STUMP_WIDTH / 2
        stump_top = STUMP_HEIGHT + 0.03  # with bails

        # 1. Pitching
        bounce_x = bounce_point["x"]
        if abs(bounce_x) <= stump_half_width:
            pitching_verdict = "IN LINE"
        elif bounce_x > stump_half_width:
            pitching_verdict = "OUTSIDE OFF"
        else:
            pitching_verdict = "OUTSIDE LEG"

        # 2. Impact
        if impact_point:
            imp_x = impact_point["x"]
            if abs(imp_x) <= stump_half_width:
                impact_verdict = "IN LINE"
            else:
                impact_verdict = "OUTSIDE"
        else:
            impact_verdict = "NO IMPACT (CLEAN BOWLED)"

        # 3. Wickets
        # Check height and width at stumps plane
        is_height_hitting = (stump_plane_z <= stump_top) and (stump_plane_z >= 0.03)
        is_height_clipping = abs(stump_plane_z - stump_top) <= BALL_RADIUS
        is_width_hitting = abs(stump_plane_x) <= stump_half_width
        is_width_clipping = abs(abs(stump_plane_x) - stump_half_width) <= BALL_RADIUS

        if is_height_hitting and is_width_hitting:
            wickets_verdict = "HITTING"
        elif (is_height_hitting and is_width_clipping) or (is_height_clipping and is_width_hitting):
            wickets_verdict = "UMPIRE'S CALL"
        else:
            wickets_verdict = "MISSING"

        # Overall LBW Decision
        if pitching_verdict == "OUTSIDE LEG":
            overall_decision = "NOT OUT (Pitched Outside Leg)"
        elif impact_verdict == "OUTSIDE":
            overall_decision = "NOT OUT (Impact Outside Off)"
        elif wickets_verdict == "HITTING":
            overall_decision = "OUT"
        elif wickets_verdict == "UMPIRE'S CALL":
            overall_decision = "UMPIRE'S CALL"
        else:
            overall_decision = "NOT OUT (Missing Wickets)"

        # Targeted Stumps determination
        hit_stump = "None"
        if wickets_verdict in ["HITTING", "UMPIRE'S CALL"]:
            if stump_plane_x < -0.04:
                hit_stump = "Leg Stump"
            elif stump_plane_x > 0.04:
                hit_stump = "Off Stump"
            else:
                hit_stump = "Middle Stump"

        # Determine pitch length zone
        # Distance from batsman stumps: PITCH_LENGTH / 2 - pitch_y = 10.06 - pitch_y
        dist_from_stumps = STUMP_Y - pitch_y
        if dist_from_stumps < 2.0:
            length_zone = "Yorker"
        elif dist_from_stumps < 4.0:
            length_zone = "Full"
        elif dist_from_stumps < 7.0:
            length_zone = "Good Length"
        elif dist_from_stumps < 9.5:
            length_zone = "Short of Length"
        else:
            length_zone = "Bouncer"

        # Compile comprehensive delivery object
        return {
            "title": params["title"],
            "bowler_type": params["bowler_type"],
            "release_speed_kmh": params["release_speed_kmh"],
            "bounce_speed_kmh": bounce_speed_kmh,
            "length_zone": length_zone,
            "dist_from_batsman_stumps_m": round(float(dist_from_stumps), 2),
            "points": points,
            "pre_bounce_points": pre_bounce_points,
            "bounce_point": bounce_point,
            "post_bounce_points": post_bounce_points,
            "impact_point": impact_point,
            "extrapolated_points": extrapolated_points,
            "stump_plane_target": {
                "x": round(float(stump_plane_x), 4),
                "y": STUMP_Y,
                "z": round(float(stump_plane_z), 4),
                "hit_stump": hit_stump
            },
            "drs_evaluation": {
                "decision": overall_decision,
                "pitching": pitching_verdict,
                "impact": impact_verdict,
                "wickets": wickets_verdict,
                "hit_stump": hit_stump
            },
            "timestamps": [p["t"] for p in points],
            "confidence_score": 0.94,
            "ball_detected": True,
            "video_duration": points[-1]["t"] if points else 1.5
        }

    @staticmethod
    def get_all_preset_deliveries() -> List[Dict[str, Any]]:
        """Returns metadata for all available preset deliveries"""
        return [
            {"id": "inswinger_lbw", "name": "Fast Inswinger - LBW Out (142 km/h)", "decision": "OUT"},
            {"id": "offcutter_bowled", "name": "Good Length Off-Cutter - Bowled (132 km/h)", "decision": "OUT"},
            {"id": "bouncer_missing", "name": "Sharp Bouncer - Missing Stumps (148 km/h)", "decision": "NOT OUT"},
            {"id": "legspin_umpires_call", "name": "Leg Break - Umpire's Call (88 km/h)", "decision": "UMPIRE'S CALL"}
        ]
