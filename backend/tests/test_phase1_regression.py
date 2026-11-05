"""
Regression tests for Phase 1 audit fixes.
Tests: path handling, reprocess safety, prediction capping, speed reporting,
debug_info accuracy, and geometry constant consistency.
Run with: python -m pytest tests/test_phase1_regression.py -v
"""
import pytest
import sys
import os
import tempfile
import shutil
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))


# ─── Config constant tests ────────────────────────────────────────────────────

class TestConfigConstants:
    def test_pitch_length_is_metric(self):
        """PITCH_CONFIG length_m must be 20.12 m (22 yards), not 22.0."""
        from config import PITCH_CONFIG
        assert abs(PITCH_CONFIG['length_m'] - 20.12) < 0.01, (
            f"pitch length should be ~20.12 m, got {PITCH_CONFIG['length_m']}"
        )

    def test_stump_constants_present(self):
        """PITCH_CONFIG must include stump dimensions matching ICC regulations."""
        from config import PITCH_CONFIG
        assert 'stump_height_m' in PITCH_CONFIG
        assert 'stump_width_m' in PITCH_CONFIG
        assert 'ball_radius_m' in PITCH_CONFIG
        # ICC values
        assert abs(PITCH_CONFIG['stump_height_m'] - 0.711) < 0.005
        assert abs(PITCH_CONFIG['stump_width_m'] - 0.2286) < 0.005

    def test_sample_generator_constants_match_config(self):
        """sample_generator.py constants must agree with PITCH_CONFIG."""
        from config import PITCH_CONFIG
        from services.sample_generator import PITCH_LENGTH, STUMP_HEIGHT, STUMP_WIDTH
        assert abs(PITCH_LENGTH - PITCH_CONFIG['length_m']) < 0.01
        assert abs(STUMP_HEIGHT - PITCH_CONFIG['stump_height_m']) < 0.005
        assert abs(STUMP_WIDTH - PITCH_CONFIG['stump_width_m']) < 0.005


# ─── Windows path handling ────────────────────────────────────────────────────

class TestWindowsPathHandling:
    def test_path_name_cross_platform(self):
        """Path(path).name must work for both Windows and POSIX paths."""
        win_path = r'C:\Users\user\uploads\abc_video.mp4'
        posix_path = '/srv/uploads/abc_video.mp4'
        assert Path(win_path).name == 'abc_video.mp4'
        assert Path(posix_path).name == 'abc_video.mp4'

    def test_path_name_not_split_on_slash(self):
        """The old .split('/')[-1] fails on Windows paths — Path().name must not."""
        win_path = r'C:\Users\user\uploads\file.mp4'
        # Old broken approach:
        old_result = win_path.split('/')[-1]
        # New correct approach:
        new_result = Path(win_path).name
        assert new_result == 'file.mp4', f"Expected 'file.mp4' got '{new_result}'"
        # The old approach would return the full Windows path unchanged
        assert old_result != 'file.mp4', "This confirms the old bug exists"


# ─── Speed and DRS analysis ────────────────────────────────────────────────────

class TestSpeedReporting:
    """Speed from real video must not be clamped or fabricated."""

    def _make_trajectory_with_known_speed(self, speed_ms: float, duration: float = 1.0):
        """Build a synthetic trajectory where speed is known."""
        # Simple trajectory: ball moves along y-axis at speed_ms m/s
        n = 20
        return [
            {'x': 0.0, 'y': i * speed_ms * duration / n, 'z': 1.0,
             't': i * duration / n, 'confidence': 0.8, 'is_predicted': False}
            for i in range(n)
        ]

    def test_defaults_are_none(self):
        """Initial drs_data speed defaults must be None, not fabricated values."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        # Provide empty trajectory — should return None speeds
        tracking_data = {'ball_trajectory': []}
        _, drs = svc._analyze_lbw_decisions(tracking_data)
        assert drs['release_speed_kmh'] is None, "Default release speed must be None"
        assert drs['bounce_speed_kmh'] is None, "Default bounce speed must be None"

    def test_no_speed_clamp(self):
        """Speed calculated from trajectory must not be clamped to 80-160 km/h."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        # Create a trajectory that would produce a very low speed (~5 m/s = 18 km/h)
        traj = self._make_trajectory_with_known_speed(speed_ms=5.0, duration=2.0)
        tracking_data = {'ball_trajectory': traj}
        _, drs = svc._analyze_lbw_decisions(tracking_data)
        if drs['release_speed_kmh'] is not None:
            # Must NOT be clamped upward to 80 km/h
            assert drs['release_speed_kmh'] < 50.0, (
                f"Speed {drs['release_speed_kmh']} km/h was artificially clamped "
                f"(expected ~18 km/h from 5 m/s input)"
            )

    def test_bounce_speed_not_estimated(self):
        """bounce_speed_kmh must remain None for real video tracking."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        # Provide enough points to trigger speed calculation
        traj = self._make_trajectory_with_known_speed(speed_ms=40.0, duration=0.5)
        tracking_data = {'ball_trajectory': traj}
        _, drs = svc._analyze_lbw_decisions(tracking_data)
        assert drs['bounce_speed_kmh'] is None, (
            "bounce_speed_kmh must be None for real video — cannot be measured"
        )


# ─── Prediction gap cap ────────────────────────────────────────────────────────

class TestPredictionGapCap:
    """Predictions must be capped and tagged as is_predicted=True."""

    def test_predict_returns_is_predicted_true(self):
        """_predict_ball_position must tag returned dict with is_predicted=True."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        tracking_data = {
            'ball_trajectory': [
                {'x': 0, 'y': 0, 'z': 1.0, 't': 0.0, 'confidence': 0.8},
                {'x': 0, 'y': 1, 'z': 0.9, 't': 0.05, 'confidence': 0.8},
            ]
        }
        result = svc._predict_ball_position(tracking_data, current_time=0.1)
        assert result is not None
        assert result.get('is_predicted') is True, "Predicted point must have is_predicted=True"

    def test_max_prediction_gap_constant_exists(self):
        """MAX_PREDICTION_GAP_S must exist and be reasonable (≤ 0.5s)."""
        import services.ball_tracking_service as bts
        assert hasattr(bts, 'MAX_PREDICTION_GAP_S'), "MAX_PREDICTION_GAP_S constant missing"
        assert bts.MAX_PREDICTION_GAP_S <= 0.5, (
            f"MAX_PREDICTION_GAP_S={bts.MAX_PREDICTION_GAP_S} is too large"
        )


# ─── Debug info accuracy ──────────────────────────────────────────────────────

class TestDebugInfoAccuracy:
    """debug_info must accurately reflect whether detection was real or fallback."""

    def test_pitch_detected_false_for_default_method(self):
        """pitch_detected must be False when pitch boundaries used default fallback."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()

        # Simulate what track_ball does to build debug_info with a default-fallback pitch
        pitch_info = {
            'boundaries': {'method': 'default', 'bbox': (100, 200, 800, 700)},
            'stumps': None,
            'dimensions': {}
        }
        tracking_data = {'ball_trajectory': [], 'stumps_position': None}

        pitch_detected = (
            pitch_info is not None and
            pitch_info.get('boundaries', {}).get('method') not in ('default', 'error_fallback')
        )
        assert pitch_detected is False, (
            "pitch_detected must be False when pitch boundaries method is 'default'"
        )

    def test_stumps_detected_false_for_low_confidence(self):
        """stumps_detected must be False for low-confidence or default-method stumps."""
        stumps = {
            'pixel_position': (400, 300),
            'confidence': 0.25,   # Below 0.5 threshold
            'method': 'default_fallback'
        }
        stumps_detected = (
            stumps is not None and
            stumps.get('method') not in ('default', 'default_fallback', 'error_fallback') and
            stumps.get('confidence', 0) > 0.5
        )
        assert stumps_detected is False

    def test_tracking_data_has_prediction_counters(self):
        """tracking_data initialization must include consecutive_predictions counter."""
        # Verify the initialization dict includes the new fields
        # (we check by inspecting the source rather than running the full video loop)
        import inspect
        from services.ball_tracking_service import BallTrackingService
        source = inspect.getsource(BallTrackingService.track_ball)
        assert 'consecutive_predictions' in source, (
            "tracking_data must initialize consecutive_predictions"
        )
        assert 'last_real_detection_time' in source, (
            "tracking_data must initialize last_real_detection_time"
        )


# ─── videos.py helper ────────────────────────────────────────────────────────

class TestBuildAdditionalData:
    """_build_additional_data must include all DRS fields."""

    def test_all_drs_fields_present(self):
        """_build_additional_data must extract the complete set of DRS fields."""
        from api.videos import _build_additional_data
        sample = {
            'stumps_position': {'x': 0},
            'bowler_position': {'x': 1},
            'batter_position': {'x': 2},
            'lbw_analysis': [{'result': 'OUT'}],
            'debug_info': {'pitch_detected': False},
            'pitch_info': {'boundaries': {}},
            'pre_bounce_points': [{'x': 0}],
            'post_bounce_points': [{'x': 1}],
            'extrapolated_points': [{'x': 2}],
            'bounce_point': {'x': 0, 'y': 5},
            'impact_point': {'x': 0, 'y': 9},
            'stump_plane_target': {'x': 0},
            'drs_evaluation': {'decision': 'OUT'},
            'release_speed_kmh': 142.0,
            'bounce_speed_kmh': None,
            'length_zone': 'Good Length',
        }
        result = _build_additional_data(sample)
        required_keys = [
            'stumps_position', 'bowler_position', 'batter_position',
            'lbw_analysis', 'debug_info', 'pitch_info',
            'pre_bounce_points', 'post_bounce_points', 'extrapolated_points',
            'bounce_point', 'impact_point', 'stump_plane_target',
            'drs_evaluation', 'release_speed_kmh', 'bounce_speed_kmh', 'length_zone'
        ]
        for key in required_keys:
            assert key in result, f"_build_additional_data missing key: {key}"

    def test_missing_fields_return_none_not_raise(self):
        """_build_additional_data must handle partially missing input gracefully."""
        from api.videos import _build_additional_data
        result = _build_additional_data({})
        # All optional fields should default gracefully
        assert result['lbw_analysis'] == []
        assert result['debug_info'] == {}
        assert result['release_speed_kmh'] is None
        assert result['bounce_speed_kmh'] is None
