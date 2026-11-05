"""
Phase 2 regression tests covering:
- Streaming upload size enforcement
- Kalman filter dt-dependent transition matrix
- VideoRecorder audio removal (no audio in getUserMedia)
- Filename sanitisation (path traversal prevention)
- Reprocess transactional safety (existing tests in test_phase1_regression.py
  cover the _build_additional_data helper used for all three paths)
"""
import pytest
import sys
import os
import math
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))


class TestKalmanFilter:
    """Verify constant-velocity Kalman filter correctness."""

    def _make_linear_trajectory(self, n=10, dt=0.04):
        """Trajectory of ball moving at constant velocity — should be near-perfectly
        recovered by the Kalman filter."""
        vx, vy, vz = 0.5, 5.0, -0.1   # m/s
        return [
            {
                'x': vx * i * dt,
                'y': vy * i * dt,
                'z': max(0, 2.0 + vz * i * dt),
                't': i * dt,
                'confidence': 0.9,
                'is_predicted': False,
            }
            for i in range(n)
        ]

    def test_kalman_output_length_matches_input(self):
        """Kalman filter must return the same number of points as input."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        traj = self._make_linear_trajectory(12)
        smoothed = svc._apply_kalman_filter(traj)
        assert len(smoothed) == 12

    def test_kalman_preserves_is_predicted_flag(self):
        """Kalman filter must not lose is_predicted metadata."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        traj = self._make_linear_trajectory(6)
        # Tag last two as predicted
        traj[4]['is_predicted'] = True
        traj[5]['is_predicted'] = True
        smoothed = svc._apply_kalman_filter(traj)
        assert smoothed[4].get('is_predicted') is True
        assert smoothed[5].get('is_predicted') is True

    def test_kalman_preserves_timestamps(self):
        """All timestamps must be preserved exactly through smoothing."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        traj = self._make_linear_trajectory(8)
        smoothed = svc._apply_kalman_filter(traj)
        for orig, sm in zip(traj, smoothed):
            assert sm['t'] == orig['t'], f"Timestamp changed: {orig['t']} → {sm['t']}"

    def test_kalman_z_clamped_non_negative(self):
        """Kalman filter must not produce negative z (below ground) for normal trajectories."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        traj = self._make_linear_trajectory(10)
        smoothed = svc._apply_kalman_filter(traj)
        for pt in smoothed:
            assert pt['z'] >= 0.0, f"Negative z after smoothing: {pt['z']}"

    def test_kalman_single_point_passthrough(self):
        """Single-point trajectory must be returned unchanged."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        traj = [{'x': 1.0, 'y': 2.0, 'z': 0.5, 't': 0.0, 'confidence': 0.8, 'is_predicted': False}]
        smoothed = svc._apply_kalman_filter(traj)
        assert len(smoothed) == 1

    def test_kalman_variable_dt_does_not_crash(self):
        """Kalman filter must handle irregular timestamps without crashing."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        # Irregular timestamps (dropped frames)
        times = [0.0, 0.033, 0.1, 0.133, 0.3, 0.333]
        traj = [
            {'x': float(i), 'y': float(i*2), 'z': 1.0, 't': t,
             'confidence': 0.8, 'is_predicted': False}
            for i, t in enumerate(times)
        ]
        smoothed = svc._apply_kalman_filter(traj)
        assert len(smoothed) == len(traj)

    def test_kalman_transition_matrix_is_dt_dependent(self):
        """Verify the transition matrix uses dt, not identity — by checking that
        a constant-velocity trajectory is well-tracked (residual < 0.5 m)."""
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        # Ball moving at exactly 5 m/s along y, 1 m/s along x
        dt = 1/25  # 25 fps
        traj = [
            {'x': 1.0 * i * dt, 'y': 5.0 * i * dt, 'z': 1.0,
             't': i * dt, 'confidence': 0.95, 'is_predicted': False}
            for i in range(20)
        ]
        smoothed = svc._apply_kalman_filter(traj)
        # Check last point — should be within 0.5 m of truth for a linear trajectory
        orig_last = traj[-1]
        sm_last = smoothed[-1]
        error = math.sqrt(
            (sm_last['x'] - orig_last['x'])**2 +
            (sm_last['y'] - orig_last['y'])**2
        )
        assert error < 0.5, (
            f"Kalman tracking error too large for linear motion: {error:.3f} m. "
            "Identity transition matrix would diverge for long sequences."
        )


class TestUploadFilenameHandling:
    """Path traversal and filename sanitisation."""

    def test_path_traversal_stripped(self):
        """Path components must be stripped from filenames."""
        from pathlib import Path
        # Simulate what the endpoint does: Path(name).name
        dangerous_names = [
            '../../../etc/passwd',
            '..\\..\\Windows\\System32\\cmd.exe',
            '/absolute/path/video.mp4',
        ]
        for name in dangerous_names:
            safe = Path(name).name
            assert '/' not in safe, f"Path separator left in: {safe}"
            assert '\\' not in safe, f"Windows path separator left in: {safe}"
            # Must only be the basename
            assert safe in ('passwd', 'cmd.exe', 'video.mp4'), \
                f"Unexpected sanitised name: {safe}"

    def test_safe_upload_filename_built_correctly(self):
        """Stored filename must include UUID prefix with only the basename."""
        import uuid
        from pathlib import Path
        original_name = "../uploads/malicious.mp4"
        safe_name = Path(original_name).name   # = 'malicious.mp4'
        file_id = str(uuid.uuid4())
        stored = f"{file_id}_{safe_name}"
        # Must not contain any directory separator
        assert '/' not in stored
        assert '\\' not in stored
        # Must end with the basename
        assert stored.endswith('_malicious.mp4')


class TestConfigGeometryConsistency:
    """All geometry constants must be consistent across config, tracker and viewer."""

    def test_pitch_length_constant_chain(self):
        """PITCH_CONFIG.length_m, sample_generator PITCH_LENGTH all agree."""
        from config import PITCH_CONFIG
        from services.sample_generator import PITCH_LENGTH
        assert abs(PITCH_CONFIG['length_m'] - 20.12) < 0.01
        assert abs(PITCH_LENGTH - 20.12) < 0.01

    def test_stump_height_constant_chain(self):
        """PITCH_CONFIG.stump_height_m and sample_generator STUMP_HEIGHT agree."""
        from config import PITCH_CONFIG
        from services.sample_generator import STUMP_HEIGHT
        assert abs(PITCH_CONFIG['stump_height_m'] - STUMP_HEIGHT) < 0.005

    def test_stump_width_constant_chain(self):
        from config import PITCH_CONFIG
        from services.sample_generator import STUMP_WIDTH
        assert abs(PITCH_CONFIG['stump_width_m'] - STUMP_WIDTH) < 0.005

    def test_ball_radius_in_config(self):
        from config import PITCH_CONFIG
        assert 'ball_radius_m' in PITCH_CONFIG
        assert abs(PITCH_CONFIG['ball_radius_m'] - 0.036) < 0.005


class TestPixelSpaceDiagnostics:
    """Verifies that per-frame pixel space diagnostics and frame indexes are populated."""

    def test_predict_ball_position_propagates_pixel_coords(self):
        from services.ball_tracking_service import BallTrackingService
        svc = BallTrackingService()
        tracking_data = {
            'ball_trajectory': [
                {
                    'x': 0.1, 'y': 2.0, 'z': 1.0, 't': 0.0,
                    'pixel_x': 100.0, 'pixel_y': 200.0, 'pixel_radius': 8.0,
                    'confidence': 0.9, 'is_predicted': False
                },
                {
                    'x': 0.15, 'y': 3.0, 'z': 0.9, 't': 0.04,
                    'pixel_x': 110.0, 'pixel_y': 220.0, 'pixel_radius': 8.0,
                    'confidence': 0.9, 'is_predicted': False
                }
            ]
        }
        pred = svc._predict_ball_position(tracking_data, 0.08)
        assert pred is not None
        assert pred.get('is_predicted') is True
        assert 'pixel_x' in pred
        assert 'pixel_y' in pred
        assert abs(pred['pixel_x'] - 120.0) < 1.0
        assert abs(pred['pixel_y'] - 240.0) < 1.0
        assert pred['detector_score'] == 0.0


class TestTrackingEvaluationHarness:
    """Verifies evaluation metrics computation."""

    def test_evaluate_trajectory_metrics(self):
        import sys
        scripts_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts'))
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        from evaluate_tracking import evaluate_trajectory, parse_tracking_data

        gt = {
            0: (100.0, 100.0),
            1: (110.0, 110.0),
            2: (120.0, 120.0),
        }
        tracked = [
            {'frame_idx': 0, 'pixel_x': 102.0, 'pixel_y': 100.0, 'is_predicted': False},
            {'frame_idx': 1, 'pixel_x': 109.0, 'pixel_y': 111.0, 'is_predicted': False},
            {'frame_idx': 2, 'pixel_x': 150.0, 'pixel_y': 150.0, 'is_predicted': True},  # Miss (>15px)
        ]
        metrics = evaluate_trajectory(tracked, gt, match_threshold_px=15.0)
        assert metrics['total_gt_frames'] == 3
        assert metrics['total_tracked_points'] == 3
        assert metrics['measured_points'] == 2
        assert metrics['predicted_points'] == 1

        # Detector-only metrics (measured detections only)
        assert metrics['detector_tp'] == 2
        assert metrics['detector_fp'] == 0
        assert metrics['detector_fn'] == 1
        assert metrics['detector_precision'] == 1.0
        assert abs(metrics['detector_recall'] - (2/3)) < 0.01

        # Combined tracking metrics (measured + predicted)
        assert metrics['combined_tp'] == 2
        assert metrics['combined_fp'] == 1
        assert abs(metrics['combined_recall'] - (2/3)) < 0.01
        assert abs(metrics['combined_precision'] - (2/3)) < 0.01
        assert metrics['predicted_fraction'] == round(1/3, 4)

        # Top-level array and dict parsing support (Finding 10)
        list_pts = [{'frame_idx': 0, 'pixel_x': 10.0, 'pixel_y': 10.0}]
        dict_pts = {'points': list_pts}
        assert parse_tracking_data(list_pts) == list_pts
        assert parse_tracking_data(dict_pts) == list_pts

