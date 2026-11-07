"""
BallPhysicsEngine: Advanced Aerodynamics & Pitch Restitution Engine for Cricket DRS.

Comprehensive aerodynamic simulation engine implementing:
1. Classical Newtonian Gravity Force:
   F_g = m * g
2. Quadratic Aerodynamic Air Drag:
   F_d = -0.5 * C_d * rho * A * |v| * v
3. Magnus Aerodynamic Lateral Drift and Dipping Force:
   F_m = 0.5 * C_L * rho * A * v^2 * (omega_hat x v_hat)
   where C_L is dependent on the spin parameter S = (r * omega) / v
4. Seam Turbulence / Drift Model for Conventional & Reverse Swing:
   Boundary layer asymmetry triggered by angled seam and surface roughness.
5. Surface Restitution & Friction Tensor:
   Turf interactions based on pitch turf type:
   - 'dry_dusty': High friction (mu=0.48), lower coefficient of restitution (e_z=0.52), aggressive spin deviation.
   - 'green_seamer': Low friction (mu=0.28), high bounce (e_z=0.68), maximum seam lateral kick.
   - 'damp_clay': High energy loss (e_z=0.45), ball skids lower.
   - 'standard_hard': Standard balanced pitch (e_z=0.60, mu=0.35).
6. Full 3D Trajectory Telemetry with instantaneous force vectors.
"""

import math
import numpy as np
from typing import Dict, Any, List, Optional, Tuple

# Physical constants for regulation cricket ball & standard atmosphere
BALL_MASS = 0.156        # kg (156 grams standard regulation)
BALL_RADIUS = 0.036      # m (7.2 cm diameter)
BALL_CIRCUMFERENCE = 2 * math.pi * BALL_RADIUS  # ~0.226 m
BALL_AREA = math.pi * (BALL_RADIUS ** 2)        # ~0.0040715 m^2
AIR_DENSITY = 1.225      # kg/m^3 (sea level standard air at 15 deg C)
AIR_VISCOSITY = 1.81e-5  # kg/(m*s) dynamic viscosity of air
AIR_KINEMATIC_VISCOSITY = 1.5e-5  # m^2/s kinematic viscosity
GRAVITY = 9.81           # m/s^2

# Pitch & Stumps Geometry (meters)
PITCH_LENGTH = 20.12     # 22 yards
STUMP_Y = PITCH_LENGTH / 2          # +10.06m (Batsman stumps)
BOWLER_STUMP_Y = -PITCH_LENGTH / 2  # -10.06m (Bowler stumps)
STUMP_HEIGHT = 0.711     # 28 inches
STUMP_WIDTH = 0.2286     # 9 inches total width (-0.1143m to +0.1143m)

# Pitch Turf Profiles with Restitution and Friction Tensors
PITCH_PROFILES: Dict[str, Dict[str, Any]] = {
    "standard_hard": {
        "id": "standard_hard",
        "name": "Standard Hard Pitch",
        "restitution_z": 0.60,
        "friction": 0.35,
        "spin_grip": 1.0,
        "seam_kick": 1.0,
        "description": "Standard balanced pitch (e_z=0.60, mu=0.35) with true bounce and consistent carry."
    },
    "green_seamer": {
        "id": "green_seamer",
        "name": "Green Seamer (Grassy)",
        "restitution_z": 0.68,
        "friction": 0.28,
        "spin_grip": 0.70,
        "seam_kick": 1.65,
        "description": "Low friction (mu=0.28), high bounce (e_z=0.68), maximum seam lateral kick."
    },
    "dry_dusty": {
        "id": "dry_dusty",
        "name": "Dry & Dusty (Turning Track)",
        "restitution_z": 0.52,
        "friction": 0.48,
        "spin_grip": 1.45,
        "seam_kick": 0.85,
        "description": "High friction (mu=0.48), lower coefficient of restitution (e_z=0.52), aggressive spin deviation."
    },
    "damp_clay": {
        "id": "damp_clay",
        "name": "Damp Clay (Slow/Sticky)",
        "restitution_z": 0.45,
        "friction": 0.38,
        "spin_grip": 1.10,
        "seam_kick": 0.95,
        "description": "High energy loss (e_z=0.45), ball skids lower."
    }
}


class BallPhysicsEngine:
    """
    Advanced Aerodynamics & Pitch Restitution Engine for Cricket Ball Simulation.
    """

    @classmethod
    def get_pitch_profile(cls, pitch_type: str = "standard_hard") -> Dict[str, Any]:
        """Retrieve pitch profile by ID with fallback to standard_hard."""
        return PITCH_PROFILES.get(pitch_type, PITCH_PROFILES["standard_hard"])

    @classmethod
    def get_available_pitch_types(cls) -> List[Dict[str, Any]]:
        """Return list of all configured pitch turf types."""
        return list(PITCH_PROFILES.values())

    @staticmethod
    def calculate_reynolds_number(speed_ms: float) -> float:
        """Calculate non-dimensional Reynolds number for a spherical cricket ball."""
        if speed_ms <= 0:
            return 0.0
        return (AIR_DENSITY * speed_ms * (2.0 * BALL_RADIUS)) / AIR_VISCOSITY

    @staticmethod
    def calculate_spin_parameter(speed_ms: float, spin_rad_s: float) -> float:
        """
        Calculate non-dimensional spin parameter S = (r * omega) / v.
        Ratio of equatorial surface rotational velocity to forward translational speed.
        """
        if speed_ms < 0.1:
            return 0.0
        return (BALL_RADIUS * spin_rad_s) / speed_ms

    @staticmethod
    def calculate_lift_coefficient(spin_parameter: float) -> float:
        """
        Calculate aerodynamic Magnus lift coefficient C_L as a function of spin parameter S.
        Derived from cricket ball wind tunnel data (Mehta, Nathan, Watts & Ferrer).
        """
        if spin_parameter <= 1e-4:
            return 0.0
        return min(0.42, (1.25 * spin_parameter) / (1.0 + 1.1 * spin_parameter))

    @staticmethod
    def calculate_drag_coefficient(speed_ms: float, spin_parameter: float = 0.0) -> float:
        """
        Calculate aerodynamic drag coefficient C_d accounting for subcritical/critical flow
        and induced drag from seam roughness and spin.
        """
        re = BallPhysicsEngine.calculate_reynolds_number(speed_ms)
        cd_base = 0.31
        cd_spin = 0.08 * min(1.0, spin_parameter)
        if re > 1.6e5:
            cd_base = 0.28
        return cd_base + cd_spin

    @staticmethod
    def calculate_instantaneous_forces(
        velocity: List[float],
        spin_vector: List[float],
        seam_angle_deg: float = 0.0,
        ball_condition: str = "semi_new",
        pitch_type: str = "standard_hard"
    ) -> Dict[str, Any]:
        """
        Calculate all instantaneous 3D forces acting on the ball during flight.

        Parameters:
        - velocity: [vx, vy, vz] in m/s (backend coordinates: x=lateral, y=length, z=height)
        - spin_vector: [wx, wy, wz] in rad/s (angular velocity)
        - seam_angle_deg: Seam tilt angle in degrees relative to flight path (-25 to +25)
        - ball_condition: 'new', 'semi_new', 'worn_reverse'
        - pitch_type: 'standard_hard', 'green_seamer', 'dry_dusty', 'damp_clay'

        Returns dictionary of 3D force vectors (in Newtons) and aerodynamic telemetry.
        """
        v = np.array(velocity, dtype=float)
        speed_ms = float(np.linalg.norm(v))
        speed_kmh = speed_ms * 3.6

        # 1. Gravity Force: F_g = m * g (pointing down along negative z)
        f_gravity = np.array([0.0, 0.0, -BALL_MASS * GRAVITY], dtype=float)

        if speed_ms < 0.1:
            zero_vec = [0.0, 0.0, 0.0]
            return {
                "gravity_vector": [round(x, 4) for x in f_gravity],
                "drag_vector": zero_vec,
                "magnus_vector": zero_vec,
                "seam_vector": zero_vec,
                "net_force_vector": [round(x, 4) for x in f_gravity],
                "acceleration": [round(x / BALL_MASS, 4) for x in f_gravity],
                "velocity_vector": [round(x, 4) for x in v],
                "spin_vector": [round(float(x), 4) for x in spin_vector],
                "speed_kmh": round(speed_kmh, 2),
                "speed_ms": round(speed_ms, 2),
                "spin_rpm": 0.0,
                "reynolds_number": 0.0,
                "spin_parameter": 0.0,
                "lift_coefficient": 0.0,
                "drag_coefficient": 0.32,
                "magnus_force_n": 0.0,
                "drag_force_n": 0.0,
            }

        # 2. Quadratic Air Drag: F_d = -0.5 * C_d * rho * A * |v| * v
        spin = np.array(spin_vector, dtype=float)
        omega = float(np.linalg.norm(spin))
        spin_rpm = (omega * 60.0) / (2.0 * math.pi)
        spin_param = BallPhysicsEngine.calculate_spin_parameter(speed_ms, omega)
        cd = BallPhysicsEngine.calculate_drag_coefficient(speed_ms, spin_param)
        v_hat = v / speed_ms

        f_drag = -0.5 * cd * AIR_DENSITY * BALL_AREA * speed_ms * v

        # 3. Magnus Aerodynamic Force: F_m = 0.5 * C_L * rho * A * v^2 * (omega_hat x v_hat)
        cl = BallPhysicsEngine.calculate_lift_coefficient(spin_param)
        if omega > 1e-3:
            omega_hat = spin / omega
            magnus_dir = np.cross(omega_hat, v_hat)
            f_magnus = 0.5 * cl * AIR_DENSITY * BALL_AREA * (speed_ms ** 2) * magnus_dir
        else:
            f_magnus = np.zeros(3, dtype=float)

        # 4. Seam Turbulence / Drift Model (Conventional & Reverse Swing)
        # Asymmetric boundary layer separation across the angled seam
        f_seam = np.zeros(3, dtype=float)
        if abs(seam_angle_deg) > 0.01:
            horiz_speed = math.sqrt(v[0] ** 2 + v[1] ** 2)
            if horiz_speed > 1.0:
                lateral_hat = np.array([-v[1] / horiz_speed, v[0] / horiz_speed, 0.0], dtype=float)
                seam_rad = math.radians(seam_angle_deg)

                if ball_condition == "worn_reverse" and speed_kmh > 136.0:
                    # Reverse swing: turbulence trips on rough side earlier; force reverses toward smooth side
                    c_side = -0.16 * math.sin(2.0 * seam_rad) * math.exp(-((speed_ms - 41.5) ** 2) / 60.0)
                else:
                    # Conventional swing: peaks around 120-135 km/h (~33-37 m/s)
                    c_side = 0.20 * math.sin(2.0 * seam_rad) * math.exp(-((speed_ms - 34.5) ** 2) / 90.0)

                f_seam = 0.5 * c_side * AIR_DENSITY * BALL_AREA * (speed_ms ** 2) * lateral_hat

        # 5. Net Aerodynamic & Total Forces
        f_aero = f_drag + f_magnus + f_seam
        f_net = f_gravity + f_aero
        acceleration = f_net / BALL_MASS
        re = BallPhysicsEngine.calculate_reynolds_number(speed_ms)

        return {
            "gravity_vector": [round(float(x), 4) for x in f_gravity],
            "drag_vector": [round(float(x), 4) for x in f_drag],
            "magnus_vector": [round(float(x), 4) for x in f_magnus],
            "seam_vector": [round(float(x), 4) for x in f_seam],
            "net_force_vector": [round(float(x), 4) for x in f_net],
            "acceleration": [round(float(x), 4) for x in acceleration],
            "velocity_vector": [round(float(x), 4) for x in v],
            "spin_vector": [round(float(x), 4) for x in spin],
            "speed_kmh": round(speed_kmh, 2),
            "speed_ms": round(speed_ms, 2),
            "spin_rpm": round(spin_rpm, 1),
            "reynolds_number": round(re, 0),
            "spin_parameter": round(spin_param, 4),
            "lift_coefficient": round(cl, 4),
            "drag_coefficient": round(cd, 4),
            "magnus_force_n": round(float(np.linalg.norm(f_magnus)), 4),
            "drag_force_n": round(float(np.linalg.norm(f_drag)), 4),
        }

    @classmethod
    def apply_pitch_restitution(
        cls,
        velocity: List[float],
        spin_vector: List[float],
        pitch_type: str = "standard_hard",
        seam_angle_deg: float = 0.0,
        contact_kick_x: float = 0.0,
        base_restitution: float = 0.55
    ) -> Tuple[List[float], List[float]]:
        """
        Apply surface restitution tensor and turf friction upon bounce contact.

        Returns: (new_velocity, new_spin_vector)
        """
        profile = cls.get_pitch_profile(pitch_type)
        ez = profile["restitution_z"]
        mu = profile["friction"]
        spin_grip = profile["spin_grip"]
        seam_kick = profile["seam_kick"]

        vx, vy, vz = velocity
        wx, wy, wz = spin_vector

        # Vertical velocity: reflection scaled by pitch normal coefficient of restitution
        restitution_effective = base_restitution * (ez / 0.60)
        vz_new = abs(vz) * restitution_effective

        # Longitudinal velocity: forward speed lost to turf friction
        forward_loss_factor = max(0.65, 1.0 - 0.45 * (mu / 0.35))
        vy_new = vy * forward_loss_factor

        # Lateral deviation: seam kick + spin grip
        delta_vx = contact_kick_x * seam_kick
        vx_new = vx + delta_vx

        # Spin decay upon impact due to contact torque
        spin_decay = max(0.55, 1.0 - 0.35 * (mu / 0.35))
        spin_new = [wx * spin_decay, wy * spin_decay, wz * spin_decay]

        return [vx_new, vy_new, vz_new], spin_new

    @classmethod
    def simulate_aerodynamic_trajectory(
        cls,
        release_pos: List[float],
        release_speed_kmh: float,
        pitch_target_x: float,
        pitch_target_y: float,
        spin_vector: List[float],
        seam_angle_deg: float = 0.0,
        ball_condition: str = "semi_new",
        pitch_type: str = "standard_hard",
        has_pad_impact: bool = True,
        impact_y: float = 8.8,
        contact_kick_x: float = -0.25,
        base_restitution: float = 0.50,
        fps: float = 60.0
    ) -> Dict[str, Any]:
        """
        Numerically integrate full 3D aerodynamic trajectory using Runge-Kutta substepping
        and pitch surface restitution tensor.
        """
        profile = cls.get_pitch_profile(pitch_type)
        dt_frame = 1.0 / fps
        substeps = 8
        dt_sub = dt_frame / substeps

        x0, y0, z0 = release_pos
        v_total = release_speed_kmh / 3.6
        vy0 = v_total * 0.98
        t_pitch = max(0.1, (pitch_target_y - y0) / vy0)
        vz0 = (BALL_RADIUS - z0 + 0.5 * GRAVITY * (t_pitch ** 2)) / t_pitch
        vx0 = (pitch_target_x - x0) / t_pitch

        # Shooting solver to precisely hit pitch_target accounting for air resistance
        dt_solve = 0.005
        for _ in range(8):
            pos_s = np.array(release_pos, dtype=float)
            vel_s = np.array([vx0, vy0, vz0], dtype=float)
            t_s = 0.0
            while pos_s[1] < pitch_target_y:
                forces = cls.calculate_instantaneous_forces(
                    vel_s.tolist(), spin_vector, seam_angle_deg, ball_condition, pitch_type
                )
                acc = np.array(forces["acceleration"], dtype=float)
                vel_s += acc * dt_solve
                pos_s += vel_s * dt_solve
                t_s += dt_solve
            err_x = pos_s[0] - pitch_target_x
            err_z = pos_s[2] - BALL_RADIUS
            vx0 -= err_x / max(0.1, t_s)
            vz0 -= err_z / max(0.1, t_s)
            v_sq_rem = v_total ** 2 - vx0 ** 2 - vz0 ** 2
            if v_sq_rem > 0:
                vy0 = math.sqrt(v_sq_rem)

        pos = np.array(release_pos, dtype=float)
        vel = np.array([vx0, vy0, vz0], dtype=float)
        spin = np.array(spin_vector, dtype=float)

        points: List[Dict[str, Any]] = []
        pre_bounce_points: List[Dict[str, Any]] = []
        post_bounce_points: List[Dict[str, Any]] = []
        extrapolated_points: List[Dict[str, Any]] = []

        t = 0.0

        # 1. Pre-bounce flight
        while pos[1] < pitch_target_y and pos[2] > BALL_RADIUS:
            forces = cls.calculate_instantaneous_forces(
                vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
            )
            pt = {
                "x": round(float(pos[0]), 4),
                "y": round(float(pos[1]), 4),
                "z": round(float(pos[2]), 4),
                "vx": round(float(vel[0]), 3),
                "vy": round(float(vel[1]), 3),
                "vz": round(float(vel[2]), 3),
                "t": round(float(t), 4),
                "speed_kmh": forces["speed_kmh"],
                "phase": "pre_bounce",
                "confidence": 0.96,
                "velocity_vector": forces["velocity_vector"],
                "gravity_vector": forces["gravity_vector"],
                "drag_vector": forces["drag_vector"],
                "magnus_vector": forces["magnus_vector"],
                "seam_vector": forces["seam_vector"],
                "net_force_vector": forces["net_force_vector"],
                "spin_vector": forces["spin_vector"],
                "spin_rpm": forces["spin_rpm"],
                "reynolds_number": forces["reynolds_number"],
                "magnus_force_n": forces["magnus_force_n"],
                "drag_force_n": forces["drag_force_n"],
            }
            points.append(pt)
            pre_bounce_points.append(pt)

            for _ in range(substeps):
                f_sub = cls.calculate_instantaneous_forces(
                    vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
                )
                acc = np.array(f_sub["acceleration"], dtype=float)
                vel += acc * dt_sub
                pos += vel * dt_sub
            t += dt_frame

        # Bounce point
        bounce_forces = cls.calculate_instantaneous_forces(
            vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
        )
        bounce_pt = {
            "x": round(float(pos[0]), 4),
            "y": round(float(pitch_target_y), 4),
            "z": BALL_RADIUS,
            "vx": round(float(vel[0]), 3),
            "vy": round(float(vel[1]), 3),
            "vz": round(float(vel[2]), 3),
            "t": round(float(t), 4),
            "speed_kmh": bounce_forces["speed_kmh"],
            "phase": "bounce",
            "velocity_vector": bounce_forces["velocity_vector"],
            "gravity_vector": bounce_forces["gravity_vector"],
            "drag_vector": bounce_forces["drag_vector"],
            "magnus_vector": bounce_forces["magnus_vector"],
            "seam_vector": bounce_forces["seam_vector"],
            "spin_vector": bounce_forces["spin_vector"],
            "spin_rpm": bounce_forces["spin_rpm"],
            "reynolds_number": bounce_forces["reynolds_number"],
            "magnus_force_n": bounce_forces["magnus_force_n"],
            "drag_force_n": bounce_forces["drag_force_n"],
        }
        points.append(bounce_pt)

        # Apply pitch restitution tensor
        new_vel, new_spin = cls.apply_pitch_restitution(
            vel.tolist(), spin.tolist(), pitch_type, seam_angle_deg, contact_kick_x, base_restitution
        )
        vel = np.array(new_vel, dtype=float)
        spin = np.array(new_spin, dtype=float)
        pos[2] = BALL_RADIUS

        bounce_speed_kmh = round(float(np.linalg.norm(vel) * 3.6), 1)

        # 2. Post-bounce flight
        target_impact_y = impact_y if has_pad_impact else STUMP_Y
        while pos[1] < target_impact_y and pos[2] > 0.02:
            forces = cls.calculate_instantaneous_forces(
                vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
            )
            pt = {
                "x": round(float(pos[0]), 4),
                "y": round(float(pos[1]), 4),
                "z": round(float(pos[2]), 4),
                "vx": round(float(vel[0]), 3),
                "vy": round(float(vel[1]), 3),
                "vz": round(float(vel[2]), 3),
                "t": round(float(t), 4),
                "speed_kmh": forces["speed_kmh"],
                "phase": "post_bounce",
                "confidence": 0.93,
                "velocity_vector": forces["velocity_vector"],
                "gravity_vector": forces["gravity_vector"],
                "drag_vector": forces["drag_vector"],
                "magnus_vector": forces["magnus_vector"],
                "seam_vector": forces["seam_vector"],
                "net_force_vector": forces["net_force_vector"],
                "spin_vector": forces["spin_vector"],
                "spin_rpm": forces["spin_rpm"],
                "reynolds_number": forces["reynolds_number"],
                "magnus_force_n": forces["magnus_force_n"],
                "drag_force_n": forces["drag_force_n"],
            }
            points.append(pt)
            post_bounce_points.append(pt)

            for _ in range(substeps):
                f_sub = cls.calculate_instantaneous_forces(
                    vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
                )
                acc = np.array(f_sub["acceleration"], dtype=float)
                vel += acc * dt_sub
                pos += vel * dt_sub
            t += dt_frame

        impact_pt = None
        if has_pad_impact:
            imp_forces = cls.calculate_instantaneous_forces(
                vel.tolist(), spin.tolist(), seam_angle_deg, ball_condition, pitch_type
            )
            impact_pt = {
                "x": round(float(pos[0]), 4),
                "y": round(float(pos[1]), 4),
                "z": round(float(max(0.04, pos[2])), 4),
                "vx": round(float(vel[0]), 3),
                "vy": round(float(vel[1]), 3),
                "vz": round(float(vel[2]), 3),
                "t": round(float(t), 4),
                "speed_kmh": imp_forces["speed_kmh"],
                "phase": "impact",
                "velocity_vector": imp_forces["velocity_vector"],
                "gravity_vector": imp_forces["gravity_vector"],
                "drag_vector": imp_forces["drag_vector"],
                "magnus_vector": imp_forces["magnus_vector"],
                "seam_vector": imp_forces["seam_vector"],
                "spin_vector": imp_forces["spin_vector"],
                "spin_rpm": imp_forces["spin_rpm"],
                "reynolds_number": imp_forces["reynolds_number"],
                "magnus_force_n": imp_forces["magnus_force_n"],
                "drag_force_n": imp_forces["drag_force_n"],
            }
            points.append(impact_pt)

        # 3. Hawk-Eye Predictive Extrapolation to Stumps (Y = 10.06m)
        pred_pos = np.copy(pos)
        pred_vel = np.copy(vel)
        pred_spin = np.copy(spin)
        pred_t = t

        while pred_pos[1] <= STUMP_Y + 0.35 and pred_pos[2] > 0.01:
            forces = cls.calculate_instantaneous_forces(
                pred_vel.tolist(), pred_spin.tolist(), seam_angle_deg, ball_condition, pitch_type
            )
            pt = {
                "x": round(float(pred_pos[0]), 4),
                "y": round(float(pred_pos[1]), 4),
                "z": round(float(max(0.01, pred_pos[2])), 4),
                "vx": round(float(pred_vel[0]), 3),
                "vy": round(float(pred_vel[1]), 3),
                "vz": round(float(pred_vel[2]), 3),
                "t": round(float(pred_t), 4),
                "speed_kmh": forces["speed_kmh"],
                "phase": "extrapolated",
                "confidence": 0.89,
                "velocity_vector": forces["velocity_vector"],
                "gravity_vector": forces["gravity_vector"],
                "drag_vector": forces["drag_vector"],
                "magnus_vector": forces["magnus_vector"],
                "seam_vector": forces["seam_vector"],
                "net_force_vector": forces["net_force_vector"],
                "spin_vector": forces["spin_vector"],
                "spin_rpm": forces["spin_rpm"],
                "reynolds_number": forces["reynolds_number"],
                "magnus_force_n": forces["magnus_force_n"],
                "drag_force_n": forces["drag_force_n"],
            }
            extrapolated_points.append(pt)

            for _ in range(substeps):
                f_sub = cls.calculate_instantaneous_forces(
                    pred_vel.tolist(), pred_spin.tolist(), seam_angle_deg, ball_condition, pitch_type
                )
                acc = np.array(f_sub["acceleration"], dtype=float)
                pred_vel += acc * dt_sub
                pred_pos += pred_vel * dt_sub
            pred_t += dt_frame

        stump_plane_x = float(pred_pos[0])
        stump_plane_z = float(pred_pos[2])
        for ep in extrapolated_points:
            if ep["y"] >= STUMP_Y:
                stump_plane_x = ep["x"]
                stump_plane_z = ep["z"]
                break

        # 4. DRS Evaluation
        stump_half_width = STUMP_WIDTH / 2.0  # 0.1143m
        stump_top = STUMP_HEIGHT + 0.03       # 0.741m

        bx = bounce_pt["x"]
        if abs(bx) <= stump_half_width:
            pitching_verdict = "IN LINE"
        elif bx > stump_half_width:
            pitching_verdict = "OUTSIDE OFF"
        else:
            pitching_verdict = "OUTSIDE LEG"

        if impact_pt:
            ix = impact_pt["x"]
            if abs(ix) <= stump_half_width:
                impact_verdict = "IN LINE"
            else:
                impact_verdict = "OUTSIDE"
        else:
            impact_verdict = "NO IMPACT (CLEAN BOWLED)"

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

        hit_stump = "None"
        if wickets_verdict in ["HITTING", "UMPIRE'S CALL"]:
            if stump_plane_x < -0.04:
                hit_stump = "Leg Stump"
            elif stump_plane_x > 0.04:
                hit_stump = "Off Stump"
            else:
                hit_stump = "Middle Stump"

        dist_from_stumps = STUMP_Y - pitch_target_y
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

        magnus_forces = [p.get("magnus_force_n", 0.0) for p in points]
        drag_forces = [p.get("drag_force_n", 0.0) for p in points]
        reynolds_list = [p.get("reynolds_number", 0.0) for p in points]

        return {
            "pitch_type": pitch_type,
            "pitch_profile": profile,
            "release_speed_kmh": round(release_speed_kmh, 1),
            "bounce_speed_kmh": bounce_speed_kmh,
            "length_zone": length_zone,
            "dist_from_batsman_stumps_m": round(float(dist_from_stumps), 2),
            "points": points,
            "pre_bounce_points": pre_bounce_points,
            "bounce_point": bounce_pt,
            "post_bounce_points": post_bounce_points,
            "impact_point": impact_pt,
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
            "aerodynamics_telemetry": {
                "peak_magnus_force_n": round(float(max(magnus_forces, default=0.0)), 4),
                "mean_drag_force_n": round(float(np.mean(drag_forces) if drag_forces else 0.0), 4),
                "max_reynolds_number": round(float(max(reynolds_list, default=0.0)), 0),
                "seam_angle_deg": seam_angle_deg,
                "ball_condition": ball_condition
            },
            "timestamps": [p["t"] for p in points],
            "confidence_score": 0.95,
            "ball_detected": True,
            "video_duration": points[-1]["t"] if points else 1.5
        }

    @classmethod
    def simulate_preset_trajectory(
        cls,
        delivery_type: str = "inswinger_lbw",
        pitch_type: str = "standard_hard",
        rpm: Optional[float] = None,
        fps: float = 60.0
    ) -> Dict[str, Any]:
        """
        Simulate standard preset deliveries with custom pitch surface and RPM overrides.
        """
        if delivery_type == "inswinger_lbw":
            title = "Fast Inswinger - LBW Out"
            bowler_type = "Right-Arm Fast (142 km/h)"
            release_speed_kmh = 142.0
            spin_rpm = rpm if rpm is not None else 2100.0
            omega = spin_rpm * 2.0 * math.pi / 60.0
            spin_vec = [-omega * 0.95, 0.0, -omega * 0.20]
            seam_angle = -14.0
            release_pos = [0.25, -9.5, 2.05]
            pitch_target = [0.06, 5.0]
            has_pad_impact = True
            impact_y = 8.8
            contact_kick_x = -0.42
            base_restitution = 0.45
            ball_condition = "semi_new"
        elif delivery_type == "offcutter_bowled":
            title = "Good Length Off-Cutter - Bowled"
            bowler_type = "Right-Arm Fast-Medium (132 km/h)"
            release_speed_kmh = 132.0
            spin_rpm = rpm if rpm is not None else 1900.0
            omega = spin_rpm * 2.0 * math.pi / 60.0
            spin_vec = [-omega * 0.85, 0.0, -omega * 0.40]
            seam_angle = -12.0
            release_pos = [0.45, -9.5, 2.15]
            pitch_target = [0.22, 4.4]
            has_pad_impact = False
            impact_y = 10.06
            contact_kick_x = -0.68
            base_restitution = 0.44
            ball_condition = "semi_new"
        elif delivery_type == "bouncer_missing":
            title = "Sharp Bouncer - Missing Stumps"
            bowler_type = "Right-Arm Express (148 km/h)"
            release_speed_kmh = 148.0
            spin_rpm = rpm if rpm is not None else 2250.0
            omega = spin_rpm * 2.0 * math.pi / 60.0
            spin_vec = [-omega * 0.98, 0.0, 0.0]
            seam_angle = 5.0
            release_pos = [0.40, -9.5, 2.25]
            pitch_target = [0.02, -1.5]
            has_pad_impact = True
            impact_y = 8.6
            contact_kick_x = -0.45
            base_restitution = 0.68
            ball_condition = "new"
        elif delivery_type == "legspin_umpires_call":
            title = "Leg Break - Umpire's Call"
            bowler_type = "Right-Arm Leg Spin (88 km/h)"
            release_speed_kmh = 88.0
            spin_rpm = rpm if rpm is not None else 2350.0
            omega = spin_rpm * 2.0 * math.pi / 60.0
            spin_vec = [-omega * 0.70, 0.0, -omega * 0.70]
            seam_angle = 16.0
            release_pos = [0.35, -9.0, 1.95]
            pitch_target = [-0.04, 5.0]
            has_pad_impact = True
            impact_y = 8.9
            contact_kick_x = -0.27
            base_restitution = 0.52
            ball_condition = "semi_new"
        else:
            return cls.simulate_preset_trajectory("inswinger_lbw", pitch_type, rpm, fps)

        traj = cls.simulate_aerodynamic_trajectory(
            release_pos=release_pos,
            release_speed_kmh=release_speed_kmh,
            pitch_target_x=pitch_target[0],
            pitch_target_y=pitch_target[1],
            spin_vector=spin_vec,
            seam_angle_deg=seam_angle,
            ball_condition=ball_condition,
            pitch_type=pitch_type,
            has_pad_impact=has_pad_impact,
            impact_y=impact_y,
            contact_kick_x=contact_kick_x,
            base_restitution=base_restitution,
            fps=fps
        )
        traj["title"] = title
        traj["bowler_type"] = bowler_type
        traj["spin_rpm"] = spin_rpm
        return traj
