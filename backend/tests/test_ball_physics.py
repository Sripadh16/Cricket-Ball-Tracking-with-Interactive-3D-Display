"""
Unit tests for Cricket Ball Tracking Physics, Ballistics, and Hawk-Eye DRS simulation.
"""
import pytest
import sys
import os

# Ensure backend/src is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from services.sample_generator import DeliveryPhysicsSimulator, PITCH_LENGTH, STUMP_Y, STUMP_HEIGHT, STUMP_WIDTH
from services.ball_physics_engine import BallPhysicsEngine, PITCH_PROFILES, BALL_MASS, GRAVITY

class TestDeliveryPhysicsSimulator:

    def test_inswinger_lbw_verdict(self):
        data = DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw")
        assert data["ball_detected"] is True
        assert len(data["points"]) > 20
        assert len(data["pre_bounce_points"]) > 0
        assert len(data["post_bounce_points"]) > 0
        assert len(data["extrapolated_points"]) > 0
        assert data["bounce_point"] is not None
        assert data["impact_point"] is not None

        drs = data["drs_evaluation"]
        assert drs["decision"] == "OUT"
        assert drs["pitching"] == "IN LINE"
        assert drs["impact"] == "IN LINE"
        assert drs["wickets"] == "HITTING"
        assert drs["hit_stump"] in ["Middle Stump", "Leg Stump"]

    def test_bouncer_missing_verdict(self):
        data = DeliveryPhysicsSimulator.generate_delivery("bouncer_missing")
        drs = data["drs_evaluation"]
        assert "NOT OUT" in drs["decision"]
        assert drs["wickets"] == "MISSING"

    def test_legspin_umpires_call(self):
        data = DeliveryPhysicsSimulator.generate_delivery("legspin_umpires_call")
        drs = data["drs_evaluation"]
        assert drs["decision"] == "UMPIRE'S CALL"
        assert drs["wickets"] == "UMPIRE'S CALL"

    def test_offcutter_bowled(self):
        data = DeliveryPhysicsSimulator.generate_delivery("offcutter_bowled")
        drs = data["drs_evaluation"]
        assert "OUT" in drs["decision"]
        assert drs["wickets"] == "HITTING"
        assert drs["hit_stump"] == "Off Stump"

    def test_physics_boundaries(self):
        for dtype in ["inswinger_lbw", "offcutter_bowled", "bouncer_missing", "legspin_umpires_call"]:
            data = DeliveryPhysicsSimulator.generate_delivery(dtype)
            for pt in data["points"]:
                # Height must be non-negative
                assert pt["z"] >= 0.03
                # Y should be within cricket ground span
                assert -11.0 <= pt["y"] <= 12.0
                # Speed should be positive and realistic (< 165 km/h)
                assert 50.0 <= pt["speed_kmh"] <= 165.0

    def test_3d_force_vectors_in_telemetry(self):
        """Points must contain instantaneous 3D force vectors and aerodynamics metrics."""
        data = DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw")
        for pt in data["points"][:10]:
            assert "velocity_vector" in pt
            assert len(pt["velocity_vector"]) == 3
            assert "magnus_vector" in pt
            assert len(pt["magnus_vector"]) == 3
            assert "gravity_vector" in pt
            assert len(pt["gravity_vector"]) == 3
            assert pt["gravity_vector"][2] < 0  # Downward gravity
            assert "spin_vector" in pt
            assert len(pt["spin_vector"]) == 3
            assert "reynolds_number" in pt
            assert pt["reynolds_number"] > 50000

    def test_magnus_effect_rpm_scaling(self):
        """Higher spin RPM must induce greater Magnus aerodynamic force."""
        f_low = BallPhysicsEngine.calculate_instantaneous_forces(
            velocity=[0.0, 35.0, 0.0],
            spin_vector=[-80.0, 0.0, 0.0],  # ~760 RPM
            seam_angle_deg=0.0
        )
        f_high = BallPhysicsEngine.calculate_instantaneous_forces(
            velocity=[0.0, 35.0, 0.0],
            spin_vector=[-260.0, 0.0, 0.0],  # ~2480 RPM
            seam_angle_deg=0.0
        )
        assert f_high["magnus_force_n"] > f_low["magnus_force_n"]
        assert f_high["lift_coefficient"] > f_low["lift_coefficient"]

    def test_pitch_surface_restitution_profiles(self):
        """Green seamer must produce higher bounce than damp clay and dry dusty."""
        green_prof = BallPhysicsEngine.get_pitch_profile("green_seamer")
        clay_prof = BallPhysicsEngine.get_pitch_profile("damp_clay")
        dusty_prof = BallPhysicsEngine.get_pitch_profile("dry_dusty")
        hard_prof = BallPhysicsEngine.get_pitch_profile("standard_hard")

        assert green_prof["restitution_z"] == 0.68
        assert green_prof["friction"] == 0.28
        assert dusty_prof["friction"] == 0.48
        assert dusty_prof["restitution_z"] == 0.52
        assert clay_prof["restitution_z"] == 0.45
        assert hard_prof["restitution_z"] == 0.60

        # Simulated trajectory on green seamer has higher bounce than on damp clay
        t_green = DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw", pitch_type="green_seamer")
        t_clay = DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw", pitch_type="damp_clay")

        # Stump plane height or post-bounce height is higher for green seamer
        assert t_green["stump_plane_target"]["z"] > t_clay["stump_plane_target"]["z"]

    def test_no_duplicate_timestamps_and_rpm_normalization(self):
        """Every preset must have strictly monotonic timestamps and exact RPM."""
        for dt, expected_rpm in [
            ("inswinger_lbw", 2100.0),
            ("offcutter_bowled", 1900.0),
            ("bouncer_missing", 2250.0),
            ("legspin_umpires_call", 2350.0)
        ]:
            data = DeliveryPhysicsSimulator.generate_delivery(dt)
            ts = [p["t"] for p in data["points"]]
            for i in range(len(ts) - 1):
                assert ts[i] < ts[i + 1], f"Duplicate or non-monotonic timestamp in {dt}: {ts[i]} >= {ts[i+1]}"
            assert abs(data["points"][0]["spin_rpm"] - expected_rpm) < 1.0, f"RPM mismatch in {dt}"

    def test_stump_plane_exact_interpolation(self):
        """Stump plane target must be exactly at y=10.06m."""
        for dt in ["inswinger_lbw", "offcutter_bowled", "bouncer_missing", "legspin_umpires_call"]:
            data = DeliveryPhysicsSimulator.generate_delivery(dt)
            target = data["stump_plane_target"]
            assert target["y"] == 10.06

    def test_event_types_and_pad_interception(self):
        """Inswinger & Legspin must be LBW predictions; Offcutter must be bowled collision; Bouncer must be missing without pad strike."""
        inswinger = DeliveryPhysicsSimulator.generate_delivery("inswinger_lbw")
        assert inswinger["event_type"] == "lbw_pad_predicted"
        assert inswinger["has_pad_interception"] is True
        assert inswinger["collision_event"]["type"] == "lbw_predicted"

        offcutter = DeliveryPhysicsSimulator.generate_delivery("offcutter_bowled")
        assert offcutter["event_type"] == "bowled_collision"
        assert offcutter["has_pad_interception"] is False
        assert offcutter["collision_event"]["type"] == "bowled"

        bouncer = DeliveryPhysicsSimulator.generate_delivery("bouncer_missing")
        assert bouncer["event_type"] == "not_out_missing"
        assert bouncer["has_pad_interception"] is False
        assert bouncer["impact_point"] is None

    def test_all_16_preset_turf_combinations(self):
        """All 16 combinations of 4 presets and 4 turf profiles must simulate successfully with computed results."""
        turf_profiles = ["standard_hard", "green_seamer", "dry_dusty", "damp_clay"]
        presets = ["inswinger_lbw", "offcutter_bowled", "bouncer_missing", "legspin_umpires_call"]

        for dt in presets:
            for turf in turf_profiles:
                data = DeliveryPhysicsSimulator.generate_delivery(dt, pitch_type=turf)
                assert data["ball_detected"] is True
                assert len(data["points"]) > 20
                assert "drs_evaluation" in data
                assert "decision" in data["drs_evaluation"]
                assert data["stump_plane_target"]["y"] == 10.06
