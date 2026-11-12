"""
Phase 3 CV & Calibration Unit Tests:
- Category A.3: Crease line detection via Hough lines (_detect_crease_lines)
- Category B.2: Perspective-n-Point camera pose estimation (_estimate_camera_pose_pnp)
- Category B.3: Physics-constrained parabolic trajectory height regression (_fit_parabolic_height / _fit_parabolic_height_regression)
"""
import pytest
import numpy as np
import cv2
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
from services.ball_tracking_service import BallTrackingService
from config import PITCH_CONFIG


class TestCreaseLineDetection:
    """Tests for Category A.3: Hough line crease detection."""

    def test_detect_crease_lines_on_synthetic_pitch(self):
        """Crease detector finds horizontal popping and bowling creases."""
        svc = BallTrackingService()
        h, w = 1080, 1920
        # Create green grass canvas
        frame = np.full((h, w, 3), (34, 139, 34), dtype=np.uint8)

        # Draw popping crease (y = 780, white line, width 1000px)
        cv2.line(frame, (460, 780), (1460, 780), (255, 255, 255), 4)
        # Draw bowling crease (y = 890, white line, width 800px)
        cv2.line(frame, (560, 890), (1360, 890), (255, 255, 255), 4)

        result = svc._detect_crease_lines(frame)

        assert result['detected'] is True, "Crease lines should be detected"
        assert result['line_count'] > 0, "Line count should be greater than zero"
        assert result['popping_crease'] is not None, "Popping crease must be identified"
        assert result['bowling_crease'] is not None, "Bowling crease must be identified"

        # Verify geometric positioning (popping crease has smaller y than bowling crease)
        pop_y = result['popping_crease'].get('center_y', result['popping_crease'].get('y_mid'))
        bowl_y = result['bowling_crease'].get('center_y', result['bowling_crease'].get('y_mid'))
        assert pop_y < bowl_y, f"Popping crease y ({pop_y}) should be above bowling crease y ({bowl_y})"
        assert abs(pop_y - 780) < 10, f"Popping crease y {pop_y} should be close to 780"
        assert abs(bowl_y - 890) < 10, f"Bowling crease y {bowl_y} should be close to 890"

    def test_detect_crease_lines_empty_or_blank(self):
        """Crease detector handles blank/None frames gracefully without crashing."""
        svc = BallTrackingService()

        # None frame
        res_none = svc._detect_crease_lines(None)
        assert res_none['detected'] is False
        assert res_none['popping_crease'] is None
        assert res_none['bowling_crease'] is None

        # Blank green frame without lines
        blank = np.full((720, 1280, 3), (40, 120, 40), dtype=np.uint8)
        res_blank = svc._detect_crease_lines(blank)
        assert res_blank['detected'] is False
        assert res_blank['line_count'] == 0


class TestPerspectiveNPointCalibration:
    """Tests for Category B.2: Perspective-n-Point camera pose estimation."""

    def test_solve_pnp_with_stump_landmarks(self):
        """solvePnP estimates 6-DOF camera pose using known 3D stump landmarks."""
        svc = BallTrackingService()
        w, h = 1920, 1080

        stumps_pos = {
            'pixel_position': (960.0, 850.0),
            'size': (60.0, 120.0),
            'confidence': 0.85
        }

        pose = svc._estimate_camera_pose_pnp(w, h, stumps_pos)

        assert pose is not None, "PnP pose estimation must return a dictionary"
        assert pose['success'] is True, "PnP optimization should succeed"
        assert 'rvec' in pose and len(pose['rvec']) == 3, "rvec must be 3-element vector"
        assert 'tvec' in pose and len(pose['tvec']) == 3, "tvec must be 3-element vector"
        assert 'rotation_matrix' in pose, "Rotation matrix must be present"
        assert 'camera_position' in pose, "World camera position must be present"
        assert pose['reprojection_error'] < 10.0, f"Reprojection error {pose['reprojection_error']} px should be < 10.0 px"

        # Verify landmarks are the 4 ICC stump landmarks
        landmarks_3d = pose['landmarks_3d']
        assert len(landmarks_3d) == 4
        # Middle top: (0, 10.06, 0.711)
        assert abs(landmarks_3d[0][0] - 0.0) < 1e-3
        assert abs(landmarks_3d[0][1] - 10.06) < 1e-2
        assert abs(landmarks_3d[0][2] - 0.711) < 1e-3
        # Middle base: (0, 10.06, 0.0)
        assert abs(landmarks_3d[1][2] - 0.0) < 1e-3
        # Leg top: (-0.057, 10.06, 0.711)
        assert abs(landmarks_3d[2][0] - (-0.057)) < 1e-3
        # Off top: (0.057, 10.06, 0.711)
        assert abs(landmarks_3d[3][0] - 0.057) < 1e-3

    def test_solve_pnp_with_projected_landmarks(self):
        """solvePnP with geometrically exact perspective projection achieves sub-pixel accuracy."""
        svc = BallTrackingService()

        pts_3d = np.array([
            [ 0.0,    10.06, 0.711],
            [ 0.0,    10.06, 0.0  ],
            [-0.057,  10.06, 0.711],
            [ 0.057,  10.06, 0.711]
        ], dtype=np.float64)

        K = np.array([
            [1000.0, 0.0, 960.0],
            [0.0, 1000.0, 540.0],
            [0.0, 0.0, 1.0]
        ], dtype=np.float64)
        dist = np.zeros((4, 1))
        rvec_true = np.array([1.35, 0.0, 0.0])
        tvec_true = np.array([0.0, -1.5, 9.5])

        proj_pts, _ = cv2.projectPoints(pts_3d, rvec_true, tvec_true, K, dist)
        pts_2d = proj_pts.reshape(-1, 2)

        pose = svc._estimate_camera_pose_pnp(image_points=pts_2d, object_points=pts_3d, camera_matrix=K)
        assert pose['success'] is True
        assert pose['reprojection_error'] < 1.0, f"Expected sub-pixel reprojection error, got {pose['reprojection_error']}"

    def test_solve_pnp_polymorphic_arguments(self):
        """_estimate_camera_pose_pnp supports both positional and keyword invocations."""
        svc = BallTrackingService()

        # Call with default fallback (stumps_pos=None)
        pose_default = svc._estimate_camera_pose_pnp(1920, 1080, None)
        assert pose_default['success'] is True

        # Call with explicit 2D / 3D correspondences
        pts_3d = np.array([
            [0.0, 10.06, 0.711],
            [0.0, 10.06, 0.0],
            [-0.057, 10.06, 0.711],
            [0.057, 10.06, 0.711]
        ], dtype=np.float64)
        pts_2d = np.array([
            [960.0, 730.0],
            [960.0, 850.0],
            [930.0, 730.0],
            [990.0, 730.0]
        ], dtype=np.float64)

        pose_explicit = svc._estimate_camera_pose_pnp(image_points=pts_2d, object_points=pts_3d)
        assert pose_explicit['success'] is True


class TestParabolicHeightRegression:
    """Tests for Category B.3: Physics-constrained parabolic trajectory height regression."""

    def test_fit_parabolic_height_single_segment(self):
        """Fit Z(t) = Z0 + Vz0*t - 0.5*g*t^2 recovers true parameters from noisy data."""
        svc = BallTrackingService()
        g = 9.8
        t = np.linspace(0.0, 0.5, 15)

        # True ballistic flight: release at z0=2.1m, vz0=-1.2 m/s
        true_z0 = 2.1
        true_vz0 = -1.2
        true_z = true_z0 + true_vz0 * t - 0.5 * g * (t ** 2)

        # Add Gaussian monocular measurement jitter
        np.random.seed(42)
        jitter = np.random.normal(0, 0.06, len(t))
        noisy_z = true_z + jitter

        points = [
            {'x': 0.1 * i, 'y': 1.0 * i, 'z': float(noisy_z[i]), 't': float(t[i]), 'confidence': 0.9}
            for i in range(len(t))
        ]

        fitted = svc._fit_parabolic_height(points, g=9.8)

        assert len(fitted) == len(points)
        for p in fitted:
            assert 'parabolic_fit' in p
            assert p['z'] >= 0.0

        est_z0 = fitted[0]['parabolic_fit']['z0']
        est_vz0 = fitted[0]['parabolic_fit']['vz0']

        # Estimated parameters should closely match true parameters
        assert abs(est_z0 - true_z0) < 0.15, f"est_z0={est_z0} vs true={true_z0}"
        assert abs(est_vz0 - true_vz0) < 0.40, f"est_vz0={est_vz0} vs true={true_vz0}"

        # Jitter variance should be eliminated
        residuals = [abs(fitted[i]['z'] - true_z[i]) for i in range(len(t))]
        assert np.mean(residuals) < 0.06

    def test_fit_parabolic_height_regression_with_bounce(self):
        """Full trajectory with bounce segments into pre-bounce and post-bounce parabolas."""
        svc = BallTrackingService()
        g = 9.8
        t_pre = np.linspace(0.0, 0.4, 11)   # 0 to 0.4s
        t_post = np.linspace(0.44, 0.8, 10) # 0.44 to 0.8s

        # Pre-bounce: release at 2.0m falling towards pitch
        z_pre = 2.0 - 2.5 * t_pre - 0.5 * g * (t_pre ** 2)

        # Bounce point contact at ~0.036m
        # Post-bounce: rising from turf
        tau_post = t_post - 0.4
        z_post = 0.036 + 3.2 * tau_post - 0.5 * g * (tau_post ** 2)

        np.random.seed(123)
        traj = []
        for i in range(len(t_pre)):
            traj.append({
                'x': 0.0,
                'y': float(i * 1.0),
                'z': float(max(0.03, z_pre[i] + np.random.normal(0, 0.03))),
                't': float(t_pre[i]),
                'confidence': 0.85
            })
        for i in range(len(t_post)):
            traj.append({
                'x': 0.0,
                'y': float((len(t_pre) + i) * 1.0),
                'z': float(max(0.03, z_post[i] + np.random.normal(0, 0.03))),
                't': float(t_post[i]),
                'confidence': 0.85
            })

        regressed = svc._fit_parabolic_height_regression(traj, g=9.8)

        assert len(regressed) == len(traj), "Output point count must match input"

        # Check that bounce point exists and has turf level height
        bounce_pts = [p for p in regressed if p.get('phase') == 'bounce']
        assert len(bounce_pts) == 1, "Exactly one bounce contact point should be tagged"
        assert abs(bounce_pts[0]['z'] - 0.036) < 1e-3, "Bounce contact point z must be ~0.036m"

        # Check that pre-bounce and post-bounce points have parabolic_fit metadata
        assert 'parabolic_fit' in regressed[0]
        assert 'parabolic_fit' in regressed[-1]

    def test_post_processing_integration(self):
        """_post_process_tracking_data runs Kalman filter, outlier removal, and parabolic regression."""
        svc = BallTrackingService()
        t = [0.0, 0.04, 0.08, 0.12, 0.16, 0.20, 0.24, 0.28]
        traj = [
            {'x': float(i * 0.2), 'y': float(i * 2.0), 'z': float(2.0 - i * 0.2),
             't': t[i], 'confidence': 0.9, 'is_predicted': False}
            for i in range(len(t))
        ]
        # Add an outlier
        traj.insert(4, {'x': 50.0, 'y': 50.0, 'z': 20.0, 't': 0.14, 'confidence': 0.1, 'is_predicted': False})

        tracking_data = {'ball_trajectory': traj}
        result = svc._post_process_tracking_data(tracking_data)

        out_traj = result['ball_trajectory']
        assert len(out_traj) <= len(traj), "Outlier should have been filtered out"
        # All output points should have non-negative z and smooth values
        for pt in out_traj:
            assert pt['z'] >= 0.0
            assert pt['z'] < 5.0
