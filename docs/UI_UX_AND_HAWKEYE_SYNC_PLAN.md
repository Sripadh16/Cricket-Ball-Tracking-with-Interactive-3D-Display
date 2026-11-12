# UI/UX redesign and uploaded-video Hawk-Eye synchronization

Date: 2026-11-12. Deliverable: implementation plan for another AI agent; application code has not been changed for this plan.

## 1. Objective and boundaries

Create a focused cricket review workspace where a user uploads a delivery, sees processing status, and inspects the original video beside its own synchronized trajectory. Preserve the existing continue-without-account entry. Make simulation and real-footage analysis unmistakably different.

Assumed audience: students, coaches, and reviewers using this computer-graphics project on desktop, with a usable phone experience. Treat this as an analysis/educational tool; do not present inferred geometry as a certified umpiring system.

Use the existing React 18, MUI 5, React Three Fiber, Three.js, Axios, FastAPI, and OpenCV stack. No framework migration, extra component library, new state manager, or broad backend rewrite. Preserve existing work: the checkout already contains uncommitted changes in the frontend files listed below. Inspect their diffs before editing.

## 2. Evidence and limitations of this review

Reviewed App.js, index.css, AuthPage.js, Dashboard.js, DRSReview.js, HawkEyeViewer.js, relevant tracking/metadata code, and existing audit/test locations. Inspected docs/screenshot.png and .playwright-mcp/page-2026-11-09T08-25-29-650Z.png. The former shows an older auth design; the latter is a 2026-11-09 simulation capture consistent with several current layout elements. Neither proves current runtime behaviour.

The frontend development server compiled with an existing MediaPipe source-map warning, but the browser connection to localhost timed out. No completed live walkthrough, real-footage synchronization measurement, accessibility score, or mobile visual verification is claimed. No backend tests were run for this planning task.

Guidance used: Impeccable's task-oriented Operate mode and UI/UX Pro Max. Its broad sports query returned a promotional design; a narrower analytics query returned applicable dashboard guidance mixed with irrelevant sales-page advice. Use task hierarchy, restrained density, readable data, and effect cleanup; discard the marketing layouts. React guidance must match installed React 18, including avoiding React 19-only hooks. Impeccable's context launcher could not initialize its engine cache, so project context was read directly. No PRODUCT.md or DESIGN.md was found in the bounded file search.

User correction: continue without account already exists in their experience. Preserve that path. This checkout labels its unauthenticated action “Explore the 3D demo” and routes it to presets through App.handleLaunchDemo. Reconcile that label with the deployed experience before changing it; do not invent guest upload/persistence permissions.

## 3. Findings to resolve

| Priority | Finding grounded in current source/capture | Required outcome |
|---|---|---|
| P1 | Uploaded playback feeds currentTime through the media timeupdate event in DRSReview.js. | Drive visual tracking from presented media frames; use one authoritative clock. |
| P1 | get_trajectory derives video_duration from the last tracking timestamp when points exist. | Separate full source duration from the interval containing tracked samples. |
| P1 | Tracking generates t = frame_idx / fps. | Validate FPS and preserve source presentation timestamps where available; explicitly handle unsupported timing. |
| P1 | DRSReview has nearest-point SVG tracking and a separately interpolated reticle with different time windows. | One sample selection policy and one video overlay. |
| P1 | DRSReview uses defaults including 142.4 km/h, 86% LBW probability, and 0.94 confidence. Viewer telemetry also contains model defaults. | Real-upload unknowns remain unknown throughout HUD, commentary, reports, and exports. |
| P1 | _pixel_to_3d uses planar homography plus heuristic height; fallback reticle projection assumes a broadcast camera. | Distinguish observed pixels from approximate 3D; remove guessed video-overlay positions. |
| P2 | The saved review capture shows a large camera ribbon, many differently coloured controls, and dense diagnostics alongside the scene. | Establish a clear viewing hierarchy and progressive disclosure. |
| P2 | Source selection combines an uploaded clip with presets. | Isolate simulation controls from uploaded-video analysis. |
| P2 | Dashboard gives the simulation prominent space beside upload. | Make uploading/reviewing the main task; keep demo access secondary. |

Preserve existing improvements: App already guards stale trajectory fetches; DRSReview already keeps the video element mounted while hiding its panel in 3D mode. Do not reintroduce conditional unmounting. Older audit findings about that unmounting are historical, not proof of the current bug.

## 4. Visual and interaction direction

Use a precision video-analysis desk: neutral graphite surfaces, clear white text, a blue action accent, restrained cricket-yellow tracking, and colour reserved for meaningful states. Keep the existing product name unless the user separately changes it. The improvement must come from layout and hierarchy as well as colour.

Proposed starting tokens, to be verified against rendered contrast:

| Token | Value / rule |
|---|---|
| App background | #101318 |
| Panel / elevated panel | #181D25 / #202733 |
| Main / secondary text | #F2F5F9 / #ADB8C7 |
| Primary action | #8AB4FF with #101318 text |
| Observed ball trail | #F6D365 |
| Inferred / missing / error | Amber / muted text / red, always paired with text or line style |
| Typography | Existing Segoe UI/system stack; monospace and tabular numerals for time and measurements |
| Type scale | 28–32px page title; 18–20px section title; 14–16px body; 12–13px metadata |
| Spacing | 4, 8, 12, 16, 24, 32px; 6–10px radii; subtle borders |
| Motion | Short control transitions; no pulsing badges; honour reduced motion in CSS and the 3D scene |

Define semantic tokens through App.js MUI theme and index.css; remove competing hardcoded control colours from touched components. Scene lighting/material colours can remain scene-specific, while all surrounding controls use the shared UI theme. Use the existing MUI icon family. No decorative gradients, glass panels, oversized slogans inside the workspace, or all-caps telemetry walls.

### Target desktop layout

```text
Back   Delivery filename   Uploaded footage · tracking status       Save review
                       Video | Split | 3D
+--------------------------------+--------------------------+------------------+
| ORIGINAL VIDEO                 | 3D RECONSTRUCTION        | Review           |
| One observed tracking overlay  | Same delivery/time       | Tracking quality |
|                                | Camera: Umpire / Side /  | Pitching         |
|                                | Top / More               | Impact           |
|                                |                          | Wickets          |
+--------------------------------+--------------------------+------------------+
| Play  Previous frame  Next frame   Time / Frame   Speed                     |
| --------------------- shared timeline + verified event markers ----------- |
+---------------------------------------------------------------------------+
```

At >=1280px, reserve about 280–320px for the inspector and share the remaining width between video and 3D. At 768–1279px, put inspector content below or in a drawer rather than crushing both viewers. Below 768px, show one viewer at a time with Video/3D tabs, preserving playback when switching. Keep timeline reachable; allow normal scrolling on short screens rather than shrinking the footage to nothing. Verify 375px, 768px, 1024px, and 1440px, including a short landscape viewport.

## 5. Screen and state requirements

### Entry and account access

- Keep sign-in, registration, password visibility, password-manager support, and continue without account.
- Give the guest action a stable visible location directly after the account form. State what it opens using the existing product permissions, such as “Explore simulated deliveries without an account.”
- Reduce decorative content on phones so form and guest access are reachable without traversing a large hero.
- Retain field values on failure; show specific inline errors and a useful retry path.

### Delivery library and upload

- Lead with “Your deliveries” and a primary “Upload delivery” action. Move the simulation into a compact secondary action.
- Keep browse, drag/drop, and existing recording. Communicate actual configured size limits and backend-supported formats; do not invent new restrictions.
- Keep upload progress separate from analysis progress. Use existing processing fields where returned; otherwise show an honest indeterminate state with elapsed time, not a fabricated percentage.
- Library rows: thumbnail, filename, upload time, analysis status, and clear open/retry actions. Keep delete secondary and retain confirmation.
- Distinguish empty library, no search matches, failed analysis, no ball detected, session expired, and network failure. A processed clip with no detections is not “tracking ready.”
- On successful upload, show the clip's processing state and allow opening its source footage; auto-load its own trajectory when processing completes, using the existing polling pattern and stale-response protection.

### Review workspace

- Default uploaded clips to Split on desktop and Video on phones. Display filename and “Uploaded footage.” Presets belong to a separate “Simulation lab” action, not a misleading alternative analysis of the same clip.
- Default to one subtle reticle and a short recent trail. Offer full trajectory under Layers. Hide large floating labels, redundant crosshairs, and broadcast graphics initially.
- Show four primary camera options at most; move the rest to More. Keep camera controls outside the region covering the ball, preferably a slim panel header.
- Inspector default: analysis availability/quality and Pitching, Impact, Wickets. Each may be “Unavailable” or “Unverified.” Put diagnostics, exports, force vectors, avatars, themes, ghosts, and presentation tools in explicitly labelled secondary sections.
- Keep existing advanced features accessible in the simulation lab. Synthetic UltraEdge/audio and generated events must carry “Simulated” labels and must not appear as evidence extracted from uploaded audio.
- Replace “Record Official DRS Verdict” with “Save review” or “Reviewer assessment.” Preserve user notes independently of the model result. Saving needs actual authorization and a valid video record; disable unsupported preset/guest saves with an explanation.
- Provide actionable loading, media-decode failure, processing failure, missing trajectory, no detections, low-quality track, and WebGL-unavailable states. Keep video playback usable when 3D fails.
- Frame/timestamp labels, units, full filenames on accessible tooltip, keyboard focus, and selected states must remain legible. Space toggles playback only outside editable controls; arrow shortcuts must not conflict with sliders or text inputs.

## 6. Synchronization implementation contract

### A. One media clock for uploads

1. Start with DRSReview's existing currentTime prop path into HawkEyeViewer and DRSCommentary. Keep one mounted video element for uploaded footage across all layout modes.
2. Use requestVideoFrameCallback when available and its metadata.mediaTime as the time for the currently presented video frame. Browser callbacks must be renewed and cancelled on cleanup/source changes. Do not integrate wall-clock delta for uploads.
3. Fallback to requestAnimationFrame reading video.currentTime during playback, plus media events for paused/seeking updates. Mark fallback precision as approximate in diagnostics. Never run a second clock in parallel.
4. On loadedmetadata, seeked, play, pause, ended, ratechange, waiting, playing, emptied, and error, reconcile media state. Freeze video-linked visuals during buffering. Show a play rejection instead of pretending playback started.
5. Seek/frame-step controls command the media element. Treat the target as pending until the presented frame or seek completion supplies actual media time. Read back its clamped position; do not leave the overlay at an optimistic time the media never reached.
6. Keep simulation's separate animation clock only in simulation mode. Switching sources pauses the old source, invalidates callbacks, resets time/results, and prevents late preset responses from replacing upload data. Persist selected playback rate on the active source.
7. A small useReviewPlayback hook is justified if it keeps these lifecycle rules together. Do not add an application-wide playback store. Initially retain prop-based currentTime; optimize scene updates with a ref only if profiling shows a problem, while preserving one source of truth.

Source: [MDN video frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback), [seek completion](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeked_event), and [React effect lifecycle](https://react.dev/reference/react/useEffect). These APIs improve synchronization; they do not guarantee a frame-perfect browser presentation on every device.

### B. One time base and explicit metadata

- Existing point t values remain seconds from the start of the source video, with frame_idx preserved. Do not subtract release time on one consumer and retain absolute time on another.
- Full video duration comes from validated source metadata; browser loadedmetadata is the playback authority. Store the tracking interval separately, for example tracking_start_s and tracking_end_s. Do not stretch a short detected interval across the full video.
- Validate finite, positive FPS and finite point times. Preserve the difference between measured FPS and an explicit fallback. Reject/surface unusable metadata rather than dividing by zero or silently claiming 30 FPS.
- Current tracking assumes constant-frame-rate timing. For variable-frame-rate or trimmed/transcoded clips, use reliable source presentation timestamps where available. If the current decoder cannot provide them reliably, normalize a derived analysis/playback copy to constant frame rate and track that same copy. Keep the original and the mapping; do not track one timeline and play another. Make decoder/tool availability an implementation preflight, not a speculative dependency install.
- Preserve additive metadata in the existing additional_data JSON through every write path: background upload processing, explicit tracking, and reprocess. Update _build_additional_data and the read endpoint together; keep existing response fields for callers and fixtures.
- Suggested additive fields only as needed: timing_source, coordinate_space, tracking_start_s, tracking_end_s, reconstruction_method, calibration_status. Defaults for legacy records must describe uncertainty rather than manufacture accuracy.
- There is no justified global manual sync offset today. Add an offset only if a reproducible source-processing delay remains after correcting timestamps; document its direction, persist it per clip, and test it. Do not use a slider to mask a broken clock.

### C. Shared trajectory sampling and overlay geometry

- Introduce one small pure sampleTrajectoryAtTime helper consumed by the video overlay and 3D viewer. Preserve the backend coordinate convention (x lateral, y down pitch, z height) and existing Three.js mapping (x, z, y).
- Validate/sort an immutable copy once per response; handle empty, one-point, duplicate-time, non-finite, and unsorted input explicitly. Never interpolate across duplicate timestamps or long missing segments.
- For valid neighbouring samples, interpolate only within a documented maximum gap derived from source frame duration and the tracker's existing prediction horizon. Keep measured, interpolated, and predicted provenance separate; two detected endpoints do not make the interpolated sample a direct observation.
- Before the first tracked frame, after the last tracked frame, and inside a long missing gap, hide the moving observed-ball marker and show “No tracking at this time.” A static full-path layer may remain if enabled. Do not clamp the marker to a fictional stationary ball outside coverage.
- Keep future physical extrapolation as a separate dashed, labelled prediction layer, not an observation that follows the real video. Bounce/impact markers require verified events; remove viewer-side minimum-height/last-point fallbacks for real uploads.
- Use stored pixel_x/pixel_y for video overlays. Remove the assumed broadcast-camera reprojection for uploads. If pixels are unavailable, leave the overlay unavailable while an approximate 3D view may remain labelled.
- Compute the rendered video's contain rectangle once on metadata/layout changes. Map source pixels through its scale and letterbox offsets; share that geometry for reticle and trail. Recompute on resize, view switch, and orientation change. Do not infer normalized units from values <=1: a real pixel near the image origin is valid. Use an explicit coordinate-space contract.
- Remove hardcoded “CV LOCK [30 FPS]” and confidence defaults. Label actual source timing and provenance when known, otherwise use neutral “Tracking available” / “Tracking uncertain.”

### D. Spatial reconstruction and camera matching

Timing synchronization and geometric reconstruction are separate deliverables. A perfectly shared timestamp cannot correct a wrongly reconstructed height or camera.

- First ship observed 2D alignment and correctly timed approximate 3D with a visible “Approximate reconstruction” label.
- Reuse existing pitch homography and camera-pose code. Propagate how landmarks were obtained, calibration validity, and existing reprojection/error information through stored metadata. Do not treat assumed pitch boundaries as measured calibration.
- A pitch-plane homography maps ground-plane geometry; it does not directly recover an airborne ball's height. Keep heuristic height explicitly approximate. Metric speed and conclusive wicket decisions need validated geometry/model evidence.
- Add a compact “Check alignment” flow when automatic calibration is unreliable: pause on a suitable frame, mark known pitch/stump landmarks, show an overlay preview/error feedback, validate degenerate or inconsistent selections, then save per-clip calibration and reprocess. Choose the minimum landmarks required by the existing algorithms; do not claim four pitch corners alone recover true airborne 3D.
- Feed validated camera pose to an optional “Source camera” preset. Keep Umpire/Side/Top as explanatory 3D views. If camera intrinsics/pose are unavailable, do not invent a camera that claims to match the footage.
- Moving-camera footage and camera cuts require segment-specific calibration/tracking. For the first release, detect/flag unsupported segments and ask for a stable single-delivery clip rather than interpolating across cuts. Avoid adding a general video editor.

### E. Honest analysis across all outputs

Audit every consumer of release speed, confidence, LBW probability, bounce, impact, and wicket outcome: DRSReview, HawkEyeViewer, DRSCommentary, DecisionFlowHUD, MatchReportCard, PhysicsVectorsHUD, UltraEdgeVisualizer, and JSON/CSV exports. Real-upload missing values become null/“Unavailable,” preserving zero as a valid value. Keep meaningful synthetic values in explicit simulation mode.

Saving a review must preserve the user's assessment even when automated evidence is unavailable, while clearly distinguishing the two. Do not default a missing automated verdict to OUT.

## 7. Execution sequence and affected files

Implement in this order, completing each gate before proceeding:

| Phase | Changes and likely files | Completion gate |
|---|---|---|
| 0. Baseline | Inspect working diff; capture entry, library, uploaded review, demo, and failures; confirm actual guest route. Add docs/DESIGN.md describing the chosen direction. | Recorded screenshots and source/permission behaviour; no user changes overwritten. |
| 1. Data truth | backend/src/services/ball_tracking_service.py; backend/src/api/videos.py (_build_additional_data plus all persistence callers and get_trajectory); existing metadata fixtures/tests. | Full duration, tracking interval, time/coordinate provenance survive store/read/reprocess round trips; unknowns remain unknown. |
| 2. Playback and sampling | frontend/src/pages/DRSReview.js; frontend/src/components/HawkEyeViewer.js; one small playback hook/helper if needed; overlay mapping. | Uploaded video, marker, 3D, and timeline share actual media time across play/seek/rates/layout changes. |
| 3. UI structure | frontend/src/App.js; frontend/src/index.css; frontend/src/pages/AuthPage.js; Dashboard.js; DRSReview.js; HawkEyeViewer.js. | New hierarchy works at all target sizes; existing guest access and advanced features preserved. |
| 4. Evidence and calibration | Components listed in section 6E; existing calibration code and tests; per-video calibration API/storage only where required. | No false measured metrics/events; approximate geometry labelled; validated calibration can be saved and reapplied. |
| 5. Verify and hand off | Existing frontend test runner/backend tests, browser walkthrough, screenshots, short docs update. | Acceptance checks below pass; unsupported footage/timing limitations explicitly reported. |

Avoid splitting every visual box into a component. Extract an overlay or playback bar only if it gives a clear responsibility to code already being changed. No dependency upgrades as a side effect.

## 8. Acceptance and verification

### Focused automated checks

- Pure sampler tests: non-zero first timestamp; irregular intervals; valid interpolation; long gap; before/after coverage; one point; duplicate/invalid times; preservation of provenance and coordinate convention.
- Playback lifecycle tests with a mocked media element: callback cancellation on source change/unmount, no duplicate clock under StrictMode, pause/seek/rate/buffering/end reconciliation, and callback fallback. Include stale preset/trajectory responses.
- Geometry test: known source pixels map correctly into portrait/landscape letterboxed rectangles, including (0,0), resize, and hidden-to-visible view changes.
- Extend existing backend tests, especially backend/tests/test_api_endpoints.py and test_phase3_cv_calibration.py as appropriate: source duration differs from last detection; frame/time alignment; metadata round trip through all processing paths; invalid FPS; legacy data; calibration validation and preservation on failed reprocessing.
- Add one test that a real-upload null speed/confidence/verdict remains unavailable in its visible summary and export. Do not write snapshot tests for every style rule.

### Browser and real-footage acceptance

- Use a known constant-frame-rate fixture with visible frame numbers and known ball positions, plus representative real cricket footage. Report generated-fixture results separately from real-world accuracy.
- At 1x, 0.5x, 0.25x, and 0.1x, instrument presented media time versus the sample time passed into both renderers. Target at most one source-frame difference under normal playback on the tested desktop; record actual results rather than declaring guaranteed frame accuracy.
- Seek before, into, and after the tracked delivery; step forward/back; restart; change Video -> Split -> 3D -> Split without resetting position, rate, or source. Recheck after buffering and tab restore. Frame-step based on nominal FPS is approximate for VFR; exact stepping requires known frame presentation timestamps or normalized media.
- Verify a clip where the delivery starts several seconds after the file starts. Its first track must not animate at time zero. Verify a clip longer than the tracking processing limit: remaining footage stays playable while tracking is clearly unavailable there.
- Load two clips quickly; never show the previous clip's marker, trajectory, or verdict on the new video. Simulations cannot overwrite upload data.
- Test portrait and letterboxed video, no detections, missing metadata, backend offline, decode error, unsupported codec, denied camera permission, and WebGL failure. The source video and recovery controls remain usable where possible.
- The upload picker accepts AVI/MKV/MOV, but acceptance does not prove browser playback support. Detect decode failures; offer a supported playback derivative generated server-side when tooling exists, preserve source identity and timestamp mapping, or give a clear format-conversion instruction. Never show a working trajectory beside an undecodable blank player as a successful review.
- Verify keyboard-only use, accessible names and selected states, non-colour status cues, 4.5:1 normal text contrast, visible focus, reduced motion including 3D camera effects, and usable touch controls (aim for 44px web tap areas).
- Capture entry, library, uploaded Split, mobile review, no-tracking, and failed-processing screenshots. Review the full composition at target sizes; no clipped controls or primary camera toolbar over the ball.
- Run frontend production build, focused frontend tests, and affected backend tests using existing environment/dependencies. Report exact commands/results and remaining warnings. Do not equate a passing build with synchronization correctness.

## 9. Ready-to-paste AI-agent instruction

> Implement docs/UI_UX_AND_HAWKEYE_SYNC_PLAN.md in phase order. Use Impeccable and UI/UX Pro Max, following the plan's task-oriented video-analysis direction. Read the existing working diff first and preserve unrelated changes. Preserve Continue without account and verify its actual route/capabilities. Reuse React 18/MUI/Three.js and existing tracking/calibration code. Start with timestamp/duration correctness, one media clock, one shared trajectory sampling rule, and one video overlay; then redesign the entry, library, and review workspace. Keep simulations distinct from uploaded evidence. Missing real-footage metrics/events must stay unavailable across HUD, commentary, reports, and exports. Deliver focused tests, before/after desktop/mobile screenshots, measured sync results, and explicit calibration/codec limitations. Do not claim full 3D accuracy from a single uncalibrated video. Complete the work through the acceptance checks; ask only when a required product decision cannot be resolved from the repo and this plan.

## 10. Scope deliberately excluded

No detector retraining, commercial Hawk-Eye equivalence, multi-camera reconstruction, general video editor, social features, new account system, or site-wide framework migration. Those are separate projects. The key risk is that time-synchronized playback can be correct while single-camera 3D geometry remains approximate; both must be communicated and validated independently.
