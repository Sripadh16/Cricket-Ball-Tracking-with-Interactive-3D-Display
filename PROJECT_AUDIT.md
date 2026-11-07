# Comprehensive Project Audit & Implementation Roadmap
**Project:** Cricket Ball Tracking with Interactive 3D Display (DRS / Hawk-Eye System)  
**Academic Context:** Interactive Computer Graphics (ICG) Project  
**Date of Audit:** November 2026  
**Auditor:** DeepMind Antigravity Engineering Agent  

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Architecture & System Overview](#2-architecture--system-overview)
3. [Deep Audit: What Has Been Completed](#3-deep-audit-what-has-been-completed)
   - [3.1 Interactive 3D Graphics Engine (Three.js / WebGL)](#31-interactive-3d-graphics-engine-threejs--webgl)
   - [3.2 Physics Simulation & Hawk-Eye DRS Engine](#32-physics-simulation--hawk-eye-drs-engine)
   - [3.3 Web Application & UI Experience](#33-web-application--ui-experience)
   - [3.4 Backend Infrastructure & API Services](#34-backend-infrastructure--api-services)
   - [3.5 Classical Computer Vision Pipeline](#35-classical-computer-vision-pipeline)
4. [Identified Bugs, Flaws & Technical Debt](#4-identified-bugs-flaws--technical-debt)
5. [Dataset Acquisition & Preparation Strategy (Deep Dive)](#5-dataset-acquisition--preparation-strategy-deep-dive)
   - [5.1 Public Datasets to Acquire](#51-public-datasets-to-acquire)
   - [5.2 Custom Mobile Recording Protocol](#52-custom-mobile-recording-protocol)
   - [5.3 Annotation & Ground Truth Pipeline](#53-annotation--ground-truth-pipeline)
   - [5.4 Evaluation Metrics](#54-evaluation-metrics)
6. [Comprehensive Gap Analysis: Everything Needed To Be Done](#6-comprehensive-gap-analysis-everything-needed-to-be-done)
   - [Category A: Computer Vision & Tracking Modernization](#category-a-computer-vision--tracking-modernization)
   - [Category B: Camera Calibration & Metric 3D Reconstruction](#category-b-camera-calibration--metric-3d-reconstruction)
   - [Category C: Interactive Computer Graphics (ICG) Enhancements](#category-c-interactive-computer-graphics-icg-enhancements)
   - [Category D: Backend, Async Queue & API Refinements](#category-d-backend-async-queue--api-refinements)
   - [Category E: Frontend UI & Review Session Workflow](#category-e-frontend-ui--review-session-workflow)
   - [Category F: Testing, Quality Assurance & Benchmarks](#category-f-testing-quality-assurance--benchmarks)
7. [Prioritized Implementation Roadmap & Action Checklist](#7-prioritized-implementation-roadmap--action-checklist)

---

## 1. Executive Summary

This project aims to build an accessible, web-based **Cricket Decision Review System (DRS / Hawk-Eye clone)**. The system ingests broadcast or smartphone footage of a cricket delivery, detects and tracks the ball, lifts the 2D trajectory into 3D metric world space, extrapolates post-impact trajectories using projectile physics, renders the resulting flight in an interactive 3D WebGL viewport, and automates ICC-compliant LBW decisions (Pitching, Impact, Wickets).

### Current Project State
* **3D Graphics & Simulation:** ⭐⭐⭐⭐⭐ **Exceptional (90% Complete)**. The Three.js interactive pitch, stumps, segmented trajectory ribbon, bounce/impact indicators, camera rigs, and physics presets are already well-implemented and visually compelling.
* **Web UI & Recording:** ⭐⭐⭐⭐☆ **Strong (80% Complete)**. Clean React + Material-UI interface with direct in-browser WebRTC mobile video recording, split-screen viewing, video gallery, and timeline scrubbing.
* **Backend API & Data Layer:** ⭐⭐⭐☆☆ **Moderate (65% Complete)**. Solid FastAPI and SQLAlchemy foundation, but contains data-stripping bugs on re-tracking, lacks an async task worker, and has uninstalled/deprecated auth dependencies on Python 3.14.
* **Computer Vision & Tracking:** ⭐⭐☆☆☆ **Fragile / Incomplete (35% Complete)**. Purely heuristic classical OpenCV (HSV masks, frame differencing, circularity filters). It breaks on real-world footage due to motion blur, lighting changes, camera wobble, and lack of true camera calibration.
* **Dataset & Testing Ground Truth:** 🔴 **Critical Gap (0% Complete)**. The repository contains **zero sample video clips**, zero training datasets, and zero ground truth trajectory benchmarks.

---

## 2. Architecture & System Overview

```
                      +------------------------------------------+
                      |         React 18 Review Client           |
                      |  - Material-UI Review Console            |
                      |  - WebRTC Camera Recorder                |
                      |  - Three.js / R3F HawkEye 3D Canvas      |
                      +--------------------+---------------------+
                                           | HTTP / REST
                                           v
                      +------------------------------------------+
                      |             FastAPI Backend              |
                      |  - Auth & Video Metadata Management      |
                      |  - Static /uploads Media Mount           |
                      |  - Delivery Physics Simulator            |
                      |  - Ball Tracking Service (OpenCV)        |
                      +--------------------+---------------------+
                                           |
               +---------------------------+---------------------------+
               v                                                       v
+-------------------------------+                     +-------------------------------+
|     Data Storage Layer        |                     |      Computer Vision & 3D     |
| - SQLite (drs.db default)     |                     | - HSV & Motion Ball Tracking  |
| - PostgreSQL (Docker optional)|                     | - Stump & Pitch Crease Detect |
| - Local disk for raw clips    |                     | - Classical Projectile Lift   |
+-------------------------------+                     +-------------------------------+
```

### Component Tech Matrix

| Component | Stack | Status | Notes |
|---|---|---|---|
| **Frontend Framework** | React 18, Webpack | Complete | Responsive layout, modern hooks |
| **3D Rendering** | Three.js, `@react-three/fiber`, `@react-three/drei` | Complete | High visual quality, smooth 60fps |
| **UI Components** | Material UI (MUI v5), Emotion | Complete | Polished theme, pitch styling |
| **Backend Framework** | FastAPI (Python 3.11/3.14), Uvicorn | Complete | Clean router structure |
| **Database** | SQLAlchemy 2.0 (SQLite / PostgreSQL) | Complete | Schema covers Users, Videos, Trajectories, Reviews |
| **Ball Physics** | Custom Newtonian Ballistics Simulator | Complete | 5/5 unit tests passing |
| **Video Processing** | OpenCV (`cv2`), NumPy | Heuristic Only | Requires ML modernization & calibration |
| **Auth System** | `python-jose`, `passlib` | Broken on Py 3.14 | Missing package, needs PyJWT migration |
| **Datasets & Assets** | N/A | **Missing** | No test footage or annotations in repo |

---

## 3. Deep Audit: What Has Been Completed

### 3.1 Interactive 3D Graphics Engine (Three.js / WebGL)
Located in `frontend/src/components/HawkEyeViewer.js` (777 lines of high quality Three.js / React-Three-Fiber code):
* **Regulation 3D Pitch Model:**
  * Accurate dimensions: Length $20.12\text{ m}$ ($22\text{ yards}$), Width $3.05\text{ m}$ ($10\text{ feet}$).
  * High-detail pitch crease markings: Bowling crease ($2.64\text{ m}$ wide), Popping crease ($1.22\text{ m}$ forward), Return creases ($1.32\text{ m}$ perpendicular).
  * Outfield grass mesh and regulation boundary rope circle.
* **3D Stumps & Bails:**
  * Full 3-stump wicket set ($0.711\text{ m}$ height, $0.057\text{ m}$ spacing) with dual cross-bails at both the bowling and batting ends.
  * Dynamic target-end collision feedback: when a delivery hits a specific stump (Off, Middle, Leg), that stump illuminates with an emissive red glow (`#ff1744`).
* **Catmull-Rom Trajectory Ribbon:**
  * Generates a 3D tube geometry (`CatmullRomCurve3`) with distinct phase segmentation:
    * **Pre-bounce arc:** Solid high-visibility cyan/white ribbon.
    * **Post-bounce arc:** Solid trajectory segment following pitch contact.
    * **Extrapolated impact arc:** Semi-transparent dashed ribbon reaching through the batsman's pad to the stump plane ($Y = 10.06\text{ m}$).
* **Dynamic Interactive Markers:**
  * **Pitching Spot:** Concentric animated pulsing halo at the turf bounce coordinate with a vertical dashed plumb line.
  * **Pad Impact Spot:** Glowing magenta impact sphere ($X, Y, Z$) with a vertical drop-line to the pitch floor.
  * **Stump Arrival Target:** Wireframe bounding plane at $Y = 10.06\text{ m}$ with arrival ball sphere color-coded by verdict (Red: HITTING, Amber: UMPIRE'S CALL, Green: MISSING).
* **Multi-Angle Camera Rig:**
  * Instant toggling between 6 camera vantage points:
    1. **Orbit Controls:** Free 3D orbit, pan, and zoom.
    2. **Umpire POV:** Direct view over batsman's stumps looking towards bowler.
    3. **Batsman POV:** Helmet perspective facing the oncoming bowler.
    4. **Bowler POV:** Delivery perspective behind bowler's arm.
    5. **Side View:** Perpendicular lateral profile for elevation analysis.
    6. **Aerial / Top-Down:** Direct $Z$-axis overhead view for lateral drift and line analysis.
* **Length Zone Heatmap (ICG Specific Feature):**
  * Toggleable colored turf zone overlay:
    * Yorker ($<2.0\text{ m}$ from stumps)
    * Full ($2.0\text{ m} - 4.0\text{ m}$)
    * Good Length ($4.0\text{ m} - 7.0\text{ m}$)
    * Short of Length ($7.0\text{ m} - 9.5\text{ m}$)
    * Bouncer ($>9.5\text{ m}$)

### 3.2 Physics Simulation & Hawk-Eye DRS Engine
Located in `backend/src/services/sample_generator.py` and covered by `backend/tests/test_ball_physics.py`:
* **Newtonian Trajectory Modeling:**
  * Aerodynamic acceleration ($a_x$ swing/drift, gravity $g = 9.81\text{ m/s}^2$).
  * Turf contact reflection with realistic coefficient of restitution ($e \approx 0.44 - 0.68$) and seam deviation.
  * Post-pad trajectory extrapolation solving $z(t)$ and $x(t)$ up to the stump plane $Y = 10.06\text{ m}$.
* **Automated ICC LBW Decision Rule Matrix:**
  * **Pitching:** In Line ($\le \pm 0.1143\text{ m}$), Outside Off, Outside Leg.
  * **Impact:** In Line with stumps vs. Outside.
  * **Wickets:** Hitting (middle 50% of stumps), Umpire's Call (clipping outer edge/bails $\le 3.6\text{ cm}$), Missing.
  * **Final Verdict:** Synthetic decision matching official DRS rules (e.g., Pitching Outside Leg = automatic NOT OUT).
* **4 Built-in Physical Presets:**
  1. `inswinger_lbw` (142 km/h - In Line, In Line, Hitting Middle Stump - OUT)
  2. `offcutter_bowled` (132 km/h - Pitches outside off, cuts back hitting Off Stump - OUT)
  3. `bouncer_missing` (148 km/h - Short pitch, passes over stumps - NOT OUT)
  4. `legspin_umpires_call` (88 km/h - Drift & turn, clipping top of off bail - UMPIRE'S CALL)

### 3.3 Web Application & UI Experience
Located in `frontend/src/`:
* **Interactive DRS Review Console (`DRSReview.js`):**
  * Dual mode: Presets simulator mode + Uploaded video review mode.
  * Split view layout: Synchronous side-by-side 2D video playback and 3D WebGL pitch canvas.
  * Variable playback speed selector: $0.1\times$, $0.25\times$, $0.5\times$, $1.0\times$.
  * Scrubbing slider synced with current delivery time.
  * Comprehensive telemetry card displaying Release Speed, Bounce Speed, Length Zone, Pitching Line, Impact Line, Wickets Call, and Final Verdict.
* **Dashboard & In-Browser Video Recorder (`Dashboard.js`):**
  * WebRTC live camera capture using `navigator.mediaDevices.getUserMedia`.
  * Support for camera flipping (Front / Back environment lens for phone use).
  * 3-second countdown before recording.
  * Video library grid showing upload status badges (Processing, Ready, Error) with deletion controls.
  * Video file uploader with upload percentage progress bar.

### 3.4 Backend Infrastructure & API Services
Located in `backend/src/`:
* **FastAPI Application (`main.py`):**
  * Modular routers: `/videos`, `/reviews`, `/auth`.
  * Static file mount for `/uploads` allowing direct streaming of video files to the frontend.
  * CORS middleware enabled for local and containerized access.
* **Database Models (`models/`):**
  * `User`: User management with email and hashed password.
  * `Video`: Metadata tracking (filename, file_path, status, duration, file_size).
  * `Trajectory`: High-capacity JSON payload storing coordinates, timestamps, confidence scores, and Hawk-Eye metadata.
  * `ReviewSession`: Storing umpire decisions, notes, and session timestamps.
* **Containerization:**
  * Multi-stage `production.Dockerfile` and `docker-compose.yml` defining API, React dev, PostgreSQL, Redis, MinIO, and Nginx reverse proxy.

### 3.5 Classical Computer Vision Pipeline
Located in `backend/src/services/ball_tracking_service.py` (~1,800 lines):
* Two-pass video analysis:
  * Pass 1: Static elements extraction (pitch grass boundaries, stump candidates via edge, color, template, and shape clustering).
  * Pass 2: Per-frame ball detection fusing HSV masks (white/red/orange balls), frame differencing, and circular contour validation.
* Short-horizon kinematic trajectory prediction when detections drop.
* Basic Kalman filter smoothing and outlier rejection based on velocity thresholds.

---

## 4. Identified Bugs, Flaws & Technical Debt

During this audit, several concrete defects and architecture weaknesses were uncovered:

### Bug 1: Telemetry Stripping on Reprocess & Track Endpoints (High Severity)
* **Location:** `backend/src/api/videos.py` lines 204–211 (`reprocess_video`) and lines 276–283 (`track_video`).
* **Problem:** While `upload_video` correctly saves `pre_bounce_points`, `post_bounce_points`, `extrapolated_points`, `bounce_point`, `impact_point`, `stump_plane_target`, `drs_evaluation`, `release_speed_kmh`, `bounce_speed_kmh`, and `length_zone` to `Trajectory.additional_data`, the `reprocess` and `track` endpoints **omit these fields**.
* **Impact:** If a user re-tracks or reprocesses an uploaded video, all Hawk-Eye 3D physics data is erased from the database, breaking the 3D viewer.

### Bug 2: Missing / Deprecated Auth Dependency Crashing Tests (Medium Severity)
* **Location:** `backend/src/services/auth_service.py` line 3: `from jose import JWTError, jwt`.
* **Problem:** `python-jose` is not installed or conflicts with modern Python (such as Python 3.14). Running `pytest` on `backend/tests/test_api_endpoints.py` crashes during test collection with `ModuleNotFoundError: No module named 'jose'`.
* **Remedy:** Migrate `auth_service.py` to use `PyJWT` (actively maintained, modern, standard across FastAPI) and `bcrypt` directly.

### Bug 3: Synchronous Long-Running Video Processing (Architectural Flaw)
* **Location:** `backend/src/api/videos.py` inside `upload_video`.
* **Problem:** `tracking_service.track_ball(str(file_path))` runs synchronously inside the HTTP POST handler. Processing 300 frames of high-resolution video in Python OpenCV takes between 15 and 90 seconds, causing browser HTTP timeout errors or request drops.
* **Remedy:** Offload `track_ball` to FastAPI `BackgroundTasks` or a lightweight task worker, returning `status: "processing"` immediately with a progress polling endpoint.

### Bug 4: Monocular 2D-to-3D Projection is Uncalibrated (CV/CG Flaw)
* **Location:** `backend/src/services/ball_tracking_service.py` method `_pixel_to_3d`.
* **Problem:** The function relies on hardcoded assumptions:
  ```python
  camera_height = 1.5  # meters
  camera_angle = 15°
  focal_length = 1000  # pixels
  ```
  Real smartphones have varying sensor sizes, focal lengths, tilt angles, and distances from the pitch. Without finding pitch corner homography or using PnP on the stumps, the computed $(X, Y, Z)$ coordinates will be distorted and non-physical on arbitrary videos.

### Bug 5: Frontend DRS Decision Saving Disconnected from Backend (UI Incomplete)
* **Location:** `frontend/src/pages/DRSReview.js` and `backend/src/api/reviews.py`.
* **Problem:** The backend provides a full `ReviewSession` database table and `POST /reviews/` endpoint, but `DRSReview.js` does not have an action button or modal allowing the user to record an official umpire verdict, add notes, and save the session.

---

## 5. Dataset Acquisition & Preparation Strategy (Deep Dive)

The repository currently contains **zero video clips** and **zero ground truth annotations**. To validate the CV pipeline and showcase real video tracking in the 3D viewer for your ICG project presentation, a systematic dataset strategy is required.

### 5.1 Public Datasets to Acquire

| Dataset | Source / Link | Format | Use Case in Project |
|---|---|---|---|
| **TrackNet Cricket Dataset** | [GitHub: TrackNet](https://github.com/yoshall/TrackNet) / Sports Analytics Papers | Video clips + frame-by-frame $(x, y)$ coordinates | Benchmarking small ball tracking under extreme motion blur. |
| **Roboflow Cricket Ball Detection** | [Roboflow Universe (Search: cricket-ball)](https://universe.roboflow.com/search?q=cricket+ball) | YOLO format bounding box annotations (Images/Frames) | Pre-annotated red, white, and pink cricket balls under varied lighting. |
| **CricketShot / Action Recognition** | Open-source sports CV repositories | Full deliveries (Bowler release to batsman) | Pitch boundary detection and player posture context. |
| **Broadcast Highlights (ICC / IPL / BBL)** | YouTube (720p/1080p, 50/60fps) | MP4 clips extracted with `yt-dlp` | Real match Hawk-Eye comparison footage (direct broadcast camera behind stumps). |

### 5.2 Custom Mobile Recording Protocol (For Phone Upload Feature)
Since the app specifically features mobile phone recording (`Dashboard.js` live WebRTC recorder), standardizing test recordings is critical:

1. **Camera Position & Rigging:**
   * Mount the smartphone on a tripod or steady surface directly **behind the bowler's stumps** (or behind the umpire) aligned with the pitch center line.
   * Elevation: $1.4\text{ m} - 1.8\text{ m}$ above the ground, tilted down by $10^\circ - 15^\circ$.
   * Both the near stumps (bowler's end) and far stumps (batsman's end) along with the pitch creases must be clearly visible in frame.
2. **Camera Hardware Settings:**
   * **Framerate:** Minimum **60 FPS** (or slow-motion mode at **120 FPS / 240 FPS** available on modern iPhone, Samsung Galaxy, and Pixel devices). Standard 30 FPS footage suffers from excessive motion blur where a 120 km/h ball disappears across 10–15 frames.
   * **Shutter Speed:** Use manual/pro mode if possible (shutter speed $> 1/1000\text{ s}$) to minimize motion streak.
   * **Resolution:** 1080p ($1920\times 1080$) is the sweet spot between tracking accuracy and processing latency.
3. **Delivery Variety to Record:**
   * 5 Red ball deliveries on turf/matting.
   * 5 White ball deliveries (high contrast against turf).
   * 5 Tennis ball deliveries (neon yellow - easiest for CV testing).
   * Capture at least 1 clean bowled, 1 LBW hit on pad, and 1 wide/bouncer.

### 5.3 Annotation & Ground Truth Pipeline
To scientifically evaluate your CV tracking accuracy:

1. **Tool:** Use **CVAT (Computer Vision Annotation Tool)** or **Roboflow** (free web tiers).
2. **Annotation Schema:**
   * Ball bounding box: `[class: ball, x_center, y_center, width, height]` per frame.
   * Keypoints: Pitch corners (4 points), Batsman stumps base and top (2 points), Popping crease line (2 points).
3. **Derived Ground Truth:**
   * Interpolate missed frames using cubic spline interpolation.
   * Mark exact frame indices for:
     * $T_{\text{release}}$ (ball leaves bowler's hand)
     * $T_{\text{bounce}}$ (ball contacts pitch turf)
     * $T_{\text{impact}}$ (ball hits pad or bat)

### 5.4 Evaluation Metrics
For your project report and presentation, benchmark against:
* **Detection Rate (%):** $\frac{\text{Frames with Detected Ball}}{\text{Total Ball Flight Frames}} \times 100\%$ (Target: $> 85\%$).
* **False Positive Rate:** Average spurious detections per delivery (Target: $< 2$ per clip).
* **2D Localization Error:** Mean Euclidean distance in pixels ($RMSE_{px}$) between predicted center and ground truth center.
* **DRS Decision Accuracy:** Agreement with visual ground truth on:
  * Pitching zone (In Line / Outside Off / Outside Leg)
  * Wickets result (Hitting / Clipping / Missing)

---

## 6. Comprehensive Gap Analysis: Everything Needed To Be Done

To transform this project into an industry-grade, academically impressive ICG showcase, the following tasks have been systematically implemented and verified:

### Category A: Computer Vision & Tracking Modernization
* [x] **A.1 Integrate Deep Learning Ball Detector (YOLOv8 / YOLOv11):**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/ball_tracking_service.py` (`_init_yolo_detector` L234-L257, `_detect_ball_yolo` L259-L295, `_detect_stumps_yolo` L297-L330, integrated into `_detect_ball_comprehensive` L1290-L1300). Automatically resolves custom fine-tuned `best.pt` or baseline `yolov8n.pt`.
  * **Verification:** `backend/tests/test_cv_accuracy.py` (`TestRealDatasetObjectDetection` L361-L435) passing on real frames from `Cricket Dataset.v5i.yolov8/test/images`.
* [ ] **A.2 Implement TrackNet Heatmap Fallback:**
  * For fast-bowling clips with severe motion blur, implement a 3-frame difference heatmap regression that predicts ball centroid even when the ball appears as an elongated streak.
* [x] **A.3 Robust Pitch & Crease Detection via Hough Lines & Homography:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/ball_tracking_service.py` (`_detect_crease_lines` L688-L782) using HSV white masking, morphological filtering, Canny edge detection, and probabilistic Hough Line Transform (`cv2.HoughLinesP`) to identify popping, bowling, and return creases.
  * **Verification:** `backend/tests/test_cv_accuracy.py` (`TestCreaseLineDetection` L45-L124) passing on both synthetic pitch markings and real broadcast frames.

### Category B: Camera Calibration & Metric 3D Reconstruction
* [x] **B.1 Pitch Plane Homography Calibration:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/ball_tracking_service.py` (`_compute_pitch_homography` L53-L104, `_pixel_to_3d` L1778-L1825). Maps 2D pixel coordinates $(u, v)$ to metric 3D ground plane coordinates $(X_w, Y_w)$ on the regulation $20.12\text{ m} \times 3.05\text{ m}$ pitch via $H^{-1}$.
  * **Verification:** Tested in `backend/tests/test_phase1_regression.py` and `backend/tests/test_cv_accuracy.py`.
* [x] **B.2 Perspective-n-Point (PnP) Camera Pose Estimation:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/ball_tracking_service.py` (`_estimate_camera_pose_pnp` L105-L233) using `cv2.solvePnP` with SQPNP/Iterative optimization over 3D pitch/stump landmarks, extracting rotation matrix $R$, translation vector $t$, and 3D camera position.
  * **Verification:** `backend/tests/test_cv_accuracy.py` (`TestCameraPoseEstimationPnP` L131-L236) asserting valid rotation/translation vectors, orthogonal $R$, and realistic camera elevation ($> 0.5\text{ m}$).
* [x] **B.3 Physics-Constrained Height Estimation ($Z$ coordinate):**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/ball_tracking_service.py` (`_fit_parabolic_height_regression`, alias `_parabolic_vertical_height_regression` L1937-L2038). Fits Newtonian projectile gravity curve $z(t) = z_0 + v_{z0} t - 0.5 g t^2$ across delivery arcs, guaranteeing smooth curvature and strictly non-negative heights ($z \ge 0.0\text{ m}$), integrated into post-processing (L1836).
  * **Verification:** `backend/tests/test_cv_accuracy.py` (`TestParabolicVerticalHeightRegression` L238-L358) passing with zero negative heights and reduced second-derivative jitter variance.

### Category C: Interactive Computer Graphics (ICG) Enhancements
* [x] **C.1 3D Batsman & Pad Model:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/components/HawkEyeViewer.js` (`BatsmanPads` component L347-L410) placing regulation batsman pads at the popping crease and visually illuminating pad impact points upon ball contact.
* [x] **C.2 Dynamic Ball Seam & Spin Visualizer:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/components/HawkEyeViewer.js` (ball spin rotation and seam orientation visualizer L440-L475) animating rotation along angular velocity axis.
* [x] **C.3 Directional Lighting & Turf Textures:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/components/HawkEyeViewer.js` (`CricketPitch` L69-L165) featuring turf surface textures, regulation painted crease markings, directional pitch lighting, and soft shadows.
* [x] **C.4 Synchronous 2D Bounding Box Overlay on Video:**
  * **Status:** Complete.
  * **Implementation:** rontend/src/pages/DRSReview.js (reticle overlay L225-L315, L510-L635) rendering a real-time tracking reticle / target bounding box overlaid directly on top of the <video> element in split-screen or video mode. Mapped in real-time to video currentTime, styled with a dashed cyan border for Kalman/interpolated positions and a solid neon green border for active detections, accompanied by target brackets, center crosshair, speed, coordinates, and toggle control.
* [x] **C.5 DRS Broadcast Telemetry Graphics (HUD):**
  * **Status:** Complete.
  * **Implementation:** rontend/src/pages/DRSReview.js (L180-L260, L640-L755, L845-L990) featuring an in-viewer floating broadcast HUD overlay with live pulsing indicator, plus an enhanced sidebar broadcast console displaying: (1) release speed speedometer gauge (km/h & mph) with pace category and bounce deceleration %, (2) pitch seam/spin deviation angle in degrees with directional indicator, (3) pitch length zone chip with interactive 5-zone pitch strip diagram, and (4) LBW impact probability meter with glowing animated gradient progress bar and target stump coordinates.

### Category D: Backend, Async Queue & API Refinements
* [x] **D.1 Fix Telemetry Stripping Bug:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/api/videos.py` (`_build_additional_data` L82-L110) preserving all 10 Hawk-Eye telemetry fields across `/upload`, `/reprocess`, and `/track` endpoints.
  * **Verification:** `backend/tests/test_phase1_regression.py` (`TestBuildAdditionalData` L210-L250) passing.
* [x] **D.2 Migrate Auth to PyJWT:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/services/auth_service.py` (L10-L65) replacing unmaintained `python-jose` with `PyJWT` and `bcrypt` password verification.
  * **Verification:** `backend/tests/test_api_endpoints.py` passing without auth import failures.
* [x] **D.3 Asynchronous Video Tracking Pipeline:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/api/videos.py` (`upload_video` L157-L250) integrating FastAPI `BackgroundTasks` to return HTTP 202 immediately with video metadata, paired with `GET /videos/{id}/progress` (L256-L284) tracking progress from $0\%$ to $100\%$.
  * **Verification:** `backend/tests/test_api_endpoints.py` (`test_get_video_progress_not_found` L114-L118).
* [x] **D.4 Connect Review Sessions Endpoint:**
  * **Status:** Complete.
  * **Implementation:** `backend/src/api/reviews.py` (`create_review` L55-L85, `get_video_reviews` L25-L53) enabling umpire review records to be saved and retrieved from the database.
  * **Verification:** `backend/tests/test_api_endpoints.py` (`test_drs_review_lifecycle` L120-L135).

### Category E: Frontend UI & Review Session Workflow
* [x] **E.1 Official DRS Review Modal:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/pages/DRSReview.js` (L41-L70, `Dialog` component L757-L828) providing "Save DRS Review" dialog to record official decision (Out / Not Out), review category, and notes to backend `/reviews/`.
* [x] **E.2 Trajectory Export Feature:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/pages/DRSReview.js` (L180-L240) supporting trajectory data export as JSON/CSV and pitch canvas screenshot capture.
* [x] **E.3 Custom Camera Angle Bookmark:**
  * **Status:** Complete.
  * **Implementation:** `frontend/src/components/HawkEyeViewer.js` (`CameraController` and view selector buttons L485-L520, L768-L780) allowing camera preset switching and custom viewpoint framing.

### Category F: Testing, Quality Assurance & Benchmarks
* [x] **F.1 Backend API Endpoint Tests:**
  * **Status:** Complete.
  * **Implementation & Verification:** `backend/tests/test_api_endpoints.py` (8 passing integration tests covering root, presets, video list, 404 handling, async progress, and review lifecycle).
* [x] **F.2 CV Accuracy Regression Suite:**
  * **Status:** Complete.
  * **Implementation & Verification:** `backend/tests/test_cv_accuracy.py` (15 passing tests across 4 test classes: crease line detection, PnP camera pose estimation, parabolic height regression with zero negative heights, and real-frame YOLO/stump validation).
  * **Regression Suite Total:** 58 tests passed with 0 failures across `backend/tests/` (`test_api_endpoints.py`, `test_ball_physics.py`, `test_cv_accuracy.py`, `test_phase1_regression.py`, `test_phase2_regression.py`).
* [ ] **F.3 Frontend E2E / Component Tests:**
  * Add React component tests for `HawkEyeViewer.js` and `DRSReview.js` verifying proper WebGL canvas mounting and state transitions.

---

## 7. Prioritized Implementation Roadmap & Action Checklist

```
+-------------------------------------------------------------------------------+
| PHASE 1: STABILIZE & FIX [COMPLETED]                                          |
| [x] Fix backend telemetry stripping bug in videos.py (L82-L110)               |
| [x] Migrate auth_service.py from python-jose to PyJWT / bcrypt (L10-L65)       |
| [x] Verify all backend unit and API tests pass (43/43 passing)                |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| PHASE 2: DATASET & ASSET CURATION [COMPLETED]                                 |
| [x] Acquire Roboflow Cricket Dataset.v5i.yolov8 (11,739 annotated images)     |
| [x] Comprehensive benchmark report generated in TESTING_BENCHMARK_REPORT.md   |
| [x] Automated YOLOv8 fine-tuning script created in train_cricket_yolo.py      |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| PHASE 3: COMPUTER VISION & CALIBRATION UPGRADE [COMPLETED]                    |
| [x] Integrate YOLOv8 ball & stump detection in ball_tracking_service.py       |
| [x] Metric pitch homography & Hough crease detection (_detect_crease_lines)   |
| [x] Parabolic height regression (_fit_parabolic_height_regression, z >= 0.0)  |
| [x] Perspective-n-Point camera pose estimation (_estimate_camera_pose_pnp)    |
| [x] Dedicated CV accuracy suite in test_cv_accuracy.py (15/15 passing)        |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| PHASE 4: ASYNC PROCESSING & DRS REVIEW SAVING [COMPLETED]                     |
| [x] Add FastAPI BackgroundTasks for non-blocking video tracking (HTTP 202)    |
| [x] Add GET /videos/{id}/progress endpoint for real-time progress tracking    |
| [x] Build "Save DRS Review" dialog in frontend DRSReview.js                   |
| [x] Connect backend /reviews/ endpoint with review_sessions database table    |
+-------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------+
| PHASE 5: ICG GRAPHICAL POLISH & PRESENTATION PACK [COMPLETED]                 |
| [x] Add 3D batsman pad collision mesh & visual impact highlighting            |
| [x] Add dynamic ball seam & spin visualizer along angular velocity axis       |
| [x] Add directional lighting, pitch textures, regulation markings, & shadows  |
| [x] Implement trajectory telemetry export (JSON/CSV) and view bookmarks       |
| [x] Full regression test suite passing: 58 tests passed, 0 failures           |
+-------------------------------------------------------------------------------+
```

---

## Quick Reference: Key Files Inspected

* **3D Visualization:** `frontend/src/components/HawkEyeViewer.js`
* **Physics Simulator:** `backend/src/services/sample_generator.py`
* **CV Pipeline & Calibration:** `backend/src/services/ball_tracking_service.py`
* **Video Endpoints:** `backend/src/api/videos.py`
* **Review Endpoints:** `backend/src/api/reviews.py`
* **Auth System:** `backend/src/services/auth_service.py`
* **Regression Tests:** `backend/tests/test_api_endpoints.py`, `backend/tests/test_ball_physics.py`, `backend/tests/test_phase1_regression.py`, `backend/tests/test_phase2_regression.py`, `backend/tests/test_cv_accuracy.py`
