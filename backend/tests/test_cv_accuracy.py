"""
CV Accuracy and Calibration Test Suite.

Tests cover:
1. Pitch crease line detection (_detect_crease_lines) with synthetic and real frame inputs.
2. Perspective-n-Point camera pose estimation (_estimate_camera_pose_pnp) asserting
   valid rotation and translation vectors.
3. Parabolic vertical height regression (_fit_parabolic_height_regression) asserting
   smooth curvature without negative heights (z >= 0.0 m).
4. Ball and stump detection on real dataset test frames from Cricket Dataset.v5i.yolov8/test/images.

Run with:
    pytest backend/tests/test_cv_accuracy.py -v
"""
import pytest
import sys
import os
import glob
from pathlib import Path
import numpy as np
import cv2

# Ensure backend src is on the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
from services.ball_tracking_service import BallTrackingService


def _find_test_dataset_dir() -> Path:
    """Helper to locate the real cricket dataset test images directory."""
    candidates = [
        Path("Cricket Dataset.v5i.yolov8/test/images"),
        Path("../Cricket Dataset.v5i.yolov8/test/images"),
        Path("../../Cricket Dataset.v5i.yolov8/test/images"),
        Path(__file__).resolve().parent.parent.parent.parent / "Cricket Dataset.v5i.yolov8" / "test" / "images",
        Path(r"C:\Users\Sreekar_Tirumala\Documents\College\ICG\ICG-PROJECT\Cricket Dataset.v5i.yolov8\test\images"),
    ]
    for cand in candidates:
        if cand.exists() and len(list(cand.glob("*.jpg"))) > 0:
            return cand
    return candidates[0]


# ─── 1. Crease Line Detection Tests ──────────────────────────────────────────

class TestCreaseLineDetection:
    """Tests for _detect_crease_lines using synthetic and real inputs."""

    @pytest.fixture
    def tracking_service(self):
        return BallTrackingService()

    def test_crease_detection_synthetic_pitch(self, tracking_service):
        """Synthetic frame with drawn pitch and white crease lines must be detected."""
        h, w = 480, 640
        # Turf green background
        frame = np.full((h, w, 3), (35, 120, 45), dtype=np.uint8)

        # Draw white popping crease (batsman end, lower half)
        cv2.line(frame, (100, 380), (540, 380), (255, 255, 255), thickness=4)
        # Draw white bowling crease (bowler end, upper half)
        cv2.line(frame, (180, 160), (460, 160), (255, 255, 255), thickness=3)
        # Draw white return creases (vertical lines)
        cv2.line(frame, (100, 320), (100, 420), (255, 255, 255), thickness=3)
        cv2.line(frame, (540, 320), (540, 420), (255, 255, 255), thickness=3)

        result = tracking_service._detect_crease_lines(frame)

        assert isinstance(result, dict)
        assert result['detected'] is True
        assert result['line_count'] > 0
        assert len(result['lines']) > 0

        # Popping crease should be detected in lower half
        popping = result['popping_crease']
        assert popping is not None, "Popping crease must be identified in synthetic pitch"
        assert abs(popping['center_y'] - 380) < 25.0
        assert popping['angle_deg'] <= 25.0, "Popping crease must be roughly horizontal"

        # Bowling crease should be identified in upper half
        bowling = result['bowling_crease']
        assert bowling is not None, "Bowling crease must be identified in synthetic pitch"
        assert abs(bowling['center_y'] - 160) < 25.0

        # Return creases should have vertical candidate lines
        assert len(result['return_creases']) > 0

    def test_crease_detection_blank_and_invalid_inputs(self, tracking_service):
        """Invalid or blank frames must fail gracefully without crashing."""
        # None input
        res_none = tracking_service._detect_crease_lines(None)
        assert res_none['detected'] is False
        assert res_none['line_count'] == 0

        # Empty array
        res_empty = tracking_service._detect_crease_lines(np.array([], dtype=np.uint8))
        assert res_empty['detected'] is False

        # Solid black frame (no lines)
        black_frame = np.zeros((300, 400, 3), dtype=np.uint8)
        res_black = tracking_service._detect_crease_lines(black_frame)
        assert res_black['detected'] is False
        assert res_black['lines'] == []

    def test_crease_detection_real_dataset_frames(self, tracking_service):
        """Real cricket match test frames must be parsed without unhandled exceptions."""
        dataset_dir = _find_test_dataset_dir()
        if not dataset_dir.exists():
            pytest.skip(f"Test dataset directory not found at {dataset_dir}")

        image_paths = list(dataset_dir.glob("*.jpg"))[:5]
        assert len(image_paths) > 0, "No test images found"

        for p in image_paths:
            frame = cv2.imread(str(p))
            assert frame is not None
            res = tracking_service._detect_crease_lines(frame)

            assert isinstance(res, dict)
            assert 'detected' in res
            assert 'lines' in res
            assert 'popping_crease' in res
            assert 'bowling_crease' in res
            assert 'return_creases' in res
            assert 'line_count' in res
            assert isinstance(res['lines'], list)
            assert isinstance(res['return_creases'], list)


# ─── 2. Camera Pose Estimation (PnP) Tests ────────────────────────────────────

class TestCameraPoseEstimationPnP:
    """Tests for Perspective-n-Point camera pose estimation (_estimate_camera_pose_pnp)."""

    @pytest.fixture
    def tracking_service(self):
        return BallTrackingService()

    def test_pnp_pose_estimation_default_landmarks(self, tracking_service):
        """PnP pose estimation with standard landmarks must yield valid rvec and tvec."""
        res = tracking_service._estimate_camera_pose_pnp(
            frame_width=1280,
            frame_height=720,
            stumps_2d={'x': 640.0, 'y': 560.0}
        )

        assert res['success'] is True, f"PnP pose estimation failed: {res.get('error')}"

        rvec = res['rvec']
        tvec = res['tvec']
        assert rvec is not None and tvec is not None

        # Verify shapes
        assert rvec.shape == (3, 1) or rvec.shape == (3,)
        assert tvec.shape == (3, 1) or tvec.shape == (3,)

        # Assert no NaN or Inf values
        assert np.all(np.isfinite(rvec))
        assert np.all(np.isfinite(tvec))

        # Check rotation matrix validity
        R = res['rotation_matrix']
        assert R is not None
        assert R.shape == (3, 3)
        # R must be orthogonal: R @ R.T == I and det(R) == +1
        assert np.allclose(R @ R.T, np.eye(3), atol=1e-3)
        assert abs(np.linalg.det(R) - 1.0) < 1e-2

        # Check camera height above ground is realistic (typically 1.0m - 20.0m)
        assert res['camera_height_m'] > 0.5, f"Camera height unrealistic: {res['camera_height_m']}"
        assert res['num_correspondences'] >= 4

    def test_pnp_pose_estimation_known_correspondences(self, tracking_service):
        """PnP must accurately recover camera pose from known 3D-to-2D projected points."""
        # 3D points on pitch (metric meters)
        object_points = np.array([
            [ 0.0,   10.06, 0.0  ],
            [ 0.0,   10.06, 0.711],
            [-1.525,  8.84, 0.0  ],
            [ 1.525,  8.84, 0.0  ],
            [-1.525, -10.06, 0.0 ],
            [ 1.525, -10.06, 0.0 ],
        ], dtype=np.float64)

        # Ground truth camera looking down the pitch towards batsman (+Y)
        R0 = np.array([
            [1.0, 0.0,  0.0],
            [0.0, 0.0, -1.0],
            [0.0, 1.0,  0.0]
        ], dtype=np.float64)
        true_rvec, _ = cv2.Rodrigues(R0)
        true_tvec = np.array([[0.0], [2.0], [15.0]], dtype=np.float64)
        K = np.array([
            [1200.0, 0.0, 640.0],
            [0.0, 1200.0, 360.0],
            [0.0, 0.0, 1.0]
        ], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1), dtype=np.float64)

        # Project 3D points to 2D
        image_points, _ = cv2.projectPoints(object_points, true_rvec, true_tvec, K, dist_coeffs)
        image_points = image_points.reshape(-1, 2)

        # Estimate pose from the projected points
        res = tracking_service._estimate_camera_pose_pnp(
            image_points=image_points,
            object_points=object_points,
            frame_width=1280,
            frame_height=720,
            camera_matrix=K
        )

        assert res['success'] is True
        assert np.all(np.isfinite(res['rvec']))
        assert np.all(np.isfinite(res['tvec']))

        # Reprojection error should be near zero on noise-free projection
        reproj, _ = cv2.projectPoints(object_points, res['rvec'], res['tvec'], K, dist_coeffs)
        reproj = reproj.reshape(-1, 2)
        error = np.mean(np.linalg.norm(reproj - image_points, axis=1))
        assert error < 1.0, f"PnP reprojection error too large: {error:.3f} px"

    def test_pnp_insufficient_points_fails_gracefully(self, tracking_service):
        """PnP with < 4 correspondences must return success=False without raising an exception."""
        pts_3d = np.array([[0, 0, 0], [1, 1, 1]], dtype=np.float64)
        pts_2d = np.array([[100, 100], [200, 200]], dtype=np.float64)

        res = tracking_service._estimate_camera_pose_pnp(
            image_points=pts_2d,
            object_points=pts_3d
        )
        assert res['success'] is False
        assert res['rvec'] is None
        assert res['tvec'] is None


# ─── 3. Parabolic Vertical Height Regression Tests ───────────────────────────

class TestParabolicVerticalHeightRegression:
    """Tests for physics-constrained parabolic vertical height regression."""

    @pytest.fixture
    def tracking_service(self):
        return BallTrackingService()

    def test_parabolic_height_no_negative_heights(self, tracking_service):
        """All fitted heights must be non-negative (z >= 0.0) even with negative inputs."""
        # Trajectory with sensor noise and erroneous negative z readings
        raw_trajectory = [
            {'x': 0.0, 'y': float(i), 'z': -0.4 if i in [5, 6] else max(-0.2, 2.0 - 0.2 * i),
             't': i * 0.04, 'confidence': 0.85, 'is_predicted': False}
            for i in range(12)
        ]

        smoothed = tracking_service._fit_parabolic_height_regression(raw_trajectory)

        assert len(smoothed) == len(raw_trajectory)
        for pt in smoothed:
            assert pt['z'] >= 0.0, f"Negative height found in smoothed trajectory: {pt['z']}"

    def test_parabolic_height_smooth_curvature(self, tracking_service):
        """Fitted height must produce smooth ballistic curvature with downward gravity."""
        g = 9.81
        dt = 0.033
        n = 15
        # Ideal gravity curve: z(t) = 2.2 - 0.5 * g * t^2
        # Inject substantial random jitter into z
        np.random.seed(42)
        raw_trajectory = []
        for i in range(n):
            t = i * dt
            true_z = max(0.1, 2.2 - 0.5 * g * (t ** 2))
            noisy_z = true_z + np.random.uniform(-0.35, 0.35)
            raw_trajectory.append({
                'x': 0.1 * i,
                'y': 1.5 * i,
                'z': noisy_z,
                't': t,
                'confidence': 0.8,
                'is_predicted': False
            })

        smoothed = tracking_service._fit_parabolic_height_regression(raw_trajectory)

        # 1. Height must remain non-negative
        for pt in smoothed:
            assert pt['z'] >= 0.0

        # 2. Smoothness test: second derivative d2z/dt2 of smoothed curve
        # must have lower variance than raw noisy points
        z_smooth = [pt['z'] for pt in smoothed]
        z_raw = [pt['z'] for pt in raw_trajectory]

        d2_smooth = np.diff(z_smooth, n=2)
        d2_raw = np.diff(z_raw, n=2)

        var_smooth = float(np.var(d2_smooth))
        var_raw = float(np.var(d2_raw))
        assert var_smooth < var_raw, f"Expected smoothed curvature to have lower jitter: {var_smooth} vs {var_raw}"

    def test_parabolic_height_preserves_metadata(self, tracking_service):
        """Fitted points must preserve all original trajectory metadata."""
        raw_trajectory = [
            {'x': 0.1 * i, 'y': 2.0 * i, 'z': 1.8 - 0.1 * i, 't': 0.04 * i,
             'confidence': 0.9, 'is_predicted': (i > 8), 'custom_id': 100 + i}
            for i in range(10)
        ]

        smoothed = tracking_service._fit_parabolic_height_regression(raw_trajectory)

        assert len(smoothed) == 10
        for orig, sm in zip(raw_trajectory, smoothed):
            assert sm['t'] == orig['t']
            assert sm['x'] == orig['x']
            assert sm['y'] == orig['y']
            assert sm['confidence'] == orig['confidence']
            assert sm['is_predicted'] == orig['is_predicted']
            assert sm['custom_id'] == orig['custom_id']
            assert sm['z'] >= 0.0

    def test_parabolic_height_with_pitch_bounce(self, tracking_service):
        """Trajectory with pitch bounce must be handled cleanly across both segments."""
        # Pre-bounce: falling from 2.0m to 0.1m at frame 6
        # Post-bounce: rising to 0.8m then falling
        trajectory = []
        for i in range(14):
            t = i * 0.04
            if i <= 6:
                z = max(0.08, 2.0 - 0.28 * i)
            else:
                z = max(0.12, 0.10 + 0.15 * (i - 6) - 0.03 * ((i - 6) ** 2))
            trajectory.append({
                'x': 0.0, 'y': i * 1.4, 'z': z, 't': t, 'confidence': 0.85, 'is_predicted': False
            })

        smoothed = tracking_service._fit_parabolic_height_regression(trajectory)
        assert len(smoothed) == 14
        for pt in smoothed:
            assert pt['z'] >= 0.0

    def test_parabolic_height_alias_consistency(self, tracking_service):
        """_parabolic_vertical_height_regression must produce identical output to _fit_parabolic_height_regression."""
        trajectory = [
            {'x': 0.0, 'y': float(i), 'z': max(0.0, 1.8 - 0.15 * i), 't': i * 0.04, 'confidence': 0.8}
            for i in range(8)
        ]
        res1 = tracking_service._fit_parabolic_height_regression(trajectory)
        res2 = tracking_service._parabolic_vertical_height_regression(trajectory)
        assert res1 == res2

    def test_parabolic_height_edge_cases(self, tracking_service):
        """Empty and short trajectories must not crash."""
        assert tracking_service._fit_parabolic_height_regression([]) == []
        one_pt = [{'x': 0.0, 'y': 0.0, 'z': -0.1, 't': 0.0, 'confidence': 0.5}]
        smoothed_one = tracking_service._fit_parabolic_height_regression(one_pt)
        assert len(smoothed_one) == 1
        assert smoothed_one[0]['z'] >= 0.0


# ─── 4. Real Dataset Object Detection Tests ───────────────────────────────────

class TestRealDatasetObjectDetection:
    """Tests ball and stump detection on real dataset test frames from Cricket Dataset.v5i.yolov8."""

    @pytest.fixture
    def tracking_service(self):
        return BallTrackingService()

    @pytest.fixture
    def test_images(self):
        dataset_dir = _find_test_dataset_dir()
        if not dataset_dir.exists():
            pytest.skip(f"Test dataset directory not found at {dataset_dir}")
        images = list(dataset_dir.glob("*.jpg"))[:10]
        if not images:
            pytest.skip("No test images available")
        return images

    def test_ball_detection_on_real_dataset_frames(self, tracking_service, test_images):
        """_detect_ball_comprehensive must execute on real test images without errors."""
        for img_path in test_images:
            frame = cv2.imread(str(img_path))
            assert frame is not None, f"Failed to read {img_path}"
            h, w = frame.shape[:2]

            ball = tracking_service._detect_ball_comprehensive(frame)
            if ball is not None:
                assert isinstance(ball, dict)
                assert 'x' in ball and 'y' in ball
                assert 'confidence' in ball
                assert 'method' in ball
                assert 0.0 <= ball['confidence'] <= 1.0
                assert 0 <= ball['x'] <= w + 10.0
                assert 0 <= ball['y'] <= h + 10.0

    def test_stump_detection_on_real_dataset_frames(self, tracking_service, test_images):
        """_detect_stumps must execute on real test images and return valid stumps dict."""
        for img_path in test_images:
            frame = cv2.imread(str(img_path))
            assert frame is not None, f"Failed to read {img_path}"
            h, w = frame.shape[:2]

            stumps = tracking_service._detect_stumps(frame)
            assert stumps is not None, "Stump detection should always return a result (or fallback)"
            assert isinstance(stumps, dict)
            assert 'pixel_position' in stumps
            assert 'confidence' in stumps
            assert 'method' in stumps

            px, py = stumps['pixel_position']
            assert 0.0 <= px <= float(w)
            assert 0.0 <= py <= float(h)

    def test_yolo_detector_methods_on_real_frames(self, tracking_service, test_images):
        """_detect_ball_yolo and _detect_stumps_yolo must execute safely on real frames."""
        sample_frame = cv2.imread(str(test_images[0]))
        assert sample_frame is not None

        # Ball YOLO detection
        ball_yolo = tracking_service._detect_ball_yolo(sample_frame)
        if ball_yolo is not None:
            assert 'x' in ball_yolo and 'y' in ball_yolo
            assert 'confidence' in ball_yolo
            assert ball_yolo['method'] == 'yolo'

        # Stump YOLO detection
        stump_yolo = tracking_service._detect_stumps_yolo(sample_frame)
        if stump_yolo is not None:
            assert 'x' in stump_yolo and 'y' in stump_yolo
            assert 'confidence' in stump_yolo
            assert stump_yolo['method'] == 'yolo'
