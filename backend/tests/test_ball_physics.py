"""
Unit tests for Cricket Ball Tracking Physics, Ballistics, and Hawk-Eye DRS simulation.
"""
import pytest
import sys
import os

# Ensure backend/src is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from services.sample_generator import DeliveryPhysicsSimulator, PITCH_LENGTH, STUMP_Y, STUMP_HEIGHT, STUMP_WIDTH

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
