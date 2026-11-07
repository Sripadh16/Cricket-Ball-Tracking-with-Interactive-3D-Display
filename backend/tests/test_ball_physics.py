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
