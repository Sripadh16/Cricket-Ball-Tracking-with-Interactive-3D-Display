import cv2
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
import time
import logging
from config import BALL_TRACKING, PITCH_CONFIG, STUMP_CONFIG, MAX_PROCESSING_FRAMES

logger = logging.getLogger(__name__)

MAX_PREDICTION_GAP_S = 0.2  # Max gap (seconds) to fill with predicted positions

class BallTrackingService:
    def __init__(self, progress_callback=None):
        # Progress callback for background tracking
        self.progress_callback = progress_callback

        # Planar Homography & Metric 3D Projection Matrices
        self.homography_matrix = None
        self.inv_homography_matrix = None

        # Ball detection parameters from config
        self.min_ball_radius = BALL_TRACKING["min_radius"]
        self.max_ball_radius = BALL_TRACKING["max_radius"]
        self.min_confidence = BALL_TRACKING["min_confidence"]
        self.max_velocity = BALL_TRACKING["max_velocity_px_per_sec"]
        self.prediction_tolerance = BALL_TRACKING["prediction_tolerance_px"]

        # Pitch dimensions from config
        self.pitch_length = PITCH_CONFIG["length_m"]
        self.pitch_width = PITCH_CONFIG["width_m"]
        self.camera_height = PITCH_CONFIG["camera_height_m"]
        self.camera_angle = np.radians(PITCH_CONFIG["camera_angle_deg"])
        self.focal_length_px = PITCH_CONFIG["focal_length_px"]

        # Stump detection parameters from config
        self.stump_min_area = STUMP_CONFIG["min_area"]
        self.stump_max_area = STUMP_CONFIG["max_area"]

        # Color ranges for detection
        self.ball_color_ranges = {
            'white': ([0, 0, 200], [180, 30, 255]),
            'red': ([0, 50, 50], [10, 255, 255]),
            'orange': ([5, 50, 50], [15, 255, 255])
        }

        # Pitch color range (green grass)
        self.pitch_color_range = ([35, 50, 50], [80, 255, 255])

        # Camera pose estimation from Perspective-n-Point (cv2.solvePnP)
        self.pnp_pose = None

        # YOLO Deep Learning Detector
        self.yolo_detector = None
        self._init_yolo_detector()

    def _compute_pitch_homography(
        self,
        frame_width: int,
        frame_height: int,
        pitch_boundaries: dict = None,
        stumps: dict = None,
        crease_lines: dict = None
    ):
        """
        Compute metric planar projective homography matrix mapping 2D video pixel coordinates (u, v, 1)
        to metric 3D ground plane coordinates (X, Y, 1) in meters on the cricket pitch.
        World coordinates:
          X: pitch width in [-1.525, +1.525] m
          Y: pitch length in [-10.06, +10.06] m
             -10.06 m = bowler stumps
             +10.06 m = batsman stumps
             +8.84 m  = batsman popping crease
        """
        try:
            half_w = float(self.pitch_width) / 2.0   # 1.525 m
            half_l = float(self.pitch_length) / 2.0  # 10.06 m

            dst_pts = np.array([
                [-half_w, -half_l],  # Bowler crease left
                [ half_w, -half_l],  # Bowler crease right
                [ half_w,  half_l],  # Batsman crease right
                [-half_w,  half_l]   # Batsman crease left
            ], dtype=np.float32)

            w, h = float(frame_width), float(frame_height)
            stump_cx = w * 0.5
            stump_cy = h * 0.82
            if stumps and isinstance(stumps, dict):
                stump_cx = float(stumps.get('x', stump_cx))
                stump_cy = float(stumps.get('y', stump_cy))

            # Near wicket/crease region
            near_y = min(h * 0.92, max(h * 0.65, stump_cy))
            if crease_lines and isinstance(crease_lines, dict):
                bowling_c = crease_lines.get('bowling_crease')
                if bowling_c and isinstance(bowling_c, dict) and ('center_y' in bowling_c or 'y_mid' in bowling_c):
                    detected_near = bowling_c.get('center_y', bowling_c.get('y_mid'))
                    near_y = min(h * 0.95, max(h * 0.55, float(detected_near)))

            near_half_w = max(w * 0.15, min(w * 0.35, w * 0.22))

            # Far bowler end
            far_y = max(h * 0.15, min(h * 0.45, near_y * 0.45))
            far_half_w = near_half_w * 0.42

            src_pts = np.array([
                [stump_cx - far_half_w,  far_y],   # Bowler left
                [stump_cx + far_half_w,  far_y],   # Bowler right
                [stump_cx + near_half_w, near_y],  # Batsman right
                [stump_cx - near_half_w, near_y]   # Batsman left
            ], dtype=np.float32)

            h_mat = cv2.getPerspectiveTransform(src_pts, dst_pts)
            h_inv = np.linalg.inv(h_mat)
            logger.info("Planar homography transformation matrix calibrated successfully.")
            return h_mat, h_inv
        except Exception as e:
            logger.warning(f"Could not compute pitch homography: {e}")
            return None, None

    def _estimate_camera_pose_pnp(
        self,
        frame_width: int = 1920,
        frame_height: int = 1080,
        stumps_pos: Optional[Dict[str, Any]] = None,
        image_points=None,
        object_points=None,
        stumps_2d=None,
        camera_matrix=None,
        focal_length=None,
    ) -> Dict[str, Any]:
        """
        Estimate camera 6-DOF extrinsic pose (rotation rvec and translation tvec)
        relative to the 3D pitch coordinate system using Perspective-n-Point (cv2.solvePnP).

        3D Metric Coordinate System (meters):
          Origin (0, 0, 0): Pitch center on ground plane
          X: [-1.525, +1.525] m across pitch width
          Y: [-10.06, +10.06] m along pitch length (-10.06 bowler, +10.06 batsman)
          Z: [0, +3.5] m height above ground plane (+0.711 m stump top)

        Known 3D stump landmarks:
          Middle top:  ( 0.000, 10.06, 0.711)
          Middle base: ( 0.000, 10.06, 0.000)
          Leg top:     (-0.057, 10.06, 0.711)
          Off top:     ( 0.057, 10.06, 0.711)
        """
        # Polymorphic support: if image_points was passed as first positional arg
        if isinstance(frame_width, (list, tuple, np.ndarray)) and isinstance(frame_height, (list, tuple, np.ndarray)):
            image_points = frame_width
            object_points = frame_height
            frame_width = 1920
            frame_height = 1080

        try:
            w, h = float(frame_width), float(frame_height)
            half_l = float(self.pitch_length) / 2.0  # 10.06 m
            stump_h = float(PITCH_CONFIG.get("stump_height_m", 0.711))
            half_spacing = 0.057  # meters (outer stump offset: leg is -0.057, off is +0.057)

            cx = w / 2.0
            cy = h / 2.0
            if camera_matrix is None:
                f = float(focal_length if focal_length is not None else (self.focal_length_px or (w * 1.1)))
                camera_matrix = np.array([
                    [f,   0.0, cx],
                    [0.0, f,   cy],
                    [0.0, 0.0, 1.0]
                ], dtype=np.float64)
            else:
                f = float(camera_matrix[0, 0])
            dist_coeffs = np.zeros((4, 1), dtype=np.float64)

            if image_points is not None and object_points is not None:
                pts_2d = np.ascontiguousarray(image_points, dtype=np.float64)
                pts_3d = np.ascontiguousarray(object_points, dtype=np.float64)
            else:
                # 4 known 3D stump landmarks as specified by DRS calibration
                pts_3d = np.array([
                    [ 0.0,           half_l, stump_h],  # Middle top: (0, 10.06, 0.711)
                    [ 0.0,           half_l, 0.0    ],  # Middle base: (0, 10.06, 0.0)
                    [-half_spacing,  half_l, stump_h],  # Leg top: (-0.057, 10.06, 0.711)
                    [ half_spacing,  half_l, stump_h]   # Off top: (0.057, 10.06, 0.711)
                ], dtype=np.float64)

                stump_dict = stumps_pos if stumps_pos is not None else stumps_2d

                stump_cx = cx
                stump_base_y = h * 0.82
                stump_px_w = max(20.0, w * 0.035)
                stump_px_h = max(35.0, h * 0.09)

                if stump_dict and isinstance(stump_dict, dict):
                    if 'pixel_position' in stump_dict and isinstance(stump_dict['pixel_position'], (tuple, list)):
                        stump_cx = float(stump_dict['pixel_position'][0])
                        stump_base_y = float(stump_dict['pixel_position'][1])
                    elif 'x' in stump_dict and 'y' in stump_dict:
                        stump_cx = float(stump_dict['x'])
                        stump_base_y = float(stump_dict['y'])
                    elif 'center_x' in stump_dict and 'center_y' in stump_dict:
                        stump_cx = float(stump_dict['center_x'])
                        stump_base_y = float(stump_dict['center_y'])

                    if 'size' in stump_dict and isinstance(stump_dict['size'], (tuple, list)):
                        stump_px_w = max(10.0, float(stump_dict['size'][0]))
                        stump_px_h = max(15.0, float(stump_dict['size'][1]))
                    elif 'width' in stump_dict and 'height' in stump_dict:
                        stump_px_w = max(10.0, float(stump_dict['width']))
                        stump_px_h = max(15.0, float(stump_dict['height']))

                top_y = stump_base_y - stump_px_h
                half_w_px = max(10.0, stump_px_w * 0.45)

                pts_2d = np.array([
                    [stump_cx,              top_y       ],  # Middle top
                    [stump_cx,              stump_base_y],  # Middle base
                    [stump_cx - half_w_px,  top_y       ],  # Leg top
                    [stump_cx + half_w_px,  top_y       ]   # Off top
                ], dtype=np.float64)

            if len(pts_3d) < 4 or len(pts_2d) < 4:
                return {
                    'success': False,
                    'error': 'At least 4 correspondences required for PnP',
                    'rvec': None,
                    'tvec': None,
                    'rotation_matrix': None,
                    'camera_position': None
                }

            # Evaluate candidate PnP algorithms and select the one with minimal reprojection error
            candidate_flags = []
            if hasattr(cv2, 'SOLVEPNP_SQPNP'):
                candidate_flags.append(cv2.SOLVEPNP_SQPNP)
            if len(pts_3d) >= 5 and hasattr(cv2, 'SOLVEPNP_EPNP'):
                candidate_flags.append(cv2.SOLVEPNP_EPNP)
            candidate_flags.append(cv2.SOLVEPNP_ITERATIVE)

            best_err = float('inf')
            best_rvec = None
            best_tvec = None

            for flag in candidate_flags:
                try:
                    ok, r_cand, t_cand = cv2.solvePnP(
                        pts_3d, pts_2d, camera_matrix, dist_coeffs, flags=flag
                    )
                    if ok and r_cand is not None and t_cand is not None:
                        proj, _ = cv2.projectPoints(pts_3d, r_cand, t_cand, camera_matrix, dist_coeffs)
                        err = float(np.mean(np.linalg.norm(pts_2d - proj.reshape(-1, 2), axis=1)))
                        if err < best_err:
                            best_err = err
                            best_rvec = r_cand
                            best_tvec = t_cand
                        if err < 1e-4:
                            break
                except Exception:
                    continue

            if best_rvec is None or best_tvec is None:
                return {
                    'success': False,
                    'error': 'solvePnP optimization did not converge',
                    'rvec': None,
                    'tvec': None,
                    'rotation_matrix': None,
                    'camera_position': None
                }

            rvec = best_rvec
            tvec = best_tvec
            R, _ = cv2.Rodrigues(rvec)
            cam_world = -R.T @ tvec

            reproj_err = best_err

            return {
                'success': True,
                'rvec': rvec,
                'tvec': tvec,
                'rotation_matrix': R,
                'camera_position': cam_world.flatten().tolist() if isinstance(cam_world, np.ndarray) else cam_world,
                'camera_height_m': float(abs(cam_world[2, 0]) if cam_world.ndim == 2 else abs(cam_world[2])),
                'focal_length_px': f,
                'reprojection_error': round(reproj_err, 4),
                'camera_matrix': camera_matrix,
                'landmarks_3d': pts_3d,
                'landmarks_2d': pts_2d,
                'num_correspondences': len(pts_3d)
            }
        except Exception as e:
            logger.warning(f"Error in PnP camera pose estimation: {e}")
            return {
                'success': False,
                'error': str(e),
                'rvec': None,
                'tvec': None,
                'rotation_matrix': None,
                'camera_position': None
            }

    def _init_yolo_detector(self):
        """Initialize YOLO detector with custom best.pt or pretrained baseline"""
        try:
            from ultralytics import YOLO
            from pathlib import Path
            candidates = [
                Path(__file__).resolve().parent.parent / "models" / "best.pt",
                Path(__file__).resolve().parent.parent.parent.parent / "best.pt",
                Path(__file__).resolve().parent.parent.parent.parent / "runs" / "detect" / "cricket_yolo" / "weights" / "best.pt",
                Path("best.pt"),
                Path("yolov8n.pt"),
                Path(__file__).resolve().parent.parent.parent.parent / "yolov8n.pt",
            ]
            for cand in candidates:
                if cand.exists():
                    self.yolo_detector = YOLO(str(cand))
                    logger.info(f"Loaded YOLO detector from: {cand}")
                    return
            self.yolo_detector = YOLO("yolov8n.pt")
            logger.info("Initialized baseline YOLOv8n detector")
        except Exception as e:
            logger.warning(f"Could not load YOLO detector: {e}. Falling back to classical CV.")
            self.yolo_detector = None

    def _detect_ball_yolo(self, frame):
        """Detect cricket ball using YOLO neural detector"""
        if self.yolo_detector is None:
            return None
        try:
            results = self.yolo_detector(frame, verbose=False, conf=0.15)[0]
            if len(results.boxes) == 0:
                return None
            best_ball = None
            max_conf = 0.0
            for box in results.boxes:
                cls_id = int(box.cls[0])
                cls_name = self.yolo_detector.names.get(cls_id, str(cls_id)).lower()
                conf = float(box.conf[0])
                is_ball = (cls_name in ['ball', 'sports ball', '0']) or (cls_id == 0 and len(self.yolo_detector.names) <= 2)
                if is_ball and conf > max_conf:
                    max_conf = conf
                    xyxy = box.xyxy[0].tolist()
                    w = float(xyxy[2] - xyxy[0])
                    h = float(xyxy[3] - xyxy[1])
                    cx = float(xyxy[0] + w / 2.0)
                    cy = float(xyxy[1] + h / 2.0)
                    best_ball = {
                        'x': cx,
                        'y': cy,
                        'width': w,
                        'height': h,
                        'radius': max(w, h) / 2.0,
                        'confidence': conf,
                        'method': 'yolo',
                        'color': 'detected'
                    }
            return best_ball
        except Exception as e:
            logger.debug(f"Error in YOLO ball detection: {e}")
            return None

    def _detect_stumps_yolo(self, frame):
        """Detect cricket stumps using YOLO neural detector"""
        if self.yolo_detector is None:
            return None
        try:
            results = self.yolo_detector(frame, verbose=False, conf=0.20)[0]
            if len(results.boxes) == 0:
                return None
            best_stump = None
            max_conf = 0.0
            for box in results.boxes:
                cls_id = int(box.cls[0])
                cls_name = self.yolo_detector.names.get(cls_id, str(cls_id)).lower()
                conf = float(box.conf[0])
                is_stump = (cls_name in ['stump', 'stumps', 'wicket', '1']) or (cls_id == 1 and len(self.yolo_detector.names) <= 2)
                if is_stump and conf > max_conf:
                    max_conf = conf
                    xyxy = box.xyxy[0].tolist()
                    w = float(xyxy[2] - xyxy[0])
                    h = float(xyxy[3] - xyxy[1])
                    cx = float(xyxy[0] + w / 2.0)
                    cy = float(xyxy[1] + h / 2.0)
                    best_stump = {
                        'x': cx,
                        'y': cy,
                        'width': w,
                        'height': h,
                        'confidence': conf,
                        'method': 'yolo'
                    }
            return best_stump
        except Exception as e:
            logger.debug(f"Error in YOLO stump detection: {e}")
            return None

    def track_ball(self, video_path: str) -> Dict[str, Any]:
        """
        Comprehensive ball tracking with pitch analysis, LBW detection, and 3D reconstruction
        """
        start_time = time.time()
        logger.info(f"Starting comprehensive ball tracking for: {video_path}")

        # Open video
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise ValueError(f"Could not open video file: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        logger.info(f"Video specs: {fps} FPS, {frame_count} frames, {width}x{height}")

        # Initialize tracking data
        tracking_data = {
            'ball_trajectory': [],
            'stumps_position': None,
            'pitch_boundaries': None,
            'bowler_position': None,
            'batter_position': None,
            'lbw_analysis': [],
            'timestamps': [],
            'frame_data': [],
            'last_ball_position': None,
            'ball_velocity': None,
            'consecutive_predictions': 0,
            'last_real_detection_time': None
        }

        # First pass: Analyze pitch and find static elements
        logger.info("First pass: Analyzing pitch and static elements...")
        pitch_info = self._analyze_pitch_and_static_elements(cap, width, height)

        # Store static elements in tracking data
        if pitch_info and pitch_info.get('stumps'):
            tracking_data['stumps_position'] = pitch_info['stumps']
            logger.info(f"Stumps detected at position: {pitch_info['stumps'].get('position_3d', 'N/A')}")

        # Reset video to beginning
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        # Second pass: Track dynamic elements
        logger.info("Second pass: Tracking dynamic elements...")
        frame_idx = 0
        prev_frame = None
        max_frames = min(frame_count, MAX_PROCESSING_FRAMES)

        while frame_idx < max_frames:
            ret, frame = cap.read()
            if not ret:
                break

            current_time = frame_idx / fps

            # Report progress if callback is provided
            if self.progress_callback and (frame_idx % 5 == 0 or frame_idx == max_frames - 1):
                try:
                    self.progress_callback(frame_idx + 1, max_frames, stage="Tracking ball trajectory")
                except Exception:
                    pass

            # Process frame
            frame_data = self._process_frame(frame, prev_frame, pitch_info, current_time, frame_idx, tracking_data)

            # Store frame data
            tracking_data['frame_data'].append(frame_data)
            tracking_data['timestamps'].append(current_time)

            # Update trajectory if ball detected with high confidence
            if frame_data['ball_position'] is not None and frame_data['ball_position']['confidence'] > self.min_confidence:
                ball_pos = frame_data['ball_position']

                # Check temporal consistency in 2D pixel space where max_velocity (px/s) is defined
                if tracking_data['last_ball_position'] is not None:
                    last_pos = tracking_data['last_ball_position']
                    
                    # Pixel coordinates
                    curr_px = ball_pos.get('pixel_x', ball_pos['x'])
                    curr_py = ball_pos.get('pixel_y', ball_pos['y'])
                    last_px = last_pos.get('pixel_x', last_pos['x'])
                    last_py = last_pos.get('pixel_y', last_pos['y'])
                    
                    pixel_distance = float(np.sqrt((curr_px - last_px)**2 + (curr_py - last_py)**2))

                    # Calculate expected maximum distance based on elapsed time and typical ball speed in px/s
                    time_diff = max(1e-4, current_time - last_pos.get('t', current_time - 0.033))
                    max_expected_distance = max(time_diff * self.max_velocity, float(self.prediction_tolerance))

                    # Check velocity consistency in pixel space
                    velocity_consistent = True
                    if tracking_data.get('ball_pixel_velocity') is not None and time_diff > 0:
                        expected_px = last_px + tracking_data['ball_pixel_velocity']['vx'] * time_diff
                        expected_py = last_py + tracking_data['ball_pixel_velocity']['vy'] * time_diff
                        prediction_error = float(np.sqrt((curr_px - expected_px)**2 + (curr_py - expected_py)**2))
                        velocity_consistent = prediction_error < (self.prediction_tolerance * 2.0)

                    # If ball moved too far in pixel space or velocity is inconsistent, skip as false positive
                    if pixel_distance > max_expected_distance or not velocity_consistent:
                        logger.debug(f"Ball position inconsistent at frame {frame_idx} (dist={pixel_distance:.1f}px, max={max_expected_distance:.1f}px), skipping")
                    else:
                        # Update velocity estimates
                        if time_diff > 0:
                            vx = (ball_pos['x'] - last_pos['x']) / time_diff
                            vy = (ball_pos['y'] - last_pos['y']) / time_diff
                            vz = (ball_pos['z'] - last_pos['z']) / time_diff
                            tracking_data['ball_velocity'] = {'vx': vx, 'vy': vy, 'vz': vz}

                            pvx = (curr_px - last_px) / time_diff
                            pvy = (curr_py - last_py) / time_diff
                            tracking_data['ball_pixel_velocity'] = {'vx': pvx, 'vy': pvy}

                        ball_pos['t'] = current_time
                        ball_pos['is_predicted'] = False
                        ball_pos['frame_idx'] = frame_idx
                        tracking_data['ball_trajectory'].append(ball_pos)
                        tracking_data['last_ball_position'] = ball_pos
                        tracking_data['last_real_detection_time'] = current_time
                        tracking_data['consecutive_predictions'] = 0
                else:
                    # First detection - initialize velocities as zero
                    tracking_data['ball_velocity'] = {'vx': 0.0, 'vy': 0.0, 'vz': 0.0}
                    tracking_data['ball_pixel_velocity'] = {'vx': 0.0, 'vy': 0.0}
                    ball_pos['t'] = current_time
                    ball_pos['is_predicted'] = False
                    ball_pos['frame_idx'] = frame_idx
                    tracking_data['ball_trajectory'].append(ball_pos)
                    tracking_data['last_ball_position'] = ball_pos
                    tracking_data['last_real_detection_time'] = current_time
                    tracking_data['consecutive_predictions'] = 0

            elif frame_data['ball_position'] is None and len(tracking_data['ball_trajectory']) > 0:
                # No detection but we have previous trajectory - try to predict within gap limits
                time_since_real = current_time - (tracking_data.get('last_real_detection_time') or current_time)
                if time_since_real <= MAX_PREDICTION_GAP_S and tracking_data.get('consecutive_predictions', 0) < 5:
                    predicted_pos = self._predict_ball_position(tracking_data, current_time)
                    if predicted_pos:
                        predicted_pos['frame_idx'] = frame_idx
                        tracking_data['ball_trajectory'].append(predicted_pos)
                        tracking_data['last_ball_position'] = predicted_pos
                        tracking_data['consecutive_predictions'] = tracking_data.get('consecutive_predictions', 0) + 1

            # Update positions
            if frame_data['bowler_position']:
                tracking_data['bowler_position'] = frame_data['bowler_position']
            if frame_data['batter_position']:
                tracking_data['batter_position'] = frame_data['batter_position']

            prev_frame = frame.copy()
            frame_idx += 1

            if frame_idx % 30 == 0:  # Log every second
                ball_count = len(tracking_data['ball_trajectory'])
                logger.info(f"Processed {frame_idx}/{frame_count} frames ({frame_idx/frame_count*100:.1f}%). Ball detections: {ball_count}")

        cap.release()

        # Post-processing
        logger.info("Post-processing trajectory data...")
        tracking_data = self._post_process_tracking_data(tracking_data)

        # LBW & Hawk-Eye Analysis
        logger.info("Performing Hawk-Eye DRS physics analysis...")
        lbw_analysis, drs_data = self._analyze_lbw_decisions(tracking_data)
        tracking_data['lbw_analysis'] = lbw_analysis

        processing_time = time.time() - start_time
        logger.info(f"Ball tracking completed in {processing_time:.2f}s. Detected {len(tracking_data['ball_trajectory'])} ball positions.")

        # Synchronize timestamps with trajectory points
        timestamps = [point['t'] for point in tracking_data['ball_trajectory']]

        result = {
            "points": tracking_data['ball_trajectory'],
            "timestamps": timestamps,
            "confidence_score": self._calculate_trajectory_confidence(tracking_data['ball_trajectory']),
            "ball_detected": len(tracking_data['ball_trajectory']) > 0,
            "processing_time": processing_time,
            "video_info": {
                "fps": fps,
                "frame_count": frame_count,
                "width": width,
                "height": height
            },
            "pitch_info": pitch_info,
            "stumps_position": tracking_data['stumps_position'],
            "bowler_position": tracking_data['bowler_position'],
            "batter_position": tracking_data['batter_position'],
            "lbw_analysis": tracking_data['lbw_analysis'],
            # Hawk-Eye DRS segmented physics fields
            "pre_bounce_points": drs_data.get("pre_bounce_points"),
            "post_bounce_points": drs_data.get("post_bounce_points"),
            "extrapolated_points": drs_data.get("extrapolated_points"),
            "bounce_point": drs_data.get("bounce_point"),
            "impact_point": drs_data.get("impact_point"),
            "stump_plane_target": drs_data.get("stump_plane_target"),
            "drs_evaluation": drs_data.get("drs_evaluation"),
            "release_speed_kmh": drs_data.get("release_speed_kmh"),
            "bounce_speed_kmh": drs_data.get("bounce_speed_kmh"),
            "length_zone": drs_data.get("length_zone"),
            "debug_info": {
                "frames_processed": len(tracking_data['frame_data']),
                "ball_detections": len(tracking_data['ball_trajectory']),
                "pitch_detected": pitch_info is not None and pitch_info.get('boundaries', {}).get('method') not in ('default', 'error_fallback'),
                "stumps_detected": (
                    tracking_data.get('stumps_position') is not None and
                    tracking_data['stumps_position'].get('method') not in ('default', 'default_fallback', 'error_fallback') and
                    tracking_data['stumps_position'].get('confidence', 0) > 0.5
                ),
                "geometry_source": {
                    "pitch": pitch_info.get('boundaries', {}).get('method', 'detected') if pitch_info else 'none',
                    "stumps": tracking_data.get('stumps_position', {}).get('method', 'detected') if tracking_data.get('stumps_position') else 'none',
                },
                "predicted_points": sum(1 for p in tracking_data['ball_trajectory'] if p.get('is_predicted', False)),
                "measured_points": sum(1 for p in tracking_data['ball_trajectory'] if not p.get('is_predicted', False)),
            }
        }

        # Convert numpy types to JSON-serializable Python types
        result = self._convert_numpy_types(result)

        return result

    def _analyze_pitch_and_static_elements(self, cap, width, height):
        """Analyze the pitch and find static elements like stumps and crease lines"""
        logger.info("Analyzing pitch and static elements...")

        # Sample frames from different parts of the video
        sample_frames = []
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Get frames from beginning, middle, and end
        for frame_pos in [0, total_frames//2, total_frames-1]:
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_pos)
            ret, frame = cap.read()
            if ret:
                sample_frames.append(frame)

        if not sample_frames:
            logger.warning("Could not sample frames for pitch analysis")
            return None

        # Analyze pitch boundaries
        pitch_boundaries = self._detect_pitch_boundaries(sample_frames[0])

        # Crease line detection via Hough lines
        crease_lines = self._detect_crease_lines(sample_frames[0])

        # Find stumps (usually static)
        stumps_position = self._detect_stumps(sample_frames[0])

        # Perspective-n-Point camera pose estimation using 3D stump landmarks
        self.pnp_pose = self._estimate_camera_pose_pnp(width, height, stumps_position)

        # Compute planar homography for metric 3D perspective mapping
        self.homography_matrix, self.inv_homography_matrix = self._compute_pitch_homography(
            width, height, pitch_boundaries, stumps_position, crease_lines
        )

        pitch_info = {
            'boundaries': pitch_boundaries,
            'stumps': stumps_position,
            'crease_lines': crease_lines,
            'dimensions': {
                'width': width,
                'height': height,
                'pitch_length_m': self.pitch_length,
                'pitch_width_m': self.pitch_width
            },
            'camera_calibration': {
                'focal_length_px': self.focal_length_px,
                'height_m': self.camera_height,
                'angle_rad': self.camera_angle,
                'homography_matrix': self.homography_matrix.tolist() if self.homography_matrix is not None else None,
                'pnp_pose': self.pnp_pose
            }
        }

        logger.info(f"Pitch analysis complete. Stumps: {stumps_position is not None}, Boundaries: {pitch_boundaries is not None}")
        return pitch_info

    def _detect_pitch_boundaries(self, frame):
        """Detect the cricket pitch boundaries using multiple methods"""
        try:
            height, width = frame.shape[:2]
            
            # Method 1: Color-based green detection with multiple ranges
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            # Multiple green ranges for different lighting conditions
            green_ranges = [
                ([30, 30, 30], [90, 255, 255]),    # Broader green range
                ([35, 50, 50], [80, 255, 255]),    # Standard grass green
                ([25, 40, 40], [95, 255, 200]),    # Darker green
            ]

            best_mask = None
            best_area = 0

            for lower, upper in green_ranges:
                lower_green = np.array(lower)
                upper_green = np.array(upper)
                pitch_mask = cv2.inRange(hsv, lower_green, upper_green)

                # Clean up mask
                kernel = np.ones((7, 7), np.uint8)
                pitch_mask = cv2.morphologyEx(pitch_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
                pitch_mask = cv2.morphologyEx(pitch_mask, cv2.MORPH_OPEN, kernel)

                # Find contours
                contours, _ = cv2.findContours(pitch_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

                if contours:
                    largest_contour = max(contours, key=cv2.contourArea)
                    area = cv2.contourArea(largest_contour)

                    if area > best_area:
                        best_area = area
                        best_mask = pitch_mask

            if best_mask is not None and best_area > 5000:  # Lower minimum threshold
                contours, _ = cv2.findContours(best_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                largest_contour = max(contours, key=cv2.contourArea)
                
                # Get bounding rectangle
                x, y, w, h = cv2.boundingRect(largest_contour)
                
                logger.info(f"Pitch detected: bbox=({x}, {y}, {w}, {h}), area={best_area}")
                
                return {
                    'bbox': (int(x), int(y), int(w), int(h)),
                    'contour': largest_contour.tolist(),
                    'area': float(best_area),
                    'center_x': float(x + w/2),
                    'center_y': float(y + h/2)
                }

            # Method 2: If color detection fails, use frame center as default
            logger.warning("Pitch color detection failed, using default frame boundaries")
            return {
                'bbox': (int(width * 0.1), int(height * 0.2), int(width * 0.8), int(height * 0.7)),
                'area': float(width * height * 0.5),
                'center_x': float(width / 2),
                'center_y': float(height / 2),
                'method': 'default',
                'geometry_source': 'assumed'
            }

        except Exception as e:
            logger.error(f"Error detecting pitch boundaries: {e}")
            # Return default boundaries
            height, width = frame.shape[:2]
            return {
                'bbox': (int(width * 0.1), int(height * 0.2), int(width * 0.8), int(height * 0.7)),
                'area': float(width * height * 0.5),
                'center_x': float(width / 2),
                'center_y': float(height / 2),
                'method': 'error_fallback',
                'geometry_source': 'assumed'
            }

    def _detect_crease_lines(self, frame: np.ndarray) -> Dict[str, Any]:
        """
        Detect pitch crease markings (popping crease, bowling crease, return creases)
        using HSV white masking, Canny edge detection, and probabilistic Hough Line Transform (cv2.HoughLinesP).
        Locates horizontal popping crease and bowling crease lines across the pitch turf.
        """
        empty_result = {
            'detected': False,
            'lines': [],
            'merged_creases': [],
            'popping_crease': None,
            'bowling_crease': None,
            'return_creases': [],
            'line_count': 0
        }
        if frame is None or not isinstance(frame, np.ndarray) or frame.size == 0:
            return empty_result

        try:
            h, w = frame.shape[:2]

            # Step 1: Detect white/bright regions typical of painted pitch creases
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            white_mask_hsv = cv2.inRange(hsv, np.array([0, 0, 160]), np.array([180, 70, 255]))

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            _, bright_mask_gray = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)

            combined_mask = cv2.bitwise_or(white_mask_hsv, bright_mask_gray)

            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
            cleaned_mask = cv2.morphologyEx(combined_mask, cv2.MORPH_OPEN, kernel)

            # Step 2: Canny edge detection
            edges = cv2.Canny(cleaned_mask, 50, 150)
            if cv2.countNonZero(edges) < 20:
                edges = cv2.Canny(gray, 60, 180)

            # Step 3: Probabilistic Hough Line Transform
            min_line_len = max(15, int(min(w, h) * 0.04))
            max_line_gap = max(8, int(min(w, h) * 0.02))
            hough_lines = cv2.HoughLinesP(
                edges,
                rho=1,
                theta=np.pi / 180,
                threshold=25,
                minLineLength=min_line_len,
                maxLineGap=max_line_gap
            )

            if hough_lines is None or len(hough_lines) == 0:
                return empty_result

            detected_lines = []
            horizontal_candidates = []
            vertical_candidates = []

            for line in hough_lines:
                coords = [int(v) for v in line.ravel()[:4]]
                if len(coords) < 4:
                    continue
                x1, y1, x2, y2 = coords
                dx = float(x2 - x1)
                dy = float(y2 - y1)
                length = float(np.hypot(dx, dy))
                angle_deg = float(np.abs(np.degrees(np.arctan2(dy, dx))))
                if angle_deg > 90:
                    angle_deg = 180 - angle_deg

                line_dict = {
                    'x1': int(min(x1, x2)),
                    'y1': int(y1 if x1 <= x2 else y2),
                    'x2': int(max(x1, x2)),
                    'y2': int(y2 if x1 <= x2 else y1),
                    'length': round(length, 2),
                    'angle_deg': round(angle_deg, 2),
                    'center_y': float((y1 + y2) / 2.0),
                    'center_x': float((x1 + x2) / 2.0),
                    'y_mid': float((y1 + y2) / 2.0),
                }
                detected_lines.append(line_dict)

                if angle_deg <= 25.0:
                    horizontal_candidates.append(line_dict)
                elif angle_deg >= 65.0:
                    vertical_candidates.append(line_dict)

            # Cluster horizontal lines by vertical position (within 25 px)
            horizontal_candidates.sort(key=lambda l: l['center_y'])
            clusters = []
            for line in horizontal_candidates:
                if not clusters:
                    clusters.append([line])
                else:
                    if abs(line['center_y'] - clusters[-1][-1]['center_y']) < 25.0:
                        clusters[-1].append(line)
                    else:
                        clusters.append([line])

            merged_horizontal = []
            for c in clusters:
                avg_y = float(np.mean([l['center_y'] for l in c]))
                min_x = min(l['x1'] for l in c)
                max_x = max(l['x2'] for l in c)
                max_len = max(l['length'] for l in c)
                avg_angle = float(np.mean([l['angle_deg'] for l in c]))
                merged_horizontal.append({
                    'center_y': round(avg_y, 2),
                    'y_mid': round(avg_y, 2),
                    'x1': min_x,
                    'y1': int(round(avg_y)),
                    'x2': max_x,
                    'y2': int(round(avg_y)),
                    'length': round(max_len, 2),
                    'angle_deg': round(avg_angle, 2),
                    'line_count': len(c)
                })

            popping_crease = None
            bowling_crease = None

            batsman_half_horiz = [l for l in horizontal_candidates if l['center_y'] >= h * 0.40]
            bowler_half_horiz = [l for l in horizontal_candidates if l['center_y'] < h * 0.55]

            # If lines exist in both halves (bowler end and batsman end)
            if batsman_half_horiz and bowler_half_horiz and any(l['center_y'] < h * 0.45 for l in bowler_half_horiz):
                popping_crease = max(batsman_half_horiz, key=lambda l: l['length'])
                bowler_end_candidates = [l for l in bowler_half_horiz if l['center_y'] < h * 0.45]
                bowling_crease = max(bowler_end_candidates, key=lambda l: l['length'])
            elif len(batsman_half_horiz) >= 2:
                # Two distinct lines at batsman end: popping crease is further up pitch (smaller y)
                # bowling crease is at the stumps base (larger y)
                sorted_batsman = sorted(batsman_half_horiz, key=lambda l: l['center_y'])
                popping_crease = sorted_batsman[0]
                bowling_crease = sorted_batsman[-1]
            elif batsman_half_horiz:
                cand = batsman_half_horiz[0]
                if cand['center_y'] > h * 0.75:
                    bowling_crease = cand
                else:
                    popping_crease = cand
            elif bowler_half_horiz:
                bowling_crease = max(bowler_half_horiz, key=lambda l: l['length'])

            if popping_crease is None and horizontal_candidates:
                popping_crease = max(horizontal_candidates, key=lambda l: l['length'])

            return {
                'detected': len(detected_lines) > 0,
                'lines': detected_lines,
                'merged_creases': merged_horizontal,
                'popping_crease': popping_crease,
                'bowling_crease': bowling_crease,
                'return_creases': vertical_candidates,
                'line_count': len(detected_lines)
            }
        except Exception as e:
            logger.warning(f"Crease line detection error: {e}")
            return empty_result

    def _detect_stumps(self, frame):
        """Enhanced stump detection using multiple methods with YOLO priority"""
        try:
            height, width = frame.shape[:2]

            # Method 0: YOLO Stump Detection
            stump_yolo = self._detect_stumps_yolo(frame)
            if stump_yolo and stump_yolo['confidence'] >= 0.25:
                x_pos = stump_yolo['x']
                y_pos = stump_yolo['y']
                w_val = stump_yolo['width']
                h_val = stump_yolo['height']
                base_y = y_pos + h_val / 2.0
                stumps_3d = self._pixel_to_3d(x_pos, base_y, width, height)
                return {
                    'pixel_position': (float(x_pos), float(base_y)),
                    'size': (float(w_val), float(h_val)),
                    'position_3d': stumps_3d,
                    'confidence': float(stump_yolo['confidence']),
                    'stump_count': 3,
                    'method': 'yolo'
                }

            # Method 1: Edge-based detection
            stumps_from_edges = self._detect_stumps_by_edges(frame)

            # Method 2: Color-based detection
            stumps_from_color = self._detect_stumps_by_color(frame)

            # Method 3: Template matching
            stumps_from_template = self._detect_stumps_by_template(frame)

            # Combine detections
            all_candidates = []
            if stumps_from_edges:
                all_candidates.extend(stumps_from_edges)
            if stumps_from_color:
                all_candidates.extend(stumps_from_color)
            if stumps_from_template:
                all_candidates.extend(stumps_from_template)

            logger.info(f"Found {len(all_candidates)} stump candidates from all methods")

            if not all_candidates:
                logger.warning("No stump candidates found, using default position")
                # Return default stump position (center-left of frame)
                default_x = width * 0.35
                default_y = height * 0.65
                stumps_3d = self._pixel_to_3d(default_x, default_y, width, height)
                return {
                    'pixel_position': (float(default_x), float(default_y)),
                    'size': (60.0, 80.0),
                    'position_3d': stumps_3d,
                    'confidence': 0.3,
                    'stump_count': 3,
                    'method': 'default',
                    'geometry_source': 'assumed'
                }

            # Group nearby detections (they might be detecting the same stumps)
            grouped_stumps = self._group_stump_candidates(all_candidates)

            # Find the best stump group (should be 3 stumps in a line)
            best_group = None
            best_score = 0

            for group in grouped_stumps:
                if len(group) >= 1:  # Accept even single stump detections
                    # Calculate group properties
                    centers = []
                    for s in group:
                        try:
                            # Ensure x and y are numbers
                            x_val = s.get('x') if hasattr(s, 'get') else None
                            y_val = s.get('y') if hasattr(s, 'get') else None
                            
                            if x_val is None or y_val is None:
                                continue
                            
                            # Convert to float, handling various cases
                            if isinstance(x_val, (int, float)):
                                x = float(x_val)
                            elif isinstance(x_val, (tuple, list)) and len(x_val) > 0:
                                x = float(x_val[0]) if isinstance(x_val[0], (int, float)) else 0.0
                            else:
                                x = 0.0
                            
                            if isinstance(y_val, (int, float)):
                                y = float(y_val)
                            elif isinstance(y_val, (tuple, list)) and len(y_val) > 0:
                                y = float(y_val[0]) if isinstance(y_val[0], (int, float)) else 0.0
                            else:
                                y = 0.0
                            
                            centers.append((x, y))
                        except (KeyError, TypeError, IndexError, ValueError, AttributeError):
                            logger.warning(f"Invalid stump candidate: {s}")
                            continue
                    
                    if len(centers) == 0:
                        continue

                    if len(centers) == 1:
                        cx, cy = centers[0]
                        score = float(group[0].get('confidence', 0.5)) * 0.7
                        if score > best_score:
                            best_score = score
                            best_group = {
                                'x': cx,
                                'y': cy,
                                'width': float(group[0].get('width', 30.0)),
                                'height': float(group[0].get('height', 80.0)),
                                'stumps': group,
                                'score': score
                            }
                        continue

                    avg_x = sum(x for x, y in centers) / len(centers)
                    avg_y = sum(y for x, y in centers) / len(centers)

                    # Check if stumps are roughly aligned (small y variation)
                    y_coords = [y for x, y in centers]
                    y_spread = max(y_coords) - min(y_coords)

                    # Check x spacing (stumps are ~2.5 inches apart = ~20-30 pixels)
                    x_coords = sorted([x for x, y in centers])
                    x_spacings = [x_coords[i+1] - x_coords[i] for i in range(len(x_coords)-1)]
                    avg_spacing = sum(x_spacings) / len(x_spacings) if x_spacings else 0

                    # Score the group
                    alignment_score = max(0, 1.0 - y_spread / 50)  # Prefer small y spread
                    spacing_score = max(0, 1.0 - abs(avg_spacing - 25) / 25)  # Prefer ~25px spacing
                    count_score = min(1.0, len(group) / 3.0)  # Prefer 3 stumps

                    total_score = (alignment_score * 0.4 + spacing_score * 0.4 + count_score * 0.2)

                    if total_score > best_score:
                        best_score = total_score
                        best_group = {
                            'x': avg_x,
                            'y': avg_y,
                            'width': max(x_coords) - min(x_coords) + 30,  # Add padding
                            'height': max(y_coords) - min(y_coords) + 20,  # Add padding
                            'stumps': group,
                            'score': total_score
                        }

            if best_group and best_score > 0.15:  # Lower minimum confidence threshold
                # Convert to 3D coordinates - ensure all values are floats
                try:
                    x_pos = float(best_group['x'])
                    y_pos = float(best_group['y'])
                    width_val = float(best_group['width'])
                    height_val = float(best_group['height'])
                    base_y = y_pos + height_val
                    
                    stumps_3d = self._pixel_to_3d(x_pos, base_y, width, height)

                    logger.info(f"✓ Stumps detected at pixel ({x_pos:.1f}, {y_pos:.1f}) "
                              f"with confidence {best_score:.2f}, count={len(best_group['stumps'])}")

                    return {
                        'pixel_position': (x_pos, base_y),
                        'size': (width_val, height_val),
                        'position_3d': stumps_3d,
                        'confidence': best_score,
                        'stump_count': len(best_group['stumps']),
                        'method': 'detected'
                    }
                except (TypeError, ValueError) as e:
                    logger.error(f"Error converting stump coordinates: {e}")

            # If best_group exists but low score, still return default
            logger.warning(f"Using default stump position (best score: {best_score:.2f})")
            default_x = width * 0.35
            default_y = height * 0.65
            stumps_3d = self._pixel_to_3d(default_x, default_y, width, height)
            return {
                'pixel_position': (float(default_x), float(default_y)),
                'size': (60.0, 80.0),
                'position_3d': stumps_3d,
                'confidence': 0.25,
                'stump_count': 3,
                'method': 'default_fallback',
                'geometry_source': 'assumed'
            }

        except Exception as e:
            logger.error(f"Error detecting stumps: {e}")
            # Return default on error
            default_x = width * 0.35
            default_y = height * 0.65
            stumps_3d = self._pixel_to_3d(default_x, default_y, width, height)
            return {
                'pixel_position': (float(default_x), float(default_y)),
                'size': (60.0, 80.0),
                'position_3d': stumps_3d,
                'confidence': 0.2,
                'stump_count': 3,
                'method': 'error_fallback'
            }

    def _detect_stumps_by_edges(self, frame):
        """Detect stumps using edge detection"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edges = cv2.Canny(blurred, 50, 150)

            # Find contours
            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            candidates = []

            for contour in contours:
                try:
                    area = cv2.contourArea(contour)
                    if 30 < area < 1000:  # Reasonable stump size
                        x, y, w, h = cv2.boundingRect(contour)
                        x, y, w, h = int(x), int(y), int(w), int(h)

                        # Use bounding rect dimensions for aspect ratio
                        aspect_ratio = h / w if w > 0 else 0

                        if aspect_ratio > 2:  # Tall objects
                            candidates.append({
                                'x': float(x + w//2),
                                'y': float(y + h//2),
                                'width': float(w),
                                'height': float(h),
                                'confidence': 0.7,  # Moderate confidence for edge detection
                                'method': 'edges'
                            })
                except (cv2.error, TypeError, ValueError, IndexError) as e:
                    logger.warning(f"Error processing contour in edge detection: {e}")
                    continue

            return candidates

        except Exception as e:
            logger.error(f"Error in edge-based stump detection: {e}")
            return []

    def _detect_stumps_by_color(self, frame):
        """Detect stumps using color segmentation"""
        try:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            # Brown color range for wooden stumps
            lower_brown = np.array([10, 30, 30])
            upper_brown = np.array([30, 150, 150])

            mask = cv2.inRange(hsv, lower_brown, upper_brown)

            kernel = np.ones((3, 3), np.uint8)
            mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            candidates = []

            for contour in contours:
                try:
                    area = cv2.contourArea(contour)
                    if 20 < area < 800:
                        x, y, w, h = cv2.boundingRect(contour)
                        aspect_ratio = h / w if w > 0 else 0

                        if aspect_ratio > 2:  # Tall objects
                            candidates.append({
                                'x': float(x + w//2),
                                'y': float(y + h//2),
                                'width': float(w),
                                'height': float(h),
                                'confidence': 0.6,  # Moderate confidence for color detection
                                'method': 'color'
                            })
                except (cv2.error, TypeError, ValueError) as e:
                    logger.warning(f"Error processing contour in color detection: {e}")
                    continue

            return candidates

        except Exception as e:
            logger.error(f"Error in color-based stump detection: {e}")
            return []

    def _detect_stumps_by_template(self, frame):
        """Detect stumps using simple template matching patterns"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            height, width = frame.shape[:2]
            
            candidates = []
            
            # Look for vertical structures in typical stump area (left-center of frame)
            roi_left = int(width * 0.2)
            roi_right = int(width * 0.6)
            roi_top = int(height * 0.4)
            roi_bottom = int(height * 0.8)
            
            roi = gray[roi_top:roi_bottom, roi_left:roi_right]
            
            # Apply edge detection
            edges = cv2.Canny(roi, 50, 150)
            
            # Find vertical lines using morphological operations
            vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 15))
            vertical_lines = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, vertical_kernel)
            
            # Find contours of vertical structures
            contours, _ = cv2.findContours(vertical_lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            for contour in contours:
                area = cv2.contourArea(contour)
                if 50 < area < 1500:
                    x, y, w, h = cv2.boundingRect(contour)
                    aspect_ratio = h / w if w > 0 else 0
                    
                    # Look for tall, thin structures
                    if aspect_ratio > 2.5:
                        candidates.append({
                            'x': float(x + w//2 + roi_left),
                            'y': float(y + h//2 + roi_top),
                            'width': float(w),
                            'height': float(h),
                            'confidence': 0.5,
                            'method': 'template'
                        })
            
            return candidates
            
        except Exception as e:
            logger.error(f"Error in template-based stump detection: {e}")
            return []

    def _detect_stumps_by_shape(self, frame):
        """Detect stumps using Hough line detection"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 50, 150)

            # Detect lines
            lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=50, minLineLength=30, maxLineGap=10)

            if lines is None:
                return []

            # Group lines that might form stumps
            vertical_lines = []
            for line in lines:
                try:
                    line_data = line[0]
                    if len(line_data) >= 4:
                        try:
                            x1 = float(line_data[0])
                            y1 = float(line_data[1])
                            x2 = float(line_data[2])
                            y2 = float(line_data[3])
                        except (IndexError, TypeError, ValueError):
                            continue
                        angle = abs(np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi)

                        if 60 < angle < 120:  # Roughly vertical
                            length = np.sqrt((x2-x1)**2 + (y2-y1)**2)
                            if length > 20:  # Minimum length
                                vertical_lines.append({
                                    'x': float((x1 + x2) // 2),
                                    'y': float((y1 + y2) // 2),
                                    'length': float(length),
                                    'angle': float(angle)
                                })
                except (IndexError, TypeError):
                    continue

            # Convert vertical lines to stump candidates
            candidates = []
            for line in vertical_lines:
                candidates.append({
                    'x': float(line['x']),
                    'y': float(line['y']),
                    'width': 5.0,  # Estimated width
                    'height': float(line['length']),
                    'confidence': 0.5,  # Lower confidence for shape detection
                    'method': 'shape'
                })

            return candidates

        except Exception as e:
            logger.error(f"Error in shape-based stump detection: {e}")
            return []

    def _group_stump_candidates(self, candidates, distance_threshold=50):
        """Group nearby stump candidates that likely represent the same stumps"""
        if not candidates:
            return []

        groups = []

        for candidate in candidates:
            # Ensure candidate is a dict with valid coordinates
            try:
                if not hasattr(candidate, 'get'):
                    logger.warning(f"Invalid candidate type: {type(candidate)}")
                    continue
                cand_x_val = candidate.get('x')
                cand_y_val = candidate.get('y')
                if cand_x_val is None or cand_y_val is None:
                    logger.warning(f"Invalid candidate missing coordinates: {candidate}")
                    continue
                
                # Convert to float
                if isinstance(cand_x_val, (int, float)):
                    cand_x = float(cand_x_val)
                elif isinstance(cand_x_val, (tuple, list)) and len(cand_x_val) > 0:
                    cand_x = float(cand_x_val[0]) if isinstance(cand_x_val[0], (int, float)) else 0.0
                else:
                    cand_x = 0.0
                
                if isinstance(cand_y_val, (int, float)):
                    cand_y = float(cand_y_val)
                elif isinstance(cand_y_val, (tuple, list)) and len(cand_y_val) > 0:
                    cand_y = float(cand_y_val[0]) if isinstance(cand_y_val[0], (int, float)) else 0.0
                else:
                    cand_y = 0.0
            except (KeyError, TypeError, ValueError, IndexError, AttributeError) as e:
                logger.warning(f"Error processing candidate: {e}, candidate: {candidate}")
                continue

            # Find existing group this candidate belongs to
            found_group = False

            for group in groups:
                for existing in group:
                    try:
                        if not isinstance(existing, dict):
                            continue
                        if 'x' not in existing or 'y' not in existing:
                            continue
                        ex_x = float(existing['x']) if not isinstance(existing['x'], (tuple, list)) else float(existing['x'][0])
                        ex_y = float(existing['y']) if not isinstance(existing['y'], (tuple, list)) else float(existing['y'][1])
                        distance = np.sqrt((cand_x - ex_x)**2 + (cand_y - ex_y)**2)
                        if distance < distance_threshold:
                            group.append(candidate)
                            found_group = True
                            break
                    except (TypeError, ValueError) as e:
                        logger.warning(f"Error calculating distance: {e}")
                        continue

                if found_group:
                    break

            if not found_group:
                groups.append([candidate])

        return groups

    def _process_frame(self, frame, prev_frame, pitch_info, current_time, frame_idx, tracking_data=None):
        """Process a single frame for object detection"""
        frame_data = {
            'frame_idx': frame_idx,
            'timestamp': current_time,
            'ball_position': None,
            'bowler_position': None,
            'batter_position': None,
            'stumps_visible': False
        }

        # Detect ball
        ball_pos = self._detect_ball_comprehensive(frame, prev_frame)
        if ball_pos:
            # Convert to 3D coordinates
            ball_3d = self._pixel_to_3d(ball_pos['x'], ball_pos['y'], frame.shape[1], frame.shape[0])
            frame_data['ball_position'] = {
                'x': ball_3d[0],
                'y': ball_3d[1],
                'z': ball_3d[2],
                'confidence': float(ball_pos['confidence']),
                'pixel_x': float(ball_pos['x']),
                'pixel_y': float(ball_pos['y']),
                'pixel_radius': float(ball_pos.get('radius', 0.0)),
                'detector_score': float(ball_pos.get('confidence', 0.0)),
                'frame_idx': frame_idx,
            }

        # Detect bowler (usually moving towards the batsman)
        bowler_pos = self._detect_bowler(frame, prev_frame)
        if bowler_pos:
            bowler_3d = self._pixel_to_3d(bowler_pos['x'], bowler_pos['y'], frame.shape[1], frame.shape[0])
            frame_data['bowler_position'] = {
                'x': bowler_3d[0],
                'y': bowler_3d[1],
                'z': bowler_3d[2],
                'confidence': bowler_pos['confidence']
            }

        # Detect batter (usually near the wicket)
        batter_pos = self._detect_batter(frame)
        if batter_pos:
            batter_3d = self._pixel_to_3d(batter_pos['x'], batter_pos['y'], frame.shape[1], frame.shape[0])
            frame_data['batter_position'] = {
                'x': batter_3d[0],
                'y': batter_3d[1],
                'z': batter_3d[2],
                'confidence': batter_pos['confidence']
            }

        return frame_data

    def _detect_ball_comprehensive(self, frame, prev_frame=None):
        """Comprehensive ball detection using multiple methods"""
        detections = []
        logger.debug("Starting comprehensive ball detection")

        # Method 0: YOLO Deep Learning detection
        yolo_ball = self._detect_ball_yolo(frame)
        if yolo_ball:
            detections.append(yolo_ball)
            logger.debug(f"YOLO ball found at ({yolo_ball['x']:.1f}, {yolo_ball['y']:.1f}) conf={yolo_ball['confidence']:.2f}")

        # Method 1: Color-based detection
        color_detection = self._detect_ball_by_color_advanced(frame)
        if color_detection:
            detections.append(color_detection)
            logger.debug(f"Color detection found ball at ({color_detection['x']}, {color_detection['y']}) with confidence {color_detection['confidence']:.2f}")

        # Method 2: Motion detection
        if prev_frame is not None:
            motion_detection = self._detect_ball_by_motion_advanced(frame, prev_frame)
            if motion_detection:
                detections.append(motion_detection)
                logger.debug(f"Motion detection found ball at ({motion_detection['x']}, {motion_detection['y']}) with confidence {motion_detection['confidence']:.2f}")

        # Method 3: Shape-based detection (Hough circles as fallback)
        shape_detection = self._detect_ball_by_shape(frame)
        if shape_detection:
            detections.append(shape_detection)
            logger.debug(f"Shape detection found ball at ({shape_detection['x']}, {shape_detection['y']}) with confidence {shape_detection['confidence']:.2f}")

        # Choose best detection with higher confidence threshold
        if detections:
            # Filter out low confidence detections
            valid_detections = [d for d in detections if d['confidence'] > 0.2]

            if valid_detections:
                # Sort by confidence and return the best
                best_detection = max(valid_detections, key=lambda x: x['confidence'])

                # Additional validation: check if detection is in reasonable area
                if self._is_valid_ball_position(best_detection, frame.shape):
                    logger.debug(f"Selected best detection: {best_detection['method']} method with confidence {best_detection['confidence']:.2f}")
                    return best_detection
                else:
                    logger.debug(f"Rejected detection at ({best_detection['x']}, {best_detection['y']}) - invalid position")

        logger.debug("No valid ball detections found")
        return None

    def _is_valid_ball_position(self, detection, frame_shape):
        """Check if ball position is in a valid location on the frame"""
        height, width = frame_shape[:2]
        x, y = detection['x'], detection['y']

        # Ball should be within frame bounds with margin
        margin = 20
        if x < margin or x > width - margin or y < margin or y > height - margin:
            return False

        # Ball should not be in the very top of frame (usually sky/UI)
        if y < height * 0.1:
            return False

        # Ball should not be in the very bottom of frame (usually ground/grass close to camera)
        if y > height * 0.9:
            return False

        return True

    def _detect_ball_by_color_advanced(self, frame):
        """Advanced color-based ball detection with adaptive thresholding"""
        try:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            # Define multiple color ranges for cricket balls (white, red, orange, pink)
            ball_color_ranges = {
                'white': [
                    ([0, 0, 200], [180, 30, 255]),  # Standard white
                    ([0, 0, 180], [180, 40, 255]),  # Brighter white
                ],
                'red': [
                    ([0, 50, 50], [10, 255, 255]),   # Red
                    ([170, 50, 50], [180, 255, 255]), # Red (wraparound)
                ],
                'orange': [
                    ([5, 50, 50], [15, 255, 255]),   # Orange
                    ([0, 70, 50], [10, 255, 255]),   # Dark orange
                ],
                'pink': [
                    ([150, 30, 150], [170, 150, 255]), # Pink
                    ([160, 20, 180], [180, 120, 255]), # Light pink
                ]
            }

            candidates = []

            for color_name, ranges in ball_color_ranges.items():
                for lower, upper in ranges:
                    mask = cv2.inRange(hsv, np.array(lower), np.array(upper))

                    # Apply morphological operations to clean up the mask
                    kernel = np.ones((3, 3), np.uint8)
                    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
                    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

                    # Find contours
                    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

                    for contour in contours:
                        area = cv2.contourArea(contour)
                        if 15 < area < 1500:  # Reasonable ball size range
                            # Get bounding rectangle
                            x, y, w, h = cv2.boundingRect(contour)

                            # Calculate shape properties
                            aspect_ratio = float(w) / h if h > 0 else 0
                            perimeter = cv2.arcLength(contour, True)
                            circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter > 0 else 0

                            # Calculate compactness (area to bounding box ratio)
                            rect_area = w * h
                            compactness = area / rect_area if rect_area > 0 else 0

                            # Additional check: ensure the object isn't too elongated
                            if 0.4 < aspect_ratio < 2.5 and circularity > 0.5:
                                # Get center
                                M = cv2.moments(contour)
                                if M["m00"] != 0:
                                    cx = int(M["m10"] / M["m00"])
                                    cy = int(M["m01"] / M["m00"])

                                    # Calculate color confidence based on HSV properties
                                    roi_hsv = hsv[y:y+h, x:x+w]
                                    if roi_hsv.size > 0:
                                        mean_h, mean_s, mean_v = cv2.mean(roi_hsv)[:3]

                                        # Color purity score (higher saturation = more pure color)
                                        color_purity = mean_s / 255.0

                                        # Brightness score (balls should be reasonably bright)
                                        brightness_score = mean_v / 255.0

                                        # Combine scores
                                        size_score = max(0.0, 1.0 - abs(area - 200) / 400)
                                        shape_score = circularity
                                        color_score = (color_purity * 0.7 + brightness_score * 0.3)
                                        compactness_score = compactness

                                        confidence = (
                                            size_score * 0.25 +
                                            shape_score * 0.35 +
                                            color_score * 0.25 +
                                            compactness_score * 0.15
                                        )

                                        confidence = max(0.0, min(1.0, confidence))

                                        if confidence > 0.2:  # Minimum threshold
                                            candidates.append({
                                                'x': cx,
                                                'y': cy,
                                                'confidence': confidence,
                                                'method': 'color',
                                                'color': color_name,
                                                'area': area,
                                                'circularity': circularity,
                                                'color_purity': color_purity
                                            })

            # Return the best candidate
            if candidates:
                best_candidate = max(candidates, key=lambda c: c['confidence'])
                logger.debug(f"Color detection found ball at ({best_candidate['x']}, {best_candidate['y']}) "
                           f"with confidence {best_candidate['confidence']:.2f} (color: {best_candidate['color']})")
                return best_candidate

        except Exception as e:
            logger.error(f"Error in color-based ball detection: {e}")

        return None

    def _detect_ball_by_motion_advanced(self, frame, prev_frame):
        """Advanced motion-based ball detection with improved filtering"""
        try:
            # Convert to grayscale
            gray1 = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            # Apply Gaussian blur to reduce noise
            gray1 = cv2.GaussianBlur(gray1, (21, 21), 0)
            gray2 = cv2.GaussianBlur(gray2, (21, 21), 0)

            # Compute frame difference
            frame_diff = cv2.absdiff(gray1, gray2)

            # Apply threshold to get binary image
            thresh = cv2.threshold(frame_diff, 25, 255, cv2.THRESH_BINARY)[1]

            # Dilate to fill holes and connect components
            kernel = np.ones((5, 5), np.uint8)
            thresh = cv2.dilate(thresh, kernel, iterations=2)

            # Apply morphological operations to clean up noise
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
            thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

            # Find contours
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            best_detection = None
            best_score = 0

            for contour in contours:
                area = cv2.contourArea(contour)
                if 30 < area < 3000:  # Reasonable motion area for ball (adjusted range)
                    # Get bounding rectangle
                    x, y, w, h = cv2.boundingRect(contour)

                    # Calculate aspect ratio
                    aspect_ratio = float(w) / h if h > 0 else 0

                    # Ball should be roughly circular (aspect ratio close to 1)
                    if 0.3 < aspect_ratio < 3.0:  # More lenient aspect ratio
                        # Calculate circularity
                        perimeter = cv2.arcLength(contour, True)
                        circularity = 4 * np.pi * area / (perimeter * perimeter) if perimeter > 0 else 0

                        # Calculate compactness (area to bounding box ratio)
                        rect_area = w * h
                        compactness = area / rect_area if rect_area > 0 else 0

                        # Calculate motion intensity in the region
                        roi_diff = frame_diff[y:y+h, x:x+w]
                        motion_intensity = np.mean(roi_diff) / 255.0

                        # Combine scores for final confidence
                        size_score = max(0.0, 1.0 - abs(area - 400) / 800)  # Optimal around 400 pixels
                        shape_score = max(0.0, 1.0 - abs(aspect_ratio - 1.0) * 0.3)  # Prefer square shapes
                        circularity_score = min(1.0, circularity * 2)  # Boost circular objects
                        compactness_score = compactness  # Higher is better
                        motion_score = motion_intensity  # Higher motion intensity is better

                        # Weighted combination
                        confidence = (
                            size_score * 0.2 +
                            shape_score * 0.2 +
                            circularity_score * 0.3 +
                            compactness_score * 0.2 +
                            motion_score * 0.1
                        )

                        # Ensure confidence is in [0,1] range
                        confidence = max(0.0, min(1.0, confidence))

                        # Only consider detections with reasonable confidence
                        if confidence > best_score and confidence > 0.15:
                            cx = x + w // 2
                            cy = y + h // 2

                            best_detection = {
                                'x': cx,
                                'y': cy,
                                'confidence': confidence,
                                'method': 'motion',
                                'area': area,
                                'aspect_ratio': aspect_ratio,
                                'circularity': circularity,
                                'motion_intensity': motion_intensity
                            }
                            best_score = confidence

            return best_detection

        except Exception as e:
            logger.error(f"Error in motion-based ball detection: {e}")
            return None

    def _detect_ball_by_shape(self, frame):
        """Shape-based ball detection using Hough circles"""
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (9, 9), 2)

            circles = cv2.HoughCircles(
                blurred,
                cv2.HOUGH_GRADIENT,
                dp=1.2,
                minDist=30,
                param1=50,
                param2=25,
                minRadius=self.min_ball_radius,
                maxRadius=self.max_ball_radius
            )

            if circles is not None:
                circles = np.round(circles[0, :]).astype("int")

                # Return the best circle (largest radius, reasonable position)
                best_circle = max(circles, key=lambda c: c[2])
                x, y, r = best_circle

                return {
                    'x': x,
                    'y': y,
                    'confidence': 0.5,  # Lower confidence for shape detection
                    'method': 'shape',
                    'radius': r
                }

        except Exception as e:
            logger.error(f"Error in shape-based ball detection: {e}")

        return None

    def _detect_bowler(self, frame, prev_frame=None):
        """Detect bowler position using motion and pose estimation"""
        try:
            height, width = frame.shape[:2]
            
            if prev_frame is None:
                # Return default bowler position (right side of pitch)
                return {
                    'x': width * 0.75,
                    'y': height * 0.5,
                    'confidence': 0.3,
                    'method': 'default'
                }

            # Focus on the entire frame for motion detection
            gray1 = cv2.cvtColor(prev_frame, cv2.COLOR_BGR2GRAY)
            gray2 = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            frame_diff = cv2.absdiff(gray1, gray2)
            thresh = cv2.threshold(frame_diff, 25, 255, cv2.THRESH_BINARY)[1]
            
            # Dilate to connect nearby motion regions
            kernel = np.ones((5, 5), np.uint8)
            thresh = cv2.dilate(thresh, kernel, iterations=2)

            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            # Find motion regions that could be bowler
            bowler_candidates = []
            for contour in contours:
                area = cv2.contourArea(contour)
                if 500 < area < 25000:  # Reasonable human size range
                    x, y, w, h = cv2.boundingRect(contour)
                    
                    # Bowler typically in right or center-right portion
                    if x > width * 0.4:  # Right side bias
                        M = cv2.moments(contour)
                        if M["m00"] != 0:
                            cx = int(M["m10"] / M["m00"])
                            cy = int(M["m01"] / M["m00"])
                            
                            # Score based on position (prefer right side)
                            position_score = (cx - width * 0.5) / (width * 0.5)  # 0 to 1
                            position_score = max(0, position_score)
                            
                            # Score based on size
                            size_score = min(1.0, area / 5000)
                            
                            confidence = (position_score * 0.6 + size_score * 0.4)
                            
                            bowler_candidates.append({
                                'x': cx,
                                'y': cy,
                                'confidence': confidence,
                                'area': area
                            })

            if bowler_candidates:
                # Return bowler with highest confidence
                best_bowler = max(bowler_candidates, key=lambda b: b['confidence'])
                logger.debug(f"Bowler detected at ({best_bowler['x']}, {best_bowler['y']}) with confidence {best_bowler['confidence']:.2f}")
                return best_bowler
            
            # Return default if no detection
            return {
                'x': width * 0.75,
                'y': height * 0.5,
                'confidence': 0.3,
                'method': 'default'
            }

        except Exception as e:
            logger.error(f"Error detecting bowler: {e}")
            height, width = frame.shape[:2]
            return {
                'x': width * 0.75,
                'y': height * 0.5,
                'confidence': 0.2,
                'method': 'error_fallback'
            }

    def _detect_batter(self, frame):
        """Detect batter position near the wicket area"""
        try:
            height, width = frame.shape[:2]

            # Focus on left-center area (typical batting position)
            roi_left = int(width * 0.15)
            roi_right = int(width * 0.55)
            roi = frame[:, roi_left:roi_right]

            # Convert to grayscale
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
            
            # Use edge detection
            edges = cv2.Canny(gray, 30, 100)
            
            # Dilate to connect edges
            kernel = np.ones((5, 5), np.uint8)
            edges = cv2.dilate(edges, kernel, iterations=1)

            contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            batter_candidates = []

            for contour in contours:
                area = cv2.contourArea(contour)
                if 400 < area < 12000:  # Reasonable human size
                    x, y, w, h = cv2.boundingRect(contour)

                    # Check if tall enough (human shape)
                    aspect_ratio = h / w if w > 0 else 0
                    if 1.0 < aspect_ratio < 5.0:
                        # Position in center-bottom area is more likely batter
                        center_x = x + w/2
                        center_y = y + h/2
                        
                        # Prefer positions closer to wicket area (left-center)
                        position_score = 1.0 - abs(center_x - roi.shape[1] * 0.3) / (roi.shape[1] * 0.5)
                        position_score = max(0, position_score)
                        
                        # Prefer lower positions (batter near ground)
                        height_score = center_y / roi.shape[0]
                        
                        # Size score
                        size_score = min(1.0, area / 3000)
                        
                        confidence = (position_score * 0.4 + height_score * 0.3 + size_score * 0.3)
                        
                        batter_candidates.append({
                            'x': int(x + w//2 + roi_left),  # Adjust for ROI offset
                            'y': int(y + h//2),
                            'confidence': confidence,
                            'area': area,
                            'aspect_ratio': aspect_ratio
                        })

            if batter_candidates:
                best_batter = max(batter_candidates, key=lambda b: b['confidence'])
                logger.debug(f"Batter detected at ({best_batter['x']}, {best_batter['y']}) with confidence {best_batter['confidence']:.2f}")
                return best_batter
            
            # Return default batter position
            return {
                'x': width * 0.30,
                'y': height * 0.60,
                'confidence': 0.3,
                'method': 'default'
            }

        except Exception as e:
            logger.error(f"Error detecting batter: {e}")
            height, width = frame.shape[:2]
            return {
                'x': width * 0.30,
                'y': height * 0.60,
                'confidence': 0.2,
                'method': 'error_fallback'
            }

    def _pixel_to_3d(self, x_pixel, y_pixel, frame_width, frame_height):
        """Convert 2D pixel coordinates to 3D world coordinates in meters.
        Uses calibrated planar homography projection matrix when available, with
        graceful fallback to perspective heuristic."""
        try:
            PITCH_LENGTH = self.pitch_length   # 20.12 m
            PITCH_WIDTH = self.pitch_width     # 3.05 m

            # Metric planar homography projection
            if self.homography_matrix is not None:
                pt_img = np.array([float(x_pixel), float(y_pixel), 1.0], dtype=np.float64)
                w_pt = self.homography_matrix @ pt_img
                if abs(w_pt[2]) > 1e-6:
                    pitch_x = float(w_pt[0] / w_pt[2])
                    pitch_y = float(w_pt[1] / w_pt[2])
                else:
                    x_norm = x_pixel / frame_width
                    y_norm = y_pixel / frame_height
                    pitch_x = (x_norm - 0.5) * (PITCH_WIDTH * 3.0)
                    pitch_y = (0.5 - y_norm) * PITCH_LENGTH * 1.5

                y_norm = y_pixel / frame_height
                height_factor = max(0.0, 1.0 - y_norm)
                distance_factor = 1.0 + abs(pitch_y) / PITCH_LENGTH
                pitch_z = height_factor * 3.5 * distance_factor * 0.5

                pitch_x = max(-10.0, min(10.0, pitch_x))
                pitch_y = max(-15.0, min(15.0, pitch_y))
                pitch_z = max(0.0, min(5.0, pitch_z))
                return (float(pitch_x), float(pitch_y), float(pitch_z))

            # Heuristic fallback
            x_norm = x_pixel / frame_width
            y_norm = y_pixel / frame_height
            pitch_x = (x_norm - 0.5) * (PITCH_WIDTH * 3.0)
            pitch_y = (0.5 - y_norm) * PITCH_LENGTH * 1.5
            height_factor = 1.0 - y_norm
            distance_factor = 1.0 + abs(pitch_y) / PITCH_LENGTH
            pitch_z = height_factor * 3.5 * distance_factor * 0.5

            pitch_x = max(-10.0, min(10.0, pitch_x))
            pitch_y = max(-15.0, min(15.0, pitch_y))
            pitch_z = max(0.0, min(5.0, pitch_z))
            return (float(pitch_x), float(pitch_y), float(pitch_z))

        except Exception as e:
            logger.error(f"Error in pixel to 3D conversion: {e}")
            return (0.0, 0.0, 0.0)

    def _post_process_tracking_data(self, tracking_data):
        """Post-process tracking data for smoothing, outlier rejection, and physics regression"""
        try:
            if not tracking_data['ball_trajectory']:
                return tracking_data

            # Sort by time
            tracking_data['ball_trajectory'].sort(key=lambda p: p['t'])

            # Apply Kalman filtering for smoothing
            smoothed_trajectory = self._apply_kalman_filter(tracking_data['ball_trajectory'])

            # Remove outliers
            filtered_trajectory = self._remove_outliers(smoothed_trajectory)

            # Apply physics-constrained parabolic height regression to eliminate monocular vertical jitter
            regressed_trajectory = self._fit_parabolic_height_regression(filtered_trajectory)

            tracking_data['ball_trajectory'] = regressed_trajectory

            logger.info(f"Post-processing: {len(smoothed_trajectory)} -> {len(regressed_trajectory)} points")

        except Exception as e:
            logger.error(f"Error in post-processing: {e}")

        return tracking_data

    def _apply_kalman_filter(self, trajectory):
        """Apply Kalman filter to smooth trajectory.

        Uses a constant-velocity transition matrix F(dt) where position is
        coupled to velocity via the actual inter-frame dt — so varying frame
        rates and dropped frames are handled correctly.
        State vector: [x, y, z, vx, vy, vz]
        """
        if len(trajectory) < 2:
            return trajectory

        try:
            kalman = cv2.KalmanFilter(6, 3)  # 6-state, 3 measurements (x,y,z)

            # H: observe position only
            kalman.measurementMatrix = np.array(
                [[1,0,0,0,0,0],
                 [0,1,0,0,0,0],
                 [0,0,1,0,0,0]], np.float32
            )

            # Q: process noise — larger for velocity states (ball can accelerate/swing)
            kalman.processNoiseCov = np.diag([
                0.01, 0.01, 0.01,   # position states
                0.1,  0.1,  0.1     # velocity states
            ]).astype(np.float32)

            # R: measurement noise (heuristic detections are noisy)
            kalman.measurementNoiseCov = np.eye(3, dtype=np.float32) * 0.25

            # Initialise with first point, zero velocity
            p0 = trajectory[0]
            kalman.statePost = np.array(
                [[p0['x']], [p0['y']], [p0['z']], [0.0], [0.0], [0.0]],
                dtype=np.float32
            )
            kalman.errorCovPost = np.eye(6, dtype=np.float32)

            smoothed_points = [{**p0}]  # shallow copy preserves all metadata

            for i in range(1, len(trajectory)):
                pt = trajectory[i]
                prev_t = trajectory[i-1]['t']
                dt = max(1e-4, pt['t'] - prev_t)  # guard against zero dt

                # Build F(dt): constant-velocity model
                # [ I3  dt*I3 ]
                # [ 0   I3   ]
                F = np.eye(6, dtype=np.float32)
                F[0, 3] = dt
                F[1, 4] = dt
                F[2, 5] = dt
                kalman.transitionMatrix = F

                kalman.predict()

                meas = np.array([[pt['x']], [pt['y']], [pt['z']]], np.float32)
                # Skip Kalman correction for predicted (gap-filled) points —
                # treat them as missing measurements.
                if pt.get('is_predicted', False):
                    state = kalman.statePost
                    smoothed = {
                        **pt,
                        'x': float(state[0][0]),
                        'y': float(state[1][0]),
                        'z': max(0.0, float(state[2][0])),
                    }
                else:
                    corrected = kalman.correct(meas)
                    smoothed = {
                        **pt,
                        'x': float(corrected[0][0]),
                        'y': float(corrected[1][0]),
                        'z': max(0.0, float(corrected[2][0])),
                    }
                smoothed_points.append(smoothed)

            return smoothed_points

        except Exception as e:
            logger.error(f"Error in Kalman filtering: {e}")
            return trajectory

    def _fit_parabolic_height(
        self,
        points: List[Dict[str, Any]],
        g: float = 9.8
    ) -> List[Dict[str, Any]]:
        """
        Fit physics-constrained parabolic trajectory height:
            Z(t) = Z_0 + V_z0 * t - 0.5 * g * t^2
        to eliminate monocular vertical jitter.
        Uses relative time tau = t - t0 for numerical stability and physical meaning:
          Z_0: initial height (m) at segment start
          V_z0: initial vertical velocity (m/s) at segment start
          g: gravitational acceleration (m/s^2), fixed to 9.8
        """
        if not points:
            return []
        if len(points) < 2:
            return [{**pt, 'z': max(0.0, float(pt.get('z', 0.0)))} for pt in points]

        try:
            times = np.array([float(p.get('t', 0.0)) for p in points], dtype=np.float64)
            heights = np.array([max(0.0, float(p.get('z', 0.0))) for p in points], dtype=np.float64)

            t0 = times[0]
            tau = times - t0

            # If time span is negligible, keep original z clamped >= 0
            if np.max(tau) < 1e-4:
                return [{**pt, 'z': max(0.0, float(pt.get('z', 0.0)))} for pt in points]

            # Solve linear least squares for [Z_0, V_z0]:
            # Z(tau) + 0.5 * g * tau^2 = Z_0 + V_z0 * tau
            y = heights + 0.5 * g * (tau ** 2)
            A = np.column_stack([np.ones_like(tau), tau])

            params, _, _, _ = np.linalg.lstsq(A, y, rcond=None)
            z0 = float(params[0])
            vz0 = float(params[1])

            fitted_points = []
            for i, p in enumerate(points):
                fitted_z = z0 + vz0 * tau[i] - 0.5 * g * (tau[i] ** 2)
                fitted_z = max(0.02, min(6.0, float(fitted_z)))

                pt_copy = dict(p)
                pt_copy['z_raw'] = float(p.get('z_raw', p.get('z', 0.0)))
                pt_copy['z'] = round(float(fitted_z), 4)
                pt_copy['parabolic_fit'] = {
                    'z0': round(z0, 4),
                    'vz0': round(vz0, 4),
                    'g': g
                }
                fitted_points.append(pt_copy)

            return fitted_points

        except Exception as e:
            logger.warning(f"Error fitting parabolic height segment: {e}")
            return [{**pt, 'z': max(0.0, float(pt.get('z', 0.0)))} for pt in points]

    def _fit_parabolic_height_regression(
        self,
        trajectory: List[Dict[str, Any]],
        g: float = 9.8
    ) -> List[Dict[str, Any]]:
        """
        Fit physics-constrained parabolic vertical height regression to ball trajectory.
        Enforces Newtonian projectile motion:
            Z(t) = Z_0 + V_z0 * t - 0.5 * g * t^2
        to pre-bounce and post-bounce points to eliminate monocular vertical jitter.
        """
        if not trajectory or len(trajectory) < 2:
            return [{**pt, 'z': max(0.0, float(pt.get('z', 0.0)))} for pt in trajectory]

        try:
            if len(trajectory) < 3:
                return self._fit_parabolic_height(trajectory, g=g)

            # Identify bounce point (minimum Z along pitch where ball contacts turf)
            z_vals = [float(p.get('z', 0.0)) for p in trajectory]
            min_idx = int(np.argmin(z_vals))

            # If bounce is at boundary (all points before bounce or all after bounce)
            if min_idx <= 1 or min_idx >= len(trajectory) - 2:
                return self._fit_parabolic_height(trajectory, g=g)

            # Split into pre-bounce (up to bounce) and post-bounce (from bounce)
            pre_bounce_pts = trajectory[:min_idx + 1]
            post_bounce_pts = trajectory[min_idx:]

            fitted_pre = self._fit_parabolic_height(pre_bounce_pts, g=g)
            fitted_post = self._fit_parabolic_height(post_bounce_pts, g=g)

            # Set bounce contact point height to pitch turf level (~0.036m regulation ball radius)
            bounce_pt = dict(fitted_post[0])
            bounce_pt['z'] = 0.036
            bounce_pt['phase'] = 'bounce'

            result = fitted_pre[:-1] + [bounce_pt] + fitted_post[1:]
            return result

        except Exception as e:
            logger.warning(f"Error fitting parabolic height regression: {e}")
            return [{**pt, 'z': max(0.0, float(pt.get('z', 0.0)))} for pt in trajectory]

    # Aliases for backward compatibility and method naming conventions
    _parabolic_vertical_height_regression = _fit_parabolic_height_regression
    _apply_parabolic_height_regression = _fit_parabolic_height_regression

    def _remove_outliers(self, trajectory):
        """Remove outlier points using multiple statistical methods"""
        if len(trajectory) < 3:
            return trajectory

        try:
            # Method 1: Velocity-based outlier detection
            velocities = []
            accelerations = []

            for i in range(1, len(trajectory)):
                dx = trajectory[i]['x'] - trajectory[i-1]['x']
                dy = trajectory[i]['y'] - trajectory[i-1]['y']
                dz = trajectory[i]['z'] - trajectory[i-1]['z']
                dt = trajectory[i]['t'] - trajectory[i-1]['t']

                if dt > 0:
                    speed = np.sqrt(dx**2 + dy**2 + dz**2) / dt
                    velocities.append(speed)

                    # Calculate acceleration if we have enough points
                    if i > 1:
                        prev_speed = velocities[-2] if len(velocities) > 1 else speed
                        acceleration = abs(speed - prev_speed) / dt
                        accelerations.append(acceleration)

            if not velocities:
                return trajectory

            # Calculate velocity statistics
            mean_velocity = np.mean(velocities)
            std_velocity = np.std(velocities)

            # Calculate acceleration statistics if available
            accel_threshold = float('inf')
            if accelerations:
                mean_accel = np.mean(accelerations)
                std_accel = np.std(accelerations)
                accel_threshold = mean_accel + 3 * std_accel

            # Velocity threshold for outliers
            velocity_threshold = mean_velocity + 3 * std_velocity

            # Method 2: Distance-based outlier detection (sudden jumps)
            distances = []
            for i in range(1, len(trajectory)):
                dx = trajectory[i]['x'] - trajectory[i-1]['x']
                dy = trajectory[i]['y'] - trajectory[i-1]['y']
                dz = trajectory[i]['z'] - trajectory[i-1]['z']
                distance = np.sqrt(dx**2 + dy**2 + dz**2)
                distances.append(distance)

            if distances:
                mean_distance = np.mean(distances)
                std_distance = np.std(distances)
                distance_threshold = mean_distance + 3 * std_distance
            else:
                distance_threshold = float('inf')

            # Filter points
            filtered_trajectory = [trajectory[0]]  # Always keep first point

            for i in range(1, len(trajectory)):
                point = trajectory[i]
                keep_point = True

                # Check velocity outlier
                if i-1 < len(velocities):
                    velocity = velocities[i-1]
                    if velocity > velocity_threshold:
                        logger.debug(f"Removing velocity outlier at t={point['t']:.2f}: velocity={velocity:.2f} > {velocity_threshold:.2f}")
                        keep_point = False

                # Check acceleration outlier
                if i-2 >= 0 and i-2 < len(accelerations):
                    acceleration = accelerations[i-2]
                    if acceleration > accel_threshold:
                        logger.debug(f"Removing acceleration outlier at t={point['t']:.2f}: accel={acceleration:.2f} > {accel_threshold:.2f}")
                        keep_point = False

                # Check distance outlier
                if i-1 < len(distances):
                    distance = distances[i-1]
                    if distance > distance_threshold:
                        logger.debug(f"Removing distance outlier at t={point['t']:.2f}: distance={distance:.2f} > {distance_threshold:.2f}")
                        keep_point = False

                if keep_point:
                    filtered_trajectory.append(point)

            logger.info(f"Outlier removal: {len(trajectory)} -> {len(filtered_trajectory)} points")
            return filtered_trajectory

        except Exception as e:
            logger.error(f"Error in outlier removal: {e}")
            return trajectory  # Return original if filtering fails

    def _predict_ball_position(self, tracking_data, current_time):
        """Predict ball position based on recent trajectory"""
        trajectory = tracking_data['ball_trajectory']
        if len(trajectory) < 2:
            return None

        # Get last two points
        last_point = trajectory[-1]
        second_last = trajectory[-2]

        # Calculate velocity
        dt = last_point['t'] - second_last['t']
        if dt <= 0:
            return None

        vx = (last_point['x'] - second_last['x']) / dt
        vy = (last_point['y'] - second_last['y']) / dt
        vz = (last_point['z'] - second_last['z']) / dt

        # Predict next position
        time_diff = current_time - last_point['t']
        predicted_x = last_point['x'] + vx * time_diff
        predicted_y = last_point['y'] + vy * time_diff
        predicted_z = last_point['z'] + vz * time_diff

        # Predict pixel position if available
        pred_px = None
        pred_py = None
        last_px = last_point.get('pixel_x')
        second_px = second_last.get('pixel_x')
        last_py = last_point.get('pixel_y')
        second_py = second_last.get('pixel_y')
        if last_px is not None and second_px is not None and dt > 0:
            pvx = (last_px - second_px) / dt
            pvy = (last_py - second_py) / dt
            pred_px = float(last_px + pvx * time_diff)
            pred_py = float(last_py + pvy * time_diff)

        # Reduce confidence for predictions
        predicted_confidence = last_point['confidence'] * 0.7

        result = {
            'x': predicted_x,
            'y': predicted_y,
            'z': predicted_z,
            't': current_time,
            'confidence': predicted_confidence,
            'is_predicted': True,
            'detector_score': 0.0,
        }
        if pred_px is not None and pred_py is not None:
            result['pixel_x'] = pred_px
            result['pixel_y'] = pred_py
            result['pixel_radius'] = float(last_point.get('pixel_radius', 0.0))

        return result

    def _analyze_lbw_decisions(self, tracking_data):
        """
        Analyze delivery trajectory for bounce, impact, and DRS decisions.
        Leaves physical event semantics unknown unless verified by curvature evidence
        or explicitly provided (e.g. from physics simulation or annotations).
        """
        lbw_analysis = []
        drs_data = {
            "pre_bounce_points": [],
            "post_bounce_points": [],
            "extrapolated_points": [],
            "bounce_point": None,
            "impact_point": None,
            "stump_plane_target": None,
            "drs_evaluation": None,
            "release_speed_kmh": None,
            "bounce_speed_kmh": None,
            "release_speed_px_per_sec": None,
            "length_zone": None
        }

        try:
            trajectory = tracking_data.get('ball_trajectory', [])
            if not trajectory or len(trajectory) < 3:
                return lbw_analysis, drs_data

            is_simulation = tracking_data.get('is_simulation', False)
            has_pad_impact = tracking_data.get('pad_impact_verified', False) or is_simulation

            # 1. Physical Bounce Detection
            # A real pitch bounce requires curvature evidence: downward descent before,
            # upward ascent after, at an interior trajectory point near pitch level.
            bounce_idx = None
            if len(trajectory) >= 5:
                # Find candidate minimum z among interior points (skip endpoints)
                min_z = float('inf')
                cand_idx = None
                for i in range(1, len(trajectory) - 1):
                    if trajectory[i]['z'] < min_z:
                        min_z = trajectory[i]['z']
                        cand_idx = i

                if cand_idx is not None and cand_idx >= 1 and cand_idx <= len(trajectory) - 2:
                    z_curr = trajectory[cand_idx]['z']
                    z_prev = trajectory[cand_idx - 1]['z']
                    z_next = trajectory[cand_idx + 1]['z']
                    # Verify downward descent into minimum and upward ascent out of minimum
                    descending = (z_prev - z_curr) > 0.03
                    ascending = (z_next - z_curr) > 0.03
                    near_ground = z_curr <= 0.45  # within 45 cm of pitch

                    if (descending and ascending and near_ground) or is_simulation:
                        bounce_idx = cand_idx

            if bounce_idx is not None:
                bounce_point = {
                    "x": round(float(trajectory[bounce_idx]['x']), 4),
                    "y": round(float(trajectory[bounce_idx]['y']), 4),
                    "z": max(0.036, round(float(trajectory[bounce_idx]['z']), 4)),
                    "t": round(float(trajectory[bounce_idx]['t']), 4),
                    "phase": "bounce"
                }
                drs_data["bounce_point"] = bounce_point
                drs_data["pre_bounce_points"] = [dict(p, phase="pre_bounce") for p in trajectory[:bounce_idx]]
                drs_data["post_bounce_points"] = [dict(p, phase="post_bounce") for p in trajectory[bounce_idx:]]

                # Length zone calculation
                STUMP_Y = self.pitch_length / 2.0
                dist_from_stumps = STUMP_Y - bounce_point['y']
                if dist_from_stumps < 2.0:
                    drs_data["length_zone"] = "Yorker"
                elif dist_from_stumps < 4.0:
                    drs_data["length_zone"] = "Full"
                elif dist_from_stumps < 7.0:
                    drs_data["length_zone"] = "Good Length"
                elif dist_from_stumps < 9.5:
                    drs_data["length_zone"] = "Short of Length"
                else:
                    drs_data["length_zone"] = "Bouncer"
            else:
                # No verified pitch bounce — treat entire track as unsegmented trajectory
                drs_data["bounce_point"] = None
                drs_data["pre_bounce_points"] = [dict(p, phase="trajectory") for p in trajectory]
                drs_data["post_bounce_points"] = []
                drs_data["length_zone"] = None

            # 2. Impact Point & DRS Evaluation
            # Only evaluate LBW if there is verified pad impact evidence or explicit simulation
            if has_pad_impact and drs_data["bounce_point"] is not None:
                post_bounce = drs_data["post_bounce_points"]
                impact_point = dict(post_bounce[-1], phase="impact") if post_bounce else dict(trajectory[-1], phase="impact")
                drs_data["impact_point"] = impact_point

                if len(post_bounce) >= 2:
                    dt = max(0.01, post_bounce[-1]['t'] - post_bounce[0]['t'])
                    vx = (post_bounce[-1]['x'] - post_bounce[0]['x']) / dt
                    vy = max(5.0, (post_bounce[-1]['y'] - post_bounce[0]['y']) / dt)
                    if post_bounce[-1].get('parabolic_fit'):
                        # Analytical vertical velocity from fitted parabola: vz(tau) = vz0 - 9.8 * tau
                        vz0 = float(post_bounce[-1]['parabolic_fit']['vz0'])
                        tau_impact = max(0.0, post_bounce[-1]['t'] - post_bounce[0]['t'])
                        vz = vz0 - 9.8 * tau_impact
                    else:
                        vz = (post_bounce[-1]['z'] - post_bounce[0]['z']) / dt
                else:
                    vx, vy, vz = 0.0, 30.0, 1.5

                STUMP_Y = self.pitch_length / 2.0
                extrapolated = []
                curr_x, curr_y, curr_z = impact_point['x'], impact_point['y'], max(0.05, impact_point['z'])
                curr_t = impact_point['t']
                step_dt = 0.016

                while curr_y <= STUMP_Y + 0.2:
                    extrapolated.append({
                        "x": round(float(curr_x), 4),
                        "y": round(float(curr_y), 4),
                        "z": round(float(max(0.02, curr_z)), 4),
                        "t": round(float(curr_t), 4),
                        "phase": "extrapolated",
                        "confidence": 0.85
                    })
                    vz -= 9.81 * step_dt
                    curr_x += vx * step_dt
                    curr_y += vy * step_dt
                    curr_z += vz * step_dt
                    curr_t += step_dt

                drs_data["extrapolated_points"] = extrapolated

                # Stumps plane target
                stump_target_x = curr_x
                stump_target_z = max(0.02, curr_z)
                for ep in extrapolated:
                    if ep['y'] >= STUMP_Y:
                        stump_target_x = ep['x']
                        stump_target_z = ep['z']
                        break

                STUMP_WIDTH = PITCH_CONFIG.get("stump_width_m", 0.2286)
                stump_half_w = STUMP_WIDTH / 2.0
                stump_top = PITCH_CONFIG.get("stump_height_m", 0.711)

                # Pitching
                if abs(drs_data["bounce_point"]['x']) <= stump_half_w:
                    pitching_v = "IN LINE"
                elif drs_data["bounce_point"]['x'] > stump_half_w:
                    pitching_v = "OUTSIDE OFF"
                else:
                    pitching_v = "OUTSIDE LEG"

                # Impact
                if abs(impact_point['x']) <= stump_half_w:
                    impact_v = "IN LINE"
                else:
                    impact_v = "OUTSIDE"

                # Wickets
                hit_h = (stump_target_z <= stump_top) and (stump_target_z >= 0.03)
                clip_h = abs(stump_target_z - stump_top) <= 0.036
                hit_w = abs(stump_target_x) <= stump_half_w
                clip_w = abs(abs(stump_target_x) - stump_half_w) <= 0.036

                if hit_h and hit_w:
                    wickets_v = "HITTING"
                elif (hit_h and clip_w) or (clip_h and hit_w):
                    wickets_v = "UMPIRE'S CALL"
                else:
                    wickets_v = "MISSING"

                # Overall Decision
                if pitching_v == "OUTSIDE LEG":
                    decision = "NOT OUT (Pitched Outside Leg)"
                elif impact_v == "OUTSIDE":
                    decision = "NOT OUT (Impact Outside Off)"
                elif wickets_v == "HITTING":
                    decision = "OUT"
                elif wickets_v == "UMPIRE'S CALL":
                    decision = "UMPIRE'S CALL"
                else:
                    decision = "NOT OUT (Missing Wickets)"

                hit_stump = "Middle Stump"
                if stump_target_x < -0.04:
                    hit_stump = "Leg Stump"
                elif stump_target_x > 0.04:
                    hit_stump = "Off Stump"

                drs_data["stump_plane_target"] = {
                    "x": round(float(stump_target_x), 4),
                    "y": STUMP_Y,
                    "z": round(float(stump_target_z), 4),
                    "hit_stump": hit_stump
                }

                drs_data["drs_evaluation"] = {
                    "decision": decision,
                    "pitching": pitching_v,
                    "impact": impact_v,
                    "wickets": wickets_v,
                    "hit_stump": hit_stump
                }
            else:
                # Unverified impact: do not fabricate LBW verdicts for real video without pad contact
                drs_data["impact_point"] = None
                drs_data["extrapolated_points"] = []
                drs_data["stump_plane_target"] = None
                drs_data["drs_evaluation"] = None

            # 3. Speed calculation
            # Real uncalibrated single-camera video cannot measure calibrated km/h speeds.
            # Leave release_speed_kmh as None for uncalibrated footage.
            # Compute 2D pixel speed in px/sec if pixel coordinates are available.
            if len(trajectory) >= 2:
                total_t = max(0.01, trajectory[-1]['t'] - trajectory[0]['t'])
                first_px = trajectory[0].get('pixel_x')
                last_px = trajectory[-1].get('pixel_x')
                first_py = trajectory[0].get('pixel_y')
                last_py = trajectory[-1].get('pixel_y')

                if first_px is not None and last_px is not None and first_py is not None and last_py is not None:
                    px_dist = np.sqrt((last_px - first_px)**2 + (last_py - first_py)**2)
                    drs_data["release_speed_px_per_sec"] = round(float(px_dist / total_t), 1)

                if is_simulation:
                    total_dist = np.sqrt(
                        (trajectory[-1]['x'] - trajectory[0]['x'])**2 +
                        (trajectory[-1]['y'] - trajectory[0]['y'])**2 +
                        (trajectory[-1]['z'] - trajectory[0]['z'])**2
                    )
                    drs_data["release_speed_kmh"] = round(float((total_dist / total_t) * 3.6), 1)
                else:
                    drs_data["release_speed_kmh"] = None

            drs_data["bounce_speed_kmh"] = None

        except Exception as e:
            logger.error(f"Error in Hawk-Eye DRS analysis: {e}")

        return lbw_analysis, drs_data

    def _calculate_trajectory_confidence(self, trajectory):
        """Calculate overall confidence score for trajectory"""
        if not trajectory:
            return 0.0

        if len(trajectory) < 2:
            return 0.5

        # Average confidence of individual detections
        avg_confidence = np.mean([p['confidence'] for p in trajectory])

        # Consistency score based on smooth motion
        velocities = []
        for i in range(1, len(trajectory)):
            dx = trajectory[i]['x'] - trajectory[i-1]['x']
            dy = trajectory[i]['y'] - trajectory[i-1]['y']
            dt = trajectory[i]['t'] - trajectory[i-1]['t']
            if dt > 0:
                speed = np.sqrt(dx**2 + dy**2) / dt
                velocities.append(speed)

        if velocities:
            speed_std = np.std(velocities)
            speed_mean = np.mean(velocities)
            consistency = 1.0 - min(speed_std / (speed_mean + 1e-6), 1.0)  # Normalize
        else:
            consistency = 0.5

        # Combine scores
        overall_confidence = (avg_confidence * 0.6 + consistency * 0.4)

        return min(overall_confidence, 1.0)

    def _convert_numpy_types(self, obj):
        """
        Recursively convert numpy types to Python native types for JSON serialization.
        """
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        elif isinstance(obj, (np.integer, np.int32, np.int64)):
            return int(obj)
        elif isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        elif isinstance(obj, (np.bool_, bool)):
            return bool(obj)
        elif isinstance(obj, dict):
            return {key: self._convert_numpy_types(value) for key, value in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [self._convert_numpy_types(item) for item in obj]
        else:
            return obj
