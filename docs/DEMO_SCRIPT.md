# Live Demonstration Script: Cricket DRS & 3D Hawk-Eye

This five-minute script walks through the system for an evaluation or viva presentation.

---

## 1. Introduction (0:00 – 0:45)
- **Goal**: Present a paired Computer Vision tracking pipeline and an interactive 3D Decision Review System (DRS) renderer.
- **Key Duality**:
  - *Simulation Engine*: Demonstrates full aerodynamic physics, camera transformations, and DRS boundary geometry.
  - *Video CV Pipeline*: Real OpenCV detection on uploaded/recorded footage, honestly reporting measured vs predicted points.
- **State Clearly**: *"We don't claim broadcast commercial Hawkeye accuracy with a single uncalibrated consumer camera. We demonstrate the underlying CV and graphics algorithms."*

---

## 2. Interactive 3D Simulator (0:45 – 2:00)
1. From the Dashboard, click **Launch Interactive 3D Simulator**.
2. Select **Fast Inswinger – LBW Out (142 km/h)**:
   - Notice the green **SIMULATION** chip in the Ball Telemetry sidebar.
   - Show the 3 distinct trajectory ribbons:
     - **Cyan Ribbon**: Pre-bounce incoming delivery arc.
     - **Amber Ribbon**: Post-bounce deviation arc.
     - **Magenta Dashed Ribbon**: Extrapolated path through the pad impact towards the stumps.
   - Show the **Pulsing Pitching Spot Marker** where the ball bounces on the pitch.
   - Show the **Stump Target Plane**: Visualizing where the ball center passes through the wicket volume.
3. Switch camera perspectives using the bottom controls:
   - **Batsman POV**: View the ball swinging inwards toward the right-hander's pads.
   - **Umpire POV**: View the line from the bowler's end towards the batting crease.
   - **Chase Cam**: Smooth camera following the delivery trajectory down the pitch.
4. Show decision readout: **OUT** (`Pitching: IN LINE`, `Impact: IN LINE`, `Wickets: HITTING`).
5. Switch to **Sharp Bouncer – Missing Stumps (148 km/h)**:
   - Point out the higher bounce trajectory clearing the stump height ($0.711\text{ m}$).
   - Decision updates to **NOT OUT** (`Wickets: MISSING`).

---

## 3. Video CV Pipeline & Upload Flow (2:00 – 3:30)
1. Return to Dashboard via **Back to Dashboard**.
2. Show the video list:
   - Point out the **Refresh/Reprocess button** on existing video cards.
   - Point out the capture instruction note: stationary camera, good ball-to-background contrast, max 300 frames.
3. Select an existing processed video or upload a short bowling clip:
   - Watch the upload progress and in-flight tracking processing.
4. In the **Split View**:
   - The synchronized 2D video appears on the left with an **interactive SVG Ball Tracking Overlay** (showing real-time detected crosshairs, confidence scores, and Kalman predictions).
   - Show the **Observable CV Diagnostics panel** below the video:
     - Frames analyzed and measured vs predicted point breakdown.
     - Pitch and stumps boundary detection source (`detected` vs `assumed`).
     - Video metadata (source FPS, dimensions, frame count).
     - "Show Tracking Overlay" toggle to inspect raw footage vs CV tracking annotations.
   - Drag the timeline scrubber to view simultaneous frame progression and 3D ball location.
   - Point out the amber **ILLUSTRATIVE** chip in the Ball Telemetry sidebar.
   - Highlight: *"Speed from single-camera video is an uncalibrated estimate, so we report illustrative pixel velocity without fabricating metric certitude."*

---

## 4. Code & Algorithmic Highlights (3:30 – 4:30)
- **Pixel-Space Gating**: Show `ball_tracking_service.py` lines where candidate distance and velocity gating are performed in 2D image pixel space before lifting to 3D.
- **dt-Coupled Kalman Filter**: Show the variable-$\Delta t$ transition matrix in `_apply_kalman_filter` that preserves point metadata (`is_predicted`, `pixel_x`, `pixel_y`, `frame_idx`).
- **Resilience & Fallback**: Show `WebGLErrorBoundary` in `HawkEyeViewer.js` protecting the UI from Canvas context failures.
- **Transactional Reprocessing**: Show how the backend executes replacement in a single atomic transaction and rolls back to preserve existing trajectories if tracking or persistence fails.
- **Access Boundary & Secure Media Streaming**: Show that `GET /videos/{id}/stream` enforces user ownership (supporting both Bearer tokens and `?token=` query parameters for standard HTML5 `<video>` tags), preventing unauthorized access to private clips.

---

## 5. Evaluation Harness & Metrics (4:30 – 5:00)
1. Open terminal:
   ```bash
   cd backend
   .venv\Scripts\python.exe scripts/evaluate_tracking.py --demo
   ```
2. Display the printed benchmark report:
   - **Section 1: Raw CV Detector Performance**: Evaluates strictly measured detections against ground-truth frames (Precision, Recall, F1, RMSE).
   - **Section 2: Tracking Continuity & Gap Filling**: Evaluates combined pipeline performance (Gap filling fraction, max consecutive predictions, combined track recall).
   - Run evaluation on sample clip annotations:
     ```bash
     .venv\Scripts\python.exe scripts/evaluate_tracking.py --ground-truth scripts/data/sample_ground_truth.csv --tracking-result scripts/data/sample_tracking_result.json
     ```
3. Conclude:
   ```bash
   .venv\Scripts\python.exe -m pytest tests/ -v
   ```
   - Show all **48 passed regression, security, and integration tests**.
