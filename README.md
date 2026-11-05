# Cricket Ball Tracking — CV + 3D Graphics Demo

A computer vision and interactive 3D graphics course project demonstrating:

- **OpenCV ball detection** — HSV colour masks, motion differencing, contour scoring
- **Kalman filter smoothing** — constant-velocity model with timestamp-dependent dt coupling  
- **Physics-based trajectory simulation** — parametric swing, seam, bounce and carry
- **Three.js 3D rendering** — interactive Hawk-Eye-style trajectory visualisation
- **FastAPI REST backend** — upload, track, store, retrieve

---

## Quick start (local, SQLite)

```bash
# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
python run_server.py             # → http://localhost:8000

# 2. Frontend (separate terminal)
cd frontend
npm install
npm start                        # → http://localhost:3000
```

Default credentials — register a new account on the auth page.  
Existing database (`backend/drs.db`) and uploads (`../uploads/`) are preserved on restart.

---

## Two modes — clearly labelled

| Mode | Data source | Labels |
|------|-------------|--------|
| **Physics Simulation** | `DeliveryPhysicsSimulator` (parametric) | SIMULATION chip (green) |
| **Video Analysis** | OpenCV CV pipeline on your uploaded clip | ILLUSTRATIVE chip (amber) |

**The simulator is not CV output.** It is used to demonstrate physics, coordinate transforms, 3D rendering and DRS geometry with controlled, reproducible data. Upload a real clip to see the CV pipeline.

---

## Running tests

```bash
cd backend
.venv\Scripts\python.exe -m pytest tests/ -v
# Expected: 23 passed
```

Test files:
- `tests/test_api_endpoints.py` — root, presets, trajectory endpoints
- `tests/test_ball_physics.py` — `DeliveryPhysicsSimulator` verdict/physics checks  
- `tests/test_phase1_regression.py` — Phase 1 audit regression suite (path handling, speed honesty, prediction cap, debug accuracy, config consistency, upload helper)

---

## Architecture summary

```
Frontend (React + MUI + Three.js/@react-three/fiber)
  ├── App.js             Auth, routing, trajectory loading with race-free state
  ├── Dashboard.js       Upload, record, reprocess, simulation entry
  ├── DRSReview.js       Video+3D split view, DRS sidebar, timeline controls
  └── HawkEyeViewer.js   Three.js scene: pitch, stumps, trajectory tube, cameras

Backend (FastAPI + SQLite)
  ├── api/videos.py      Upload (streaming), track, reprocess (transactional), trajectory GET
  ├── api/auth.py        JWT auth
  ├── services/
  │   ├── ball_tracking_service.py   OpenCV pipeline → 3D coords → Kalman → LBW
  │   └── sample_generator.py        DeliveryPhysicsSimulator (4 presets)
  └── config.py          Single source for all geometry constants
```

**Coordinate system:** X = across pitch width, Y = bowler → batter (metres), Z = height above ground (metres). Three.js maps: `[cricket.x, cricket.z, cricket.y]`.

---

## CV pipeline (real video)

1. **First pass** — sample pitch/stump frames, detect boundaries (HSV green mask, contours)
2. **Second pass** — per-frame: motion diff + colour candidate detection inside pitch ROI
3. **Temporal gating** — reject candidates that jump too far from predicted position
4. **Kalman smoothing** — constant-velocity model with actual inter-frame dt (not identity)
5. **Gap filling** — predict up to `MAX_PREDICTION_GAP_S = 0.2 s` / 5 consecutive frames
6. **`is_predicted` tagging** — smoothed predicted points vs real measurements are stored separately
7. **LBW analysis** — bounce detection, extrapolation to stump plane, illustrative verdict
8. **debug_info** — `pitch_detected`, `stumps_detected`, `geometry_source`, `predicted_points`, `measured_points` all stored and returned to frontend

**Known CV limitations:**
- `_pixel_to_3d` is a heuristic linear lift — not a calibrated camera projection. Speed, height and 3D position are illustrative estimates for uncalibrated single-camera footage.
- Detection quality depends heavily on footage conditions (lighting, background contrast, camera stability).
- A clear, static-camera shot of one delivery against a contrasting background gives the best results.

---

## Five-minute demo script

### 0 – Intro (30 s)
> "This project demonstrates two things: a real computer vision pipeline that detects and tracks a cricket ball in video, and a 3D graphics system that visualises the trajectory. They're intentionally kept separate so the CV evidence is clear."

### 1 – Simulation mode (90 s)
1. Open the app → **Launch Interactive 3D Simulator**
2. Selector shows "Fast Inswinger – LBW Out (142 km/h)" — explain it's a physics simulation, green SIMULATION chip visible
3. Orbit the scene (drag), zoom in on stumps, switch to Batsman POV camera
4. Show the three DRS boxes: Pitching / Impact / Wickets → decision banner
5. Switch to "Sharp Bouncer – Missing Stumps" — note "NOT OUT" verdict, different trajectory arc
6. > *"These use a parametric physics model — inswing, seam, bounce. Same model as Hawk-Eye's teaching demos. This is what lets us show clean geometry without needing a perfect video."*

### 2 – Upload and CV analysis (90 s)
1. Go back to Dashboard → **Upload Video** → select your test clip
2. Wait for processing bar → "Ready" status appears
3. Click the clip → review view loads; note amber **ILLUSTRATIVE** chip
4. > *"The backend ran OpenCV on that clip: motion differencing, HSV colour masks, contour scoring. The debug_info shows how many frames were detected vs predicted."*
5. Show DRS sidebar — if track succeeded, show the three DRS boxes with "⚠ Illustrative estimate" note; if not detected, show "No trajectory" state
6. Show trajectory in 3D view — cyan dots for detected positions, the tube traces the smoothed path
7. > *"Release speed shown here is an uncalibrated pixel-velocity estimate — we can't claim metric accuracy without camera calibration."*

### 3 – Code walkthrough (60 s)
- Show `_detect_ball_comprehensive` in `ball_tracking_service.py` — HSV mask, motion diff, shape score
- Show `_apply_kalman_filter` — point to the F(dt) transition matrix: "position + velocity × dt"
- Show `debug_info` dict in the trajectory response — "pitch_detected: false means we fell back to assumed geometry"
- Show `_pixel_to_3d` docstring: *"heuristic linear lift — not calibrated camera projection"*

### 4 – Failure case (30 s)
> "If the clip has low contrast or the ball is outside the detected pitch ROI, we get zero detections. The UI shows 'No trajectory data available' — no fabricated fallback path."

### 5 – Results summary (30 s)
| Metric | Value |
|--------|-------|
| Backend tests | 23 / 23 pass |
| Frontend build | 0 errors |
| Simulation presets | 4 (inswinger, off-cutter, bouncer, leg spin) |
| Real-video tracking | Accuracy depends on footage — uncalibrated, single camera |
| Speed claims | Simulation: physics-derived ✓ · Video: pixel-velocity estimate, no calibration ✗ |

---

## What we deliberately do NOT claim

- Certified / officiating DRS accuracy  
- Metric 3D reconstruction from uncalibrated single-camera footage  
- Measured ball speed from real video (shown as illustrative estimate only)  
- Model training or deep learning  

---

## File structure

```
cricket-ball-tracking/
├── backend/
│   ├── src/
│   │   ├── config.py                 ← Single source for all geometry constants
│   │   ├── api/videos.py             ← Upload (streaming), track, reprocess, trajectory
│   │   └── services/
│   │       ├── ball_tracking_service.py  ← Full CV pipeline
│   │       └── sample_generator.py       ← Physics simulator (DO NOT MODIFY)
│   └── tests/
│       ├── test_api_endpoints.py
│       ├── test_ball_physics.py
│       └── test_phase1_regression.py  ← Phase 1 audit regression suite
├── frontend/
│   └── src/
│       ├── App.js                    ← Auth, routing, race-free trajectory loading
│       ├── pages/Dashboard.js        ← Upload, reprocess, simulator entry
│       ├── pages/DRSReview.js        ← Main review UI
│       └── components/HawkEyeViewer.js ← Three.js 3D scene
└── docs/
    └── ICG_AUDIT_AND_IMPROVEMENT_PLAN.md
```
