# ICG project audit and improvement plan

Created: 2026-11-03

## Goal and recommended scope

Turn the existing project into an explainable **Cricket Ball Tracking and Interactive Trajectory Visualization** demonstration for a computer vision and graphics course. Keep React, MUI, Three.js, FastAPI, OpenCV and the current database approach. Improve the existing application; do not rebuild it.

The strongest submission is a visible, measurable CV pipeline paired with an interactive graphics scene. Provide two clearly labelled modes:

1. **Video analysis:** genuine detections from a supported fixed-camera clip, image-space tracking, visible intermediate stages, tracking quality and an explicitly approximate reconstruction where available.
2. **Physics simulation:** the existing generated deliveries, used to explain projectile motion, bounce, cameras, graphics and illustrative wicket intersection.

Simulation is useful graphics work, but it is not evidence of computer vision accuracy. Do not use generated coordinates as a fallback for failed video tracking. Do not claim certified DRS, arbitrary-video support or measured single-camera 3-D accuracy.

Assumptions: a course project, a local laptop demonstration, one fixed camera, short clips containing one delivery, no model training requirement. No deadline or marking rubric was supplied. If a rubric requires deep learning or full metric reconstruction, revisit that specific assumption before expanding scope.

## Audit basis and limits

This is a source audit of the frontend, CV tracker, physics simulator, API, models, tests, configuration, Docker files and existing specifications. No app was launched, no build or tests were run, and no uploaded footage was evaluated. Visual recommendations are based on component/layout code, not a verified live rendering. Findings below distinguish code defects from unmeasured quality.

Existing uncommitted changes were present in `backend/src/services/auth_service.py` and `frontend/package-lock.json`; preserve them. This audit changes documentation only.

## What is worth keeping

- Real OpenCV detection methods already exist: HSV colour masks, motion differencing, contour scoring and circle detection.
- The review UI already supports split views, playback speeds, scrubbing and multiple 3-D cameras.
- The scene already contains a pitch, stumps, trajectory geometry, bounce/impact markers and a chase camera.
- `DeliveryPhysicsSimulator` provides four reproducible scenarios and initial physics/API tests.
- Uploads, persistence and review-session services already exist. The README already acknowledges approximate depth and limited decision logic.

The current project is a useful prototype. Its main weakness is the validity and continuity of data between detection, reconstruction and presentation, rather than a lack of features.

## Concrete audit findings

Priorities: P0 = can block a reproducible demonstration; P1 = damages technical correctness or evidence; P2 = presentation and maintainability.

| Priority | Finding and source | Consequence / required correction |
|---|---|---|
| P0 | `frontend/public/index.html` exists locally, but `git ls-files frontend/public` returns no files; `.gitignore` contains a broad `public` rule. | A fresh checkout lacks the React HTML entry point. Narrow the ignore rule and version essential frontend public files. |
| P0 | `App.js:handleVideoSelect` navigates before its API response. `DRSReview.js` initializes `activeTrajectory` from a prop with `useState` and does not synchronize later prop changes. | Uploaded trajectories can remain blank after loading. Fix loading ownership/prop synchronization without overwriting an intentionally selected preset. Clear stale state when changing clips; expose retryable failures. |
| P0 | `api/videos.py:list_videos` extracts filenames using `file_path.split('/')[-1]`. Upload paths are native Windows paths on this machine. | The returned playback filename can contain an absolute Windows path. Use native path handling and a consistent stored filename/media URL contract. Do not return filesystem paths to clients. |
| P1 | Upload persists all segmented DRS fields, but `/track` and `/reprocess` persist only older metadata in `api/videos.py`. | Reprocessing loses bounce, extrapolation and evaluation fields. Use one shared trajectory-persistence path for all three entry points. Reprocess also reports `ball_trajectory` although the service returns `points`. |
| P1 | `_process_frame` converts detections to world coordinates before temporal gating, while `track_ball` compares their distance against pixel-configured limits. | Tracking thresholds have inconsistent units. Associate/filter detections in pixels first and retain raw image measurements. |
| P1 | `_apply_kalman_filter` creates an identity transition matrix for position/velocity state and never connects position to velocity using elapsed time. | This does not implement the intended constant-velocity predictor. Use timestamp-dependent dynamics and test irregular frame intervals. |
| P1 | `_pixel_to_3d` linearly maps normalized image coordinates to pitch coordinates and invents height from image row. It does not use calibrated camera projection or detected pitch geometry. | The 3-D path is an illustrative lift, not recovered metric geometry. Speed, bounce and wicket conclusions derived from it are not validated measurements. |
| P1 | `_predict_ball_position` can continue recursively with no explicit lost-track limit or measured/predicted tag. Post-processing rebuilds point dictionaries. | Predicted points can be mistaken for observations. Cap gaps by elapsed time and preserve source/frame metadata through smoothing. |
| P1 | `_analyze_lbw_decisions` calls the minimum estimated height a bounce and the final tracked point a pad impact, forces forward velocity positive, clamps speed to 80–160 km/h, and estimates bounce speed as a fixed fraction. | A failed or incomplete track can produce plausible-looking telemetry. Require evidence for events, retain unknowns and remove fabricated/clamped measurements. |
| P1 | Stump/player detection returns default locations on failure; `debug_info.pitch_detected` only checks whether a pitch-info object exists. | Fallback geometry can look like a successful detection. Store/display whether geometry is detected, manual or assumed. |
| P1 | Geometry differs across files: configured pitch length is `22.0`, tracker/simulator/viewer use `20.12`; tracked wicket evaluation uses height `0.74`, while simulator/viewer use `0.711`. | Rendered geometry and analytical geometry disagree. Establish one metric convention and canonical dimensions, with a contract check across frontend/backend. |
| P1 | Video/review endpoints accept optional users but do not consistently enforce ownership; anonymous listing exposes all clips; `/uploads` is a public static mount. | Account boundaries do not protect stored videos. Retain public synthetic demos, require owners for private operations and protected playback. Invalid tokens must not silently become anonymous users. |
| P1 | `/reprocess` deletes the previous trajectory before a new result exists, broadly catches HTTP errors, and lacks the `/track` in-progress guard. Delete commits child removal separately and does not explicitly handle review references. | Failed reprocessing can lose useful results; duplicates/concurrent runs and deletion failures are possible. Replace results transactionally after success, preserve HTTP status codes and handle associated reviews deliberately. |
| P1 | Upload reads the whole file before size enforcement and runs CPU-heavy tracking inline in an async handler. | Large requests consume memory; tracking can block responsiveness. Enforce byte limits during streaming, validate decoding/FPS and move processing off the event loop. |
| P0 if Docker is used | `docker/init.sql` creates a schema incompatible with the ORM: different user/video columns and trajectory layout. `create_all` does not reconcile existing tables. | PostgreSQL startup can succeed while app operations fail. Prefer SQLite for the course demo; repair Docker schema compatibility before advertising that path. Never erase an existing database to conceal the mismatch. |
| P2 | Compose uses JWT/frontend environment names different from `config.py` and `api/client.js`. Redis is required by Compose but unused by application code. | Documented configuration is misleading. Align names and keep unused infrastructure optional. |
| P2 | `TrajectoryTube` accepts `isDashed` but renders a continuous tube with transparency. The review UI defaults missing length to “Good Length.” | Predictions and unknown telemetry are visually misrepresented. Draw actual dashed prediction segments and render unavailable fields as unknown. |
| P1 | Present tests cover generated presets/root endpoints, not actual video tracking, persistence, authorization or delayed frontend data. API tests import the real app and its startup side effects. | Passing current tests cannot establish CV quality. Add focused regression tests and isolate database/uploads in test fixtures. |

Additional concerns to resolve during implementation: video listeners depend only on delivery type even though switching view mode unmounts the video element; uploaded-video playback in 3-D-only mode needs a persistent clock. The dashboard recorder logs camera errors without presenting them, requests audio unnecessarily, and needs countdown/recording cleanup when closed.

## Execution order

### Phase 1 — Make the existing demonstration reliable

**Files:** `.gitignore`, `frontend/public/`, `frontend/src/App.js`, `frontend/src/pages/DRSReview.js`, `frontend/src/api/client.js`, `backend/src/api/videos.py`, existing backend tests and new focused frontend tests.

1. Restore clean-checkout frontend completeness; keep existing assets.
2. Fix delayed trajectory loading, stale selections and visible loading/error/empty states. Avoid races when quickly switching clips or presets.
3. Fix Windows playback filenames and use consistent safe media identifiers.
4. Unify result persistence for upload, track and reprocess; preserve the complete payload and old successful results on failure. Keep one result per video.
5. Standardize processing/error statuses and preserve expected 404/409 responses.
6. Keep one playback clock per mode. For real video, use the video timeline across view changes; use frame callbacks where available with a compatible fallback. Add previous/next-frame controls, time clamping and event seeking. Handle rejected playback promises.

**Acceptance:** A fresh checkout builds; an uploaded clip loads after a delayed API response; reopening/reprocessing retains all fields; Windows filenames resolve; switching video/split/3-D does not freeze or reset playback unexpectedly. Regression tests cover these failures.

### Phase 2 — Make the CV pipeline observable and correct

**Files:** `backend/src/services/ball_tracking_service.py`, `backend/src/config.py`, `backend/src/api/videos.py`, `backend/src/models/trajectory.py` only if necessary, review UI and a small diagnostic-overlay component.

1. Establish one supported capture protocol: stationary camera, visible pitch, suitable contrast, one delivery. Let users select the delivery time interval and a pitch ROI so the first 300 frames do not silently exclude the delivery. Report analyzed interval and truncation.
2. Retain per-frame `frame_index`, timestamp, pixel centre/radius, detector score, measurement/prediction status and missing/rejected state. Store world estimates separately; existing JSON storage can carry this without an unnecessary schema redesign.
3. Perform candidate association and Kalman prediction in image coordinates. Use actual delta-time and consistent pixel units. Handle zero/invalid FPS, corrupt/empty footage and capture cleanup.
4. Use the existing colour/motion/shape candidates inside the ROI. Rank using temporal consistency and appearance. Handle red hue wraparound if red-ball footage is supported. Tune against recorded examples rather than adding more unvalidated detectors.
5. Stop prediction after a documented short gap; require a real measurement to recover. Never feed predicted points back as new measurements. Distinguish occlusion, no detection and rejected candidate.
6. Remove silent successful-looking fallback geometry. Manual calibration is acceptable when labelled; no detection must remain a valid result.
7. Add a synchronized overlay and compact **Explain pipeline** panel showing original frame, selected HSV mask, motion mask, candidates, accepted centre and track. Avoid storing every full-resolution frame: retain compact diagnostics or generate selected-frame previews on demand.

**Acceptance:** The assessor can point to the ball in the original frame and compare raw detection, prediction and smoothed path. A no-ball clip stays “No reliable track.” Synthetic controlled motion tests cover false candidates, short occlusion, a long gap and irregular timestamps. Debug artifacts follow the same access policy as the source clip.

### Phase 3 — Establish honest geometry and event semantics

**Files:** tracker, simulator, config, viewer, trajectory API contract and geometry tests.

1. Define world coordinates: X across pitch, Y bowler to batter, Z height; metres and seconds. Document the Three.js mapping `[x, z, y]`. Consolidate dimensions and remove conflicting constants; preserve an intentional distinction if bail height is ever modelled.
2. Add manual pitch-plane calibration from known ground correspondences, with overlay preview, rejection of degenerate points and a recorded calibration source. A homography maps the pitch plane; applying it to an airborne ball does not recover its true ground position or height.
3. **Core release boundary:** retain 2-D measured tracking and an explicitly labelled illustrative 3-D lift for real clips. Suppress metric speed and confident wicket verdicts where calibration/height/event evidence is insufficient. Physics presets retain simulated telemetry.
4. **Optional extension, only after the core works:** calibrate intrinsics, estimate camera pose from known correspondences, then fit a constrained ballistic model by reprojection. Validate against known trajectories and report residuals/assumptions. Pose calibration alone does not resolve the depth of each airborne ball pixel. Do not expand into stereo hardware or promise arbitrary single-camera 3-D reconstruction.
5. Do not infer pad impact from end-of-track. Permit a labelled manual impact/bounce frame for explanation, or return unknown. Automatic bounce needs temporal evidence, not just a global minimum. Fit separate segments around a verified bounce and avoid smoothing away the discontinuity.
6. Evaluate intersections at the exact stump plane with interpolation, consistent geometry and the ball radius. Label the result “illustrative wicket intersection.” Distinguish clean bowled examples from LBW scenarios. Do not implement full officiating rules for this submission.
7. Add source labels for observations, predictions, manual events, assumed geometry and simulation. Detector scores are heuristic scores, not calibrated probabilities. A geometric edge intersection must not masquerade as statistical uncertainty or official umpire's call.

**Acceptance:** Uncalibrated real footage cannot show fabricated release speed or a confident official-style decision. Known ground points transform consistently; degenerate calibration fails visibly. Geometry tests cover inside/outside/edge wicket intersections, monotonic time and insufficient evidence.

Technical basis: OpenCV documents homography as a planar mapping and pose estimation as requiring image/world correspondences and intrinsics. See [homography explanation](https://docs.opencv.org/4.1.2/d9/dab/tutorial_homography.html), [solvePnP](https://docs.opencv.org/4.12.0/d5/d1f/calib3d_solvePnP.html) and [KalmanFilter](https://docs.opencv.org/4.4.0/dd/d6a/classcv_1_1KalmanFilter.html). The reconstruction boundary above is a project design decision based on the current heuristic implementation.

### Phase 4 — Make the interface presentation-ready

**Files:** `frontend/src/App.js`, `pages/Dashboard.js`, `pages/DRSReview.js`, `components/HawkEyeViewer.js`, `index.css`; reuse MUI and existing icons.

Use one restrained visual system across dashboard and review: dark navy background, neutral surfaces, clear type hierarchy, consistent spacing, cyan observed paths, amber estimates and magenta future extrapolation. Keep labels/patterns in addition to colour. Reduce decorative glow so the evidence is easy to read on a projector.

Desktop composition:

```text
Project name | Video analysis / Simulation | clip | source/calibration status
Original video + detection overlay | Interactive 3-D view | Evidence / explanation
Play | frame step | speed | timeline with verified event markers
Collapsible pipeline stages / tracking-quality summary
```

- Dashboard: make **Analyze clip** and **Explore simulation** separate entry points; real thumbnails, useful duration/status/error details, capture instructions and known-good examples. Allow public synthetic demo entry without mandatory registration; keep private uploads authenticated.
- Review: distinguish loading, processing, no track, approximate geometry and simulation. Show confidence/coverage only with definitions. Display full decision explanations rather than truncating strings.
- Graphics: axis/grid toggle, units, trajectory legend, reset camera, genuine dashed extrapolation, raw/smoothed path toggle and an event inspector with time/source. Share one interpolation convention between ball and trajectory, guard single/empty/duplicate-time inputs, and dispose replaced custom geometries.
- Retain existing camera presets. Prefer a simple clean pitch over stadiums, crowds or new 3-D models. Add no decorative effects until legibility and frame rate are acceptable.
- Responsive layout: stack panels on narrow screens, allow the sidebar to collapse, avoid inaccessible nested scroll areas. Test both a laptop/projector viewport and a phone viewport.
- Add accessible names/tooltips for icon buttons, visible focus and readable contrast. Respect reduced motion for decorative effects. Report recorder errors and clean up camera/countdown resources.

**Acceptance:** A new viewer understands within a few seconds which data is measured and which is simulated. Controls work by keyboard; panels fit at 1366×768 and 390×844. A WebGL failure presents a useful fallback. Playback remains usable on the actual presentation laptop.

### Phase 5 — Add evidence and explanation for the viva

**Deliverables:** a small fixture/annotation set, an evaluation script, results table, architecture/pipeline diagram, updated README, short technical report and demo script.

1. Assemble 6–10 short permission-cleared clips: clear contrasting ball, small/distant ball, white clutter, occlusion, camera movement and no ball. Keep a development subset separate from held-out evaluation clips. Record resolution/FPS/capture conditions; include at least one actual cricket delivery rather than only coloured-ball toys.
2. Manually annotate at least 100 visible-ball frames across several clips and a set of absent/occluded frames. Record centre, radius or bounding box, visibility and reviewer notes; never count interpolated labels as measured ground truth.
3. Define a match criterion before evaluation, tied to annotated ball size with a documented minimum pixel tolerance. Report precision/recall, matched centre error in pixels, measured-frame coverage, predicted-frame fraction, longest lost gap, processing time and effective processing FPS. Use held-out clips for final metrics. Do not report invented accuracy percentages.
4. Compare the existing colour-only baseline with colour+motion+temporal association on the same clips. Report Kalman jitter improvement alongside centre error and failure cases; a smoother wrong path is not a better tracker. Synthetic simulations test physics and graphics, not CV accuracy.
5. Write the explanation around what the team actually implements: HSV segmentation, morphology, contour/circularity scoring, temporal association, Kalman prediction/correction, projective geometry, coordinate transforms, interpolation, scene graph, lighting and perspective cameras. Include equations with units and a concrete frame example.
6. Prepare a five-minute demonstration: problem/scope → labelled real clip and intermediate masks → raw versus smoothed tracking → graphics and camera views → explicitly simulated bounce/wicket example → measured results and a failure case.
7. Update old specifications to distinguish delivered scope from deferred ambitions. The current spec asks for commercial parity, pricing, run-outs and many features outside this course submission; do not treat its checklist as proof of implementation.

**Acceptance:** Every claimed result points to a clip, annotation, generated fixture or test. All team members can explain the full path from pixels to scene coordinates and why arbitrary metric 3-D cannot be claimed from the current single-camera heuristic.

### Phase 6 — Finish reliability, privacy and packaging

**Files:** API/services, `main.py`, test fixtures, `.env.example` files, requirements/lockfile, README and Docker files only where needed.

- Enforce ownership across list/read/track/reprocess/delete/review and media/diagnostic access. Keep generated demo endpoints public. Do not rely on a UUID to authorize private access. Return 401 for invalid tokens and consistent 403/404 for unauthorized resources. Avoid exposing absolute paths or internal exception text.
- Stream uploads with an enforced maximum, generate safe server-side filenames, validate decoded video metadata and clean partial files on failure. Permit only supported extensions/decodable content.
- Use the smallest processing approach: offload CPU work from the event loop; if adopting the UI's async status flow, use one in-process worker with short polling. Treat interrupted jobs as failed after restart and preserve successful results. Do not add Redis/Celery solely for a laptop demo.
- Make reprocessing and deletion consistent with associated reviews and database constraints. Use an isolated temporary database/upload directory for tests; never mutate the user's clips or database during verification.
- Make local SQLite the primary documented path. Align environment names; record a dependency set that actually installs/builds. Do not undertake a framework migration during this work.
- If retaining Docker as a supported path, replace conflicting initialization with the app-compatible schema and validate on a fresh disposable database. Back up existing data and use an explicit migration if it must be preserved. Otherwise label Docker unverified rather than promising it works.
- Ensure demo assets are actually included in Git/artifact packaging; the current `uploads/` ignore means local footage is not a distributable demo fixture. Store permission-cleared fixtures separately with provenance, plus an offline fallback recording. Avoid runtime dependence on external font downloads.

**Acceptance:** Fresh local setup works from documented instructions; one known clip and all four simulator scenarios can be presented without network access. Two-user tests reject cross-owner access including media. Oversized/corrupt input fails cleanly. Existing successful data survives a failed reprocess. Only advertise installation modes that were verified.

## Priorities when time is short

1. Fix clean checkout, delayed trajectory state, playback and persistence.
2. Deliver genuine 2-D tracking with the synchronized overlay and missing-track handling.
3. Label simulation/estimates honestly; remove unsupported speed/decision claims.
4. Make the current review screen coherent and readable.
5. Collect held-out metrics and rehearse the explanation.

Defer calibrated airborne 3-D fitting until these five are complete. Do not substitute visual polish for real CV evidence. Treat private-access protection as required before using personal clips on a shared deployment.

## Final definition of done

- A clean checkout installs and builds; the documented backend tests and focused frontend tests pass in isolation.
- A supported real delivery produces inspectable 2-D measurements, with raw/predicted distinctions and reproducible evaluation.
- No-ball, corrupt input, occlusion and failed reconstruction have truthful visible states.
- Real clips and simulation remain clearly separated throughout the interface and report.
- Scene geometry and API coordinates agree, playback works across views, and new/reprocessed results retain the same contract.
- UI is readable on the presentation laptop/projector and can demonstrate the CV and graphics concepts without narration covering broken states.
- README, report, results, example assets and five-minute demo are complete; unsupported claims and obsolete scope are removed.
- Private data cannot be accessed or deleted by another user or anonymous requests.

## Copy-paste instruction for the implementation AI

> Read `docs/ICG_AUDIT_AND_IMPROVEMENT_PLAN.md` and inspect each finding against the current code before editing. Implement the phases in dependency order, keeping React/MUI/Three.js/FastAPI/OpenCV and reusing existing components. Start with the reproducibility and uploaded-video defects, then deliver observable image-space tracking, honest reconstruction semantics, UI polish, evaluation and packaging. Preserve existing user changes and stored data. Do not replace failed CV with simulated points, invent metrics or speeds, claim full DRS accuracy, add model training, migrate frameworks or add infrastructure without a demonstrated need. Add focused regression checks for nontrivial changes, run builds/tests against isolated data, and inspect the UI on laptop and mobile viewports. Report what changed, verification evidence and remaining limitations after each phase. Finish with an actual demo script and measured results, not just updated styling.

## Deliberately excluded

No YOLO training, multi-camera rig, live officiating, full cricket-law engine, run-out/edge detection, commercial competitor parity, billing, cloud deployment, stadium assets or framework rewrite. These increase scope without repairing the current project's central evidence and explanation gaps.

Remaining uncertainty: real tracking accuracy, real footage suitability, live UI quality, build compatibility and achievable playback FPS were not measured in this audit. The implementation must establish them; they are not assumed passes.
