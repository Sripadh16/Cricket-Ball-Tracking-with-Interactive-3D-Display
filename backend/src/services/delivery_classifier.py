"""
Automated Delivery Classification & Cricket Umpiring Rulebook Engine
Analyzes 3D trajectory kinematics for:
- Delivery Type (Inswing, Outswing, Cutters, Seam, Spin) for Left/Right arm bowlers & batters
- Release speed, bounce speed, speed decay %, length zone
- Automated Umpiring: Front-foot No-Ball, Waist-high No-Ball (Beamer), Off/Leg-side Wide
- Complete official ICC DRS LBW Rulebook (Pitching, Impact, Wickets)
"""
import numpy as np
from typing import Dict, Any, List, Optional


class DeliveryClassifier:
    PITCH_LENGTH_M = 20.12
    STUMP_Y = 10.06          # Batsman stumps Y (meters)
    BOWLER_STUMP_Y = -10.06   # Bowler stumps Y (meters)
    BATTER_CREASE_Y = 8.84    # Batsman popping crease Y
    BOWLER_CREASE_Y = -8.84   # Bowler popping crease Y
    STUMP_WIDTH_M = 0.228     # Total width across 3 stumps (9 inches)
    STUMP_HEIGHT_M = 0.711    # Height of wickets (28 inches)
    BALL_RADIUS_M = 0.036     # Standard cricket ball radius (~7.2 cm diameter)
    WIDE_OFF_LINE_M = 0.89    # Return crease / wide tramline distance from middle stump
    WIDE_LEG_MARGIN_M = 0.15  # Leg side wide margin beyond leg stump (RHB: X < -0.15m)
    SEAM_MIN_DEG = 1.2        # smallest seam / turn deviation that is named (gate and type names share it)

    @classmethod
    def classify_delivery(
        cls,
        points: List[Dict[str, Any]],
        bowler_arm: str = "right",        # "right" or "left" (e.g. Arshdeep Singh = "left")
        bowler_mode: str = "over",        # "over" or "round"
        batter_stance: str = "RHB",       # "RHB" (Right-hand) or "LHB" (Left-hand)
        shot_offered: bool = True,
        swing_measurement: Optional[Dict[str, Any]] = None,  # camera-ray swing from the tracker (metres)
        lateral_observable: bool = True,  # False when the camera cannot see the line (side-on stump-plane method)
        line_sigma_m: Optional[float] = None,
        release_speed_kmh: Optional[float] = None,  # authoritative values from the flight fit, when available
        length_zone: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Comprehensive delivery classification & umpire analysis.
        Returns full telemetry, delivery type name, wide/no-ball verdict, and DRS decision.

        World frame: x across the pitch (+x = OFF side for a right-handed batter), y along the pitch towards the
        striker, z up (metres). Air swing and seam deviation therefore share one sign convention:
        positive = moving towards +x (towards OFF for a RHB = away / outswing / leg-cutter / leg-break),
        negative = moving towards -x (towards LEG for a RHB = in / inswing / off-cutter / off-break).
        """
        if not points or len(points) < 2:
            return cls._empty_classification()

        sorted_points = sorted(points, key=lambda p: p.get("t", 0.0))

        # 1. Release Point & Release Speed
        p_first = sorted_points[0]
        # Use first 3-5 points to calculate initial release speed
        n_rel = min(5, len(sorted_points) - 1)
        dt_rel = max(0.01, sorted_points[n_rel]["t"] - p_first["t"])
        dx_rel = sorted_points[n_rel]["x"] - p_first["x"]
        dy_rel = sorted_points[n_rel]["y"] - p_first["y"]
        dz_rel = sorted_points[n_rel]["z"] - p_first["z"]
        rel_speed_mps = np.sqrt(dx_rel**2 + dy_rel**2 + dz_rel**2) / dt_rel
        rel_speed_kmh = round(float(rel_speed_mps * 3.6), 1)
        rel_speed_mph = round(float(rel_speed_kmh * 0.621371), 1)

        # If metric projection produced compressed speeds (< 45 km/h for a cricket delivery),
        # calculate physics-calibrated speed from delivery flight duration across the 17.5m pitch flight:
        total_dt = max(0.05, sorted_points[-1]["t"] - p_first["t"])
        if rel_speed_kmh < 45.0 and 0.15 <= total_dt <= 1.5:
            flight_dist_m = 17.5
            calibrated_speed_kmh = min(156.0, max(78.0, (flight_dist_m / total_dt) * 3.6))
            rel_speed_kmh = round(float(calibrated_speed_kmh), 1)
            rel_speed_mph = round(float(rel_speed_kmh * 0.621371), 1)

        if release_speed_kmh:
            rel_speed_kmh = round(float(release_speed_kmh), 1)
            rel_speed_mph = round(float(rel_speed_kmh * 0.621371), 1)
        length_zone_hint = length_zone

        # 2. Bounce Point Detection (min Z or phase == 'bounce')
        bounce_point = None
        bounce_idx = None
        for i, p in enumerate(sorted_points):
            if p.get("phase") == "bounce":
                bounce_point = p
                bounce_idx = i
                break

        if bounce_point is None and len(sorted_points) >= 5:
            # Detect minimum Z near ground plane
            min_z = float("inf")
            min_idx = None
            for i in range(1, len(sorted_points) - 1):
                if sorted_points[i]["z"] < min_z:
                    min_z = sorted_points[i]["z"]
                    min_idx = i
            if min_idx is not None and min_z <= 0.45:
                bounce_point = sorted_points[min_idx]
                bounce_idx = min_idx

        # Pre-bounce and post-bounce segments
        if bounce_idx is not None:
            pre_bounce = sorted_points[:bounce_idx]
            post_bounce = sorted_points[bounce_idx:]
        else:
            pre_bounce = sorted_points
            post_bounce = []

        # 3. Bounce Speed & Restitution Decay
        bounce_speed_kmh = None
        speed_loss_pct = None
        if post_bounce and len(post_bounce) >= 2:
            n_post = min(3, len(post_bounce) - 1)
            dt_post = max(0.01, post_bounce[n_post]["t"] - post_bounce[0]["t"])
            dx_post = post_bounce[n_post]["x"] - post_bounce[0]["x"]
            dy_post = post_bounce[n_post]["y"] - post_bounce[0]["y"]
            dz_post = post_bounce[n_post]["z"] - post_bounce[0]["z"]
            b_speed_mps = np.sqrt(dx_post**2 + dy_post**2 + dz_post**2) / dt_post
            bounce_speed_kmh = round(float(b_speed_mps * 3.6), 1)
            if rel_speed_kmh > 10.0:
                speed_loss_pct = round(float(((rel_speed_kmh - bounce_speed_kmh) / rel_speed_kmh) * 100), 1)
        else:
            # Typical turf restitution estimate if post-bounce is sparse
            bounce_speed_kmh = round(rel_speed_kmh * 0.62, 1)
            speed_loss_pct = 38.0

        # 4. Length Zone
        length_zone = "Good Length"
        if bounce_point:
            dist_from_stumps = cls.STUMP_Y - bounce_point["y"]
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
        else:
            # Check maximum height across trajectory
            max_z = max(p["z"] for p in sorted_points)
            if max_z > 1.8:
                length_zone = "Bouncer"
            elif max_z < 0.6:
                length_zone = "Yorker"

        if length_zone_hint:
            length_zone = length_zone_hint

        # 5. Lateral Air Curvature (Swing) & Pitch Deviation (Cut/Spin)
        # Air swing = sideways distance, at the end of the air phase, between the actual path and the straight
        # line the ball was launched on. Quadratic fit x(t) = a0 + a1*t + a2*t^2 over the pre-bounce points:
        # swing = a2 * T^2 (T = air time). + = towards +x (off for a RHB), - = towards leg (inswing into a RHB).
        air_swing_mm = 0.0
        air_swing_sigma_mm = None
        swing_method = "fitted_path"
        if swing_measurement and swing_measurement.get("swing_m") is not None:
            air_swing_mm = round(float(swing_measurement["swing_m"]) * 1000.0, 1)
            air_swing_sigma_mm = round(float(swing_measurement.get("sigma_m") or 0.0) * 1000.0, 1)
            swing_method = "camera_ray_curvature"
        elif len(pre_bounce) >= 4:
            tt = np.array([p["t"] for p in pre_bounce], dtype=float)
            xx = np.array([p["x"] for p in pre_bounce], dtype=float)
            if tt[-1] - tt[0] > 1e-3:
                tm = tt - tt[0]
                a2 = float(np.polyfit(tm, xx, 2)[0])
                air_swing_mm = round(float(a2 * tm[-1] ** 2 * 1000.0), 1)
        if not lateral_observable:
            air_swing_mm, air_swing_sigma_mm, swing_method = 0.0, None, "not_observable"

        # Post-bounce seam/spin angle: change of the ground-track heading at the bounce.
        # + = the ball deviates towards +x (away from a RHB: leg-cutter / leg-break), - = back in towards leg.
        pitch_deviation_deg = 0.0
        if lateral_observable and bounce_point and post_bounce and len(pre_bounce) >= 2 and len(post_bounce) >= 2:
            dx_pre = pre_bounce[-1]["x"] - pre_bounce[0]["x"]
            dy_pre = max(0.1, pre_bounce[-1]["y"] - pre_bounce[0]["y"])
            ang_pre = np.arctan2(dx_pre, dy_pre)

            dx_post = post_bounce[-1]["x"] - post_bounce[0]["x"]
            dy_post = max(0.1, post_bounce[-1]["y"] - post_bounce[0]["y"])
            ang_post = np.arctan2(dx_post, dy_post)
            pitch_deviation_deg = round(float(np.degrees(ang_post - ang_pre)), 2)

        # Significance: the classifier only names swing / seam movement that the measurement can resolve.
        swing_noise_mm = max(25.0, 2.0 * (air_swing_sigma_mm or 0.0))
        swing_significant = lateral_observable and abs(air_swing_mm) >= swing_noise_mm
        post_len = 0.0
        if post_bounce and len(post_bounce) >= 2:
            post_len = float(np.hypot(post_bounce[-1]["x"] - post_bounce[0]["x"],
                                      post_bounce[-1]["y"] - post_bounce[0]["y"]))
        seam_noise_deg = cls.SEAM_MIN_DEG
        if line_sigma_m:
            seam_noise_deg = max(cls.SEAM_MIN_DEG, float(np.degrees(2.0 * line_sigma_m / max(1.0, post_len))))
        seam_significant = lateral_observable and abs(pitch_deviation_deg) >= seam_noise_deg

        # 6. Delivery Type Classifier
        is_left_arm = bowler_arm.lower() == "left"
        is_rhb = batter_stance.upper() == "RHB"

        if lateral_observable:
            delivery_type, delivery_name = cls._determine_delivery_type(
                rel_speed_kmh=rel_speed_kmh,
                length_zone=length_zone,
                air_swing_mm=air_swing_mm if swing_significant else 0.0,
                pitch_deviation_deg=pitch_deviation_deg if seam_significant else 0.0,
                is_left_arm=is_left_arm,
                is_rhb=is_rhb
            )
        else:
            pace = cls.pace_category(rel_speed_kmh)
            delivery_type = "length_only"
            delivery_name = f"{'Left' if is_left_arm else 'Right'}-Arm {pace['label']} · {length_zone}"
        swing_analysis = cls.build_swing_analysis(
            rel_speed_kmh=rel_speed_kmh, length_zone=length_zone, bounce_point=bounce_point,
            air_swing_mm=air_swing_mm, air_swing_sigma_mm=air_swing_sigma_mm, swing_method=swing_method,
            swing_significant=swing_significant, swing_measurement=swing_measurement,
            pitch_deviation_deg=pitch_deviation_deg, seam_significant=seam_significant,
            seam_noise_deg=seam_noise_deg, lateral_observable=lateral_observable,
            delivery_type=delivery_type, delivery_name=delivery_name, is_left_arm=is_left_arm, is_rhb=is_rhb)

        # 7. Automated Umpiring: Wide & No-Ball Detection
        is_no_ball = False
        no_ball_reason = None
        is_wide = False
        wide_reason = None

        # Check front-foot no-ball: only if initial track begins near the bowler crease (Y <= -6.5m)
        # and starts ahead of popping crease (Y > -8.5m)
        if -8.5 <= p_first["y"] <= -6.5:
            is_no_ball = True
            no_ball_reason = "Front Foot Crease Overstep"

        # Check waist-high beamer no-ball & wide ball
        at_batter_crease = [p for p in sorted_points if p["y"] >= cls.BATTER_CREASE_Y - 1.0]
        if at_batter_crease:
            p_crease = at_batter_crease[0]
            if bounce_point is None and p_crease["z"] > 1.15:
                is_no_ball = True
                no_ball_reason = f"Waist-High Full Toss ({p_crease['z']:.2f}m)"

            # Check wide ball
            x_crease = p_crease["x"]
            if is_rhb:
                if x_crease > cls.WIDE_OFF_LINE_M:
                    is_wide = True
                    wide_reason = f"Off-Side Tramline ({x_crease:.2f}m)"
                elif x_crease < -cls.WIDE_LEG_MARGIN_M:
                    is_wide = True
                    wide_reason = f"Leg-Side Wide ({x_crease:.2f}m)"
            else:
                if x_crease < -cls.WIDE_OFF_LINE_M:
                    is_wide = True
                    wide_reason = f"Off-Side Tramline ({x_crease:.2f}m)"
                elif x_crease > cls.WIDE_LEG_MARGIN_M:
                    is_wide = True
                    wide_reason = f"Leg-Side Wide ({x_crease:.2f}m)"

        # 8. DRS LBW Verdict
        drs_evaluation = cls._evaluate_drs_lbw(
            sorted_points=sorted_points,
            bounce_point=bounce_point,
            is_rhb=is_rhb,
            shot_offered=shot_offered
        )

        return {
            "delivery_type": delivery_type,
            "delivery_name": delivery_name,
            "bowler_arm": "Left-Arm" if is_left_arm else "Right-Arm",
            "batter_stance": batter_stance,
            "release_speed_kmh": rel_speed_kmh,
            "release_speed_mph": rel_speed_mph,
            "bounce_speed_kmh": bounce_speed_kmh,
            "speed_loss_pct": speed_loss_pct,
            "length_zone": length_zone,
            "air_swing_mm": air_swing_mm,
            "pitch_deviation_deg": pitch_deviation_deg,
            "is_no_ball": is_no_ball,
            "no_ball_reason": no_ball_reason,
            "is_wide": is_wide,
            "wide_reason": wide_reason,
            "drs_evaluation": drs_evaluation,
            "bounce_point": bounce_point,
            "swing_analysis": swing_analysis,
            "summary": f"{delivery_name} · {rel_speed_kmh} km/h · {length_zone}"
        }

    @staticmethod
    def pace_category(kmh: float) -> Dict[str, str]:
        """Bowler pace band from release speed (broadcast-style bands)."""
        if kmh < 88.0:
            return {"key": "spin", "label": "Spin / Slow", "bowler_type": "spin"}
        if kmh < 115.0:
            return {"key": "medium", "label": "Medium Pace", "bowler_type": "pace"}
        if kmh < 130.0:
            return {"key": "medium_fast", "label": "Medium-Fast", "bowler_type": "pace"}
        if kmh < 140.0:
            return {"key": "fast_medium", "label": "Fast-Medium", "bowler_type": "pace"}
        return {"key": "fast", "label": "Fast", "bowler_type": "pace"}

    @classmethod
    def build_swing_analysis(cls, *, rel_speed_kmh, length_zone, bounce_point, air_swing_mm, air_swing_sigma_mm,
                             swing_method, swing_significant, swing_measurement, pitch_deviation_deg,
                             seam_significant, seam_noise_deg, lateral_observable, delivery_type, delivery_name,
                             is_left_arm, is_rhb) -> Dict[str, Any]:
        """Self-describing swing / seam / delivery-type summary for the UI ("Swing & delivery classifier")."""
        pace = cls.pace_category(rel_speed_kmh)
        spin = pace["bowler_type"] == "spin"
        off_sign = 1.0 if is_rhb else -1.0  # +x is the off side for a RHB, the leg side for a LHB
        batter = "right-hander" if is_rhb else "left-hander"

        def towards(v):
            return "away" if v * off_sign > 0 else "in"

        swing_dir = "none"
        if swing_significant:
            swing_dir = "outswing" if towards(air_swing_mm) == "away" else "inswing"
        seam_dir = "none"
        if seam_significant:
            seam_dir = towards(pitch_deviation_deg)
        dist = None
        if bounce_point is not None and bounce_point.get("y") is not None:
            dist = round(float(cls.STUMP_Y - bounce_point["y"]), 2)

        parts = [f"Released at {rel_speed_kmh:.0f} km/h, i.e. {pace['label'].lower()}"
                 + (" (below 88 km/h is treated as spin / slow bowling)." if spin else ".")]
        if dist is not None:
            parts.append(f"Pitched {dist:.1f} m from the striker's stumps: {length_zone}.")
        else:
            parts.append("Did not bounce before reaching the batter: full toss.")
        if not lateral_observable:
            parts.append("The camera views the pitch side-on, so sideways movement (swing / seam) cannot be "
                         "measured; the delivery is classified by pace and length only.")
        else:
            sig = f" ± {air_swing_sigma_mm:.0f}" if air_swing_sigma_mm else ""
            if swing_significant:
                parts.append(f"In the air it moved {abs(air_swing_mm):.0f}{sig} mm {('away from' if swing_dir == 'outswing' else 'into')} "
                             f"the {batter} ({swing_dir}).")
            else:
                parts.append(f"No significant swing in the air ({air_swing_mm:+.0f}{sig} mm is within measurement noise).")
            if bounce_point is None:
                pass
            elif seam_significant:
                word = ("turned" if spin else "seamed")
                parts.append(f"Off the pitch it {word} {abs(pitch_deviation_deg):.1f}° "
                             f"{'away from' if seam_dir == 'away' else 'back into'} the {batter}.")
            else:
                parts.append(f"Off the pitch the line held ({pitch_deviation_deg:+.1f}° is below the "
                             f"{seam_noise_deg:.1f}° resolution).")
        parts.append(f"Classified as: {delivery_name}.")

        return {
            "available": True,
            "lateral_measurable": bool(lateral_observable),
            "swing_method": swing_method,
            "air_swing_mm": float(air_swing_mm),
            "air_swing_sigma_mm": air_swing_sigma_mm,
            "air_swing_significant": bool(swing_significant),
            "swing_direction": swing_dir,  # "inswing" | "outswing" | "none" (relative to the batter)
            "lateral_accel_mps2": (round(float(swing_measurement["lateral_accel_mps2"]), 3)
                                   if swing_measurement and swing_method == "camera_ray_curvature" else None),
            "air_time_s": swing_measurement.get("air_time_s") if swing_measurement else None,
            "seam_deviation_deg": float(pitch_deviation_deg),
            "seam_resolution_deg": round(float(seam_noise_deg), 2),
            "seam_significant": bool(seam_significant),
            "seam_direction": seam_dir,  # "in" | "away" | "none" (relative to the batter)
            "movement_kind": "spin" if spin else "seam",
            "release_speed_kmh": rel_speed_kmh,
            "pace_category": pace["label"],
            "pace_key": pace["key"],
            "bowler_type": pace["bowler_type"],
            "length_zone": length_zone,
            "bounce_distance_from_stumps_m": dist,
            "delivery_type": delivery_type,
            "delivery_name": delivery_name,
            "bowler_arm": "Left-Arm" if is_left_arm else "Right-Arm",
            "batter_stance": "RHB" if is_rhb else "LHB",
            "explanation": " ".join(parts),
            "conventions": {
                "frame": "x across the pitch (+x = off side for a right-handed batter), y bowler -> striker, z up, metres",
                "air_swing_mm": "sideways distance at the bounce (or at the batter for a full toss) between the actual "
                                "path and the straight line the ball was launched on; + = towards +x (off side for a RHB, "
                                "outswing), - = towards leg (inswing into a RHB)",
                "seam_deviation_deg": "change of the ground-track heading at the bounce; + = towards +x (away from a RHB: "
                                      "leg-cutter / leg-break), - = back in towards leg (off-cutter / off-break for a RHB)",
                "pace_bands_kmh": "spin/slow < 88 <= medium < 115 <= medium-fast < 130 <= fast-medium < 140 <= fast",
            },
        }

    @classmethod
    def _determine_delivery_type(
        cls,
        rel_speed_kmh: float,
        length_zone: str,
        air_swing_mm: float,
        pitch_deviation_deg: float,
        is_left_arm: bool,
        is_rhb: bool
    ) -> tuple:
        """Classify delivery name and category from ballistics and handedness"""
        arm_str = "Left-Arm" if is_left_arm else "Right-Arm"

        # Bouncer
        if length_zone == "Bouncer":
            return "bouncer", f"{arm_str} Fast Bouncer"
        # Yorker
        if length_zone == "Yorker":
            return "yorker", f"{arm_str} Toe-Crushing Yorker"

        # Spinners (< 88 km/h; club medium pace is ~90-115 km/h, international spin rarely exceeds ~95)
        if rel_speed_kmh < 88.0:
            # +x is the off side for a right-hander: positive deviation turns the ball towards off (away from a RHB)
            if pitch_deviation_deg <= -cls.SEAM_MIN_DEG:
                return "off_spin", "Off-Break (Turning into RHB)" if is_rhb else "Off-Break (Turning away)"
            elif pitch_deviation_deg >= cls.SEAM_MIN_DEG:
                return "leg_spin", "Leg-Break (Turning away from RHB)" if is_rhb else "Leg-Break (Turning into LHB)"
            else:
                return "arm_ball", "Arm Ball (Straight through)"

        # Pace bowling: swing & cutters. Signs are made batter-relative first (+x is the off side for a RHB,
        # the leg side for a LHB): negative = moving in towards the batter's legs, positive = moving away.
        if not is_rhb:
            air_swing_mm, pitch_deviation_deg = -air_swing_mm, -pitch_deviation_deg
        if is_left_arm:
            # Left-Arm Over (e.g. Arshdeep, Starc, Shaheen)
            if air_swing_mm < -15.0 or pitch_deviation_deg <= -cls.SEAM_MIN_DEG:
                return "left_arm_inswing", "Left-Arm Inswinger (Curving into the batter)"
            elif air_swing_mm > 15.0 or pitch_deviation_deg >= cls.SEAM_MIN_DEG:
                return "left_arm_away", "Left-Arm Angled Away (Beating outside edge)"
            else:
                return "left_arm_seam", "Left-Arm Fast Seam Delivery"
        else:
            # Right-Arm Over
            if air_swing_mm < -20.0:
                return "inswinger", "Conventional Inswinger (Curving in)"
            elif air_swing_mm > 20.0:
                return "outswinger", "Late Outswinger (Shaping away)"
            elif pitch_deviation_deg <= -cls.SEAM_MIN_DEG:
                return "off_cutter", "Off-Cutter (Gripping & nipping in)"
            elif pitch_deviation_deg >= cls.SEAM_MIN_DEG:
                return "leg_cutter", "Leg-Cutter (Holding line / seaming away)"
            else:
                return "straight_seam", "Upright Seam Delivery"

    @classmethod
    def _evaluate_drs_lbw(
        cls,
        sorted_points: List[Dict[str, Any]],
        bounce_point: Optional[Dict[str, Any]],
        is_rhb: bool,
        shot_offered: bool
    ) -> Dict[str, Any]:
        """
        Official ICC 3-Stage DRS LBW Rulebook evaluation
        """
        stump_half_w = (cls.STUMP_WIDTH_M / 2.0) + cls.BALL_RADIUS_M  # ~0.150m corridor

        # 1. Pitching Zone
        if bounce_point:
            bx = bounce_point["x"]
            if abs(bx) <= stump_half_w:
                pitching = "IN LINE"
            elif (is_rhb and bx > stump_half_w) or (not is_rhb and bx < -stump_half_w):
                pitching = "OUTSIDE OFF"
            else:
                pitching = "OUTSIDE LEG"
        else:
            pitching = "IN LINE"

        # 2. Impact Zone (at or near batter popping crease Y = 8.84m)
        impact_point = sorted_points[-1]
        at_crease = [p for p in sorted_points if p["y"] >= cls.BATTER_CREASE_Y - 0.5]
        if at_crease:
            impact_point = at_crease[0]

        ix = impact_point["x"]
        if abs(ix) <= stump_half_w:
            impact = "IN LINE"
        elif (is_rhb and ix > stump_half_w) or (not is_rhb and ix < -stump_half_w):
            impact = "OUTSIDE OFF"
        else:
            impact = "OUTSIDE LEG"

        # 3. Wickets Extrapolation to Stump Plane (Y = 10.06m)
        # Compute trajectory vector from last points
        p_ref = sorted_points[-1]
        p_prev = sorted_points[-2] if len(sorted_points) >= 2 else p_ref
        dt = max(0.01, p_ref["t"] - p_prev["t"])
        vy = max(5.0, (p_ref["y"] - p_prev["y"]) / dt)
        vx = (p_ref["x"] - p_prev["x"]) / dt
        vz = (p_ref["z"] - p_prev["z"]) / dt - (9.81 * 0.05)  # slight gravity drop

        dist_to_stump = max(0.0, cls.STUMP_Y - p_ref["y"])
        time_to_stump = dist_to_stump / vy

        target_x = round(float(p_ref["x"] + vx * time_to_stump), 4)
        target_z = round(float(max(0.05, p_ref["z"] + vz * time_to_stump - 0.5 * 9.81 * (time_to_stump**2))), 4)

        # Hit stumps check
        hit_x = abs(target_x) <= stump_half_w
        hit_z = target_z <= (cls.STUMP_HEIGHT_M + cls.BALL_RADIUS_M) and target_z >= 0.03

        stump_hit = "None"
        if hit_x and hit_z:
            if abs(target_x) < 0.04:
                stump_hit = "Middle Stump"
            elif (is_rhb and target_x > 0) or (not is_rhb and target_x < 0):
                stump_hit = "Off Stump"
            else:
                stump_hit = "Leg Stump"

            if target_z >= cls.STUMP_HEIGHT_M - 0.04:
                stump_hit = f"Top of {stump_hit} / Bails"

            # Check core vs edge
            is_outer_edge = abs(target_x) > (stump_half_w - 0.035) or target_z > (cls.STUMP_HEIGHT_M - 0.02)
            wickets = "UMPIRE'S CALL" if is_outer_edge else "HITTING"
        else:
            wickets = "MISSING"

        # 4. Final Verdict Resolution
        # Rule 1: Pitched Outside Leg -> ALWAYS NOT OUT
        if pitching == "OUTSIDE LEG":
            decision = "NOT OUT (Pitched Outside Leg)"
        # Rule 2: Impact Outside Off when playing a shot -> NOT OUT
        elif impact == "OUTSIDE OFF" and shot_offered:
            decision = "NOT OUT (Impact Outside Off)"
        elif impact == "OUTSIDE LEG":
            decision = "NOT OUT (Impact Outside Leg)"
        # Rule 3: Wickets Missing -> NOT OUT
        elif wickets == "MISSING":
            decision = "NOT OUT (Missing Stumps)"
        # Rule 4: Wickets Umpire's Call
        elif wickets == "UMPIRE'S CALL" or impact == "UMPIRE'S CALL":
            decision = "UMPIRE'S CALL"
        # Rule 5: Pitching In Line/Off, Impact In Line, Wickets Hitting -> OUT
        else:
            decision = "OUT"

        return {
            "decision": decision,
            "pitching": pitching,
            "impact": impact,
            "wickets": wickets,
            "hit_stump": stump_hit,
            "target_plane_coords": {"x": target_x, "y": cls.STUMP_Y, "z": target_z},
            "shot_offered": shot_offered
        }

    @classmethod
    def _empty_classification(cls) -> Dict[str, Any]:
        return {
            "delivery_type": "unknown",
            "delivery_name": "Standard Delivery",
            "bowler_arm": "Right-Arm",
            "batter_stance": "RHB",
            "release_speed_kmh": 0.0,
            "release_speed_mph": 0.0,
            "bounce_speed_kmh": 0.0,
            "speed_loss_pct": 0.0,
            "length_zone": "Good Length",
            "air_swing_mm": 0.0,
            "pitch_deviation_deg": 0.0,
            "is_no_ball": False,
            "no_ball_reason": None,
            "is_wide": False,
            "wide_reason": None,
            "drs_evaluation": {
                "decision": "NOT AVAILABLE",
                "pitching": "N/A",
                "impact": "N/A",
                "wickets": "N/A",
                "hit_stump": "N/A"
            },
            "bounce_point": None,
            "summary": "Insufficient trajectory points"
        }
