# ICG implementation re-audit

Date: 2026-11-05

Reviewed commit: `189a2a1` against `7dbef26`, plus the current clean working tree and the earlier improvement plan.

## Verdict

**Improved, but the original plan is only partly complete.** The project builds and its existing backend tests pass. It still has material playback, access-control, persistence and evidence problems. Resolve findings 1–6 before presenting the implementation as complete. Do not deploy private footage with the current access policy.

This audit does not apply code fixes. File/line references below refer to the reviewed commit.

## Verification actually performed

| Check | Result |
|---|---|
| Backend suite using the existing virtual environment | **41 passed**, one Starlette/httpx deprecation warning. Database/uploads redirected to temporary locations. |
| Frontend production build | **Passed**, with a missing `@mediapipe/tasks-vision` source-map warning and stale Browserslist data notices. |
| Controlled 24-frame moving red circle, generated locally at 640×360 / 30 FPS | Tracker returned 24 points: 21 measured, 3 predicted; mean centre error over retained measured points was **1.47 px**. This is a controlled smoke test, not a real-cricket benchmark or full-frame detector metric. |
| Anonymous route calls against temporary owner-specific records | Listing exposed both records; trajectory read and deletion succeeded without a user. |
| Reprocess fault injection after tracking succeeds | Endpoint returned 500; old trajectory was gone; video remained `processed`. |
| Unverified-event probe: four constant-height points | Returned a ground-level bounce, final-point “impact,” wicket verdict and 36 km/h release speed despite no actual bounce or pad event. |
| Prediction-only evaluation probe | With zero measured detections and one matching predicted point, precision, recall and F1 all returned 1.0. |
| Legacy bcrypt password compatibility | A valid raw-bcrypt hash from the original scheme no longer verified. |
| Evaluator with a top-level JSON point array | Crashed with `AttributeError: 'list' object has no attribute 'get'`. |

The first sandboxed API-test run stalled in Windows asyncio loopback socket creation. A bounded rerun outside that restriction passed all 41 tests. The stall is not reported as an application failure.

No live browser walkthrough, projector/mobile rendering check, real-cricket accuracy measurement, clean dependency installation or PostgreSQL/Docker runtime test was performed. Build and test commands used existing installed dependencies. Temporary probes used generated fixtures rather than the user's database or uploaded clips.

## Findings

### 1. P1 — Private clips remain readable and deletable without authentication

**Sources:** `backend/src/api/videos.py:68–69, 342–345, 397–402`; `backend/src/main.py:33`; `backend/src/api/reviews.py`; `backend/src/api/auth.py:40–49`.

`current_user` is optional and ignored by the video-specific read/write operations. Anonymous listing calls `list_videos(user_id=None)`, which returns all clips. The public `/uploads` static mount bypasses ownership entirely, and invalid tokens are downgraded to anonymous users. Review records have the same missing ownership boundary.

**Confirmed:** Direct anonymous calls against temporary owner-A records listed their identifiers, returned a stored trajectory and deleted a clip successfully. Source inspection confirms public media mounting. The original plan's privacy fix has not been implemented.

**Fix:** Keep synthetic presets public. Require authentication and ownership for private video/review operations and media/diagnostic access. Reject invalid tokens rather than granting anonymous behavior. Add anonymous and two-user endpoint tests, including playback access and delete/reprocess.

### 2. P1 — Uploaded-video playback freezes in 3-D-only mode

**Sources:** `frontend/src/pages/DRSReview.js:87–112, 142–153, 299–319`.

The `<video>` element exists only in Video/Split views. Choosing 3-D unmounts it, eliminating the video's clock. The animation effect immediately returns for uploaded-video mode, so pressing Play only toggles state and cannot advance `currentTime`. Returning to Split mounts a fresh video without restoring its playback position/rate.

**Fix:** Keep the media element mounted while hiding its panel, or provide a single authoritative clock that preserves video time/rate across view changes. Test uploaded-video Play, seek, rate changes and Split → 3-D → Split continuity.

### 3. P1 — Reprocessing still loses the old result on a persistence failure

**Sources:** `backend/src/api/videos.py:237–252, 267–270`.

Tracking now runs before deleting the old result, which is an improvement. However, deletion is committed before building/inserting the replacement. Any error after that commit leaves the old result permanently deleted. The exception handler then sets `processed` even when no trajectory exists. A failed database commit also needs rollback before the handler can safely use the session again. Reprocessing additionally lacks a guard against a video already processing.

**Confirmed:** Injecting a failure into `_build_additional_data` after a successful tracker return produced `{response_status: 500, old_trajectory_survives: false, video_status: "processed"}`.

**Fix:** Validate/prepare the replacement first; update or replace the trajectory in one transaction. Roll back failures and restore status based on whether a previous successful result actually exists. Reject duplicate processing. Add endpoint-level failure tests, not just tests of the metadata helper.

### 4. P1 — Uploaded footage still receives unsupported events and invented speed

**Sources:** `backend/src/services/ball_tracking_service.py:1676–1693, 1699, 1812`; `frontend/src/components/HawkEyeViewer.js:458, 790`; `frontend/src/pages/DRSReview.js:545–547`.

The tracker still labels the minimum heuristic height as a bounce, rewrites that height to ball radius, labels the final tracked point as pad impact and produces a wicket verdict. It derives “release speed” from endpoint displacement in heuristic world coordinates. The “ILLUSTRATIVE” label is helpful, but it does not satisfy the plan's requirement to leave unsupported events/metric measurements unknown.

The viewer has an independent fabricated value: `speed_kmh: p.speed_kmh || 135`. Real-video points do not contain measured speed, so clicking a bounce/impact marker displays **135 km/h** even though that value was never detected or calculated for that point.

**Confirmed:** A constant-height four-point trajectory with no event evidence acquired a ground bounce, impact and verdict. The frontend's missing-speed fallback is explicit in source.

**Fix:** Reserve verified physical event semantics for simulated or explicitly annotated events. Return unknown for unverified bounce/impact and suppress unsupported wicket decisions. Remove the 135 fallback; show unavailable values explicitly. If displaying pixel speed, calculate it in pixels/second and label those units. Test an uncalibrated track with no bounce, no pad contact and no speed field.

### 5. P1 for submission evidence — Evaluation does not establish CV detector accuracy

**Sources:** `backend/scripts/evaluate_tracking.py:83–119, 189–235`; `docs/DEMO_SCRIPT.md:61–69`.

Predicted and measured points enter the same true-positive counter. These numbers can describe combined tracking output, but must not be presented as measured detector precision/recall. The script can return perfect scores with zero real detections. Its `--demo` path constructs both annotations and synthetic output directly; it never runs the video tracker. The demonstration script calls its output a benchmark without making that boundary clear enough.

No versioned real-cricket annotations, held-out results or baseline comparison were found. The controlled dot smoke test in this audit does not fill that gap.

**Fix:** Report detector metrics using measured points and separately report combined tracking metrics/prediction coverage. Define evaluated, absent and unlabelled frames so sparse annotations do not automatically turn every unlabelled detection into a false positive. Retain the synthetic demo as a labelled harness example. Add a small real-clip held-out evaluation and report failures as well as successes.

### 6. P2 — The promised observable CV interface is missing

**Sources:** `backend/src/api/videos.py:367–389`; `frontend/src/pages/DRSReview.js:312–318`; README lines 85–91 and 117–125.

`debug_info` is stored but omitted from `GET /videos/{id}/trajectory`. Video metadata such as FPS is also discarded from the persisted result. The review interface has a plain video element and a 3-D view; it has no image-space ball overlay, HSV/motion-mask inspector, measured/predicted quality panel or raw/smoothed comparison. The viewer converter drops measurement provenance. The README says diagnostics are returned and demonstrated, which is currently false.

**Confirmed:** A stored `debug_info` object was absent in the trajectory response. Repository inspection found no diagnostic-overlay component or mask endpoint.

**Fix:** Return diagnostic summary and video metadata, draw retained pixel centres at the correct video frame/letterbox coordinates, distinguish measured and predicted points, and add a selected-frame pipeline inspector. Persist or derive masks only as needed. Add response-contract and frame-alignment checks. This is a high-value remaining step for explaining the CV work during the viva.

### 7. P2 — Asynchronous responses can attach the wrong trajectory to the selected source

**Sources:** `frontend/src/pages/DRSReview.js:49–59, 65–75`; `frontend/src/App.js:69–91`.

Preset loading applies every response unconditionally. If preset A is slow and preset B finishes first, A can overwrite B while the selector still says B. Switching back to the uploaded clip before a preset response arrives can similarly display simulated points while `isVideoMode` labels them illustrative video output. Parent clip fetching also has no cancellation/request-identity check when navigating away and opening another clip.

**Fix:** Bind results to a request/source identity or cancel obsolete requests, including on navigation. Test out-of-order preset responses and switching to the uploaded clip while a preset request is in flight.

### 8. P2 — Track/reprocess still block the async server

**Sources:** `backend/src/api/videos.py:234, 306`; upload executor at lines 166–174.

Upload was moved into a thread, but `/track` and `/reprocess` still run synchronous OpenCV work directly in async handlers. Clicking the dashboard's reprocess button can therefore block unrelated API requests until analysis ends. Upload creates a separate `ThreadPoolExecutor(max_workers=1)` per request, so it does not impose a shared one-job capacity limit.

**Fix:** Use one consistent offload/worker path for all processing entry points, with a deliberate concurrency limit and resource cleanup. Test server responsiveness during processing and reject duplicate jobs for the same clip.

### 9. P2 — Password prehashing breaks existing account hashes

**Source:** `backend/src/services/auth_service.py:19–33`.

The original scheme bcrypt-hashed the password directly. The new scheme hashes SHA-256 hex with bcrypt, while verification always applies SHA-256. Both stored formats look like ordinary bcrypt hashes, so existing accounts cannot be distinguished and migrated automatically using the current implementation.

**Confirmed:** A raw-bcrypt hash of an audit-only password failed `AuthService.verify_password` with that same password.

**Fix:** Introduce an identifiable versioned password scheme and a safe legacy verification/rehash path, or explicitly require a password reset for old accounts. Preserve current users' data. Do not silently assume a newly generated bcrypt string identifies the prehashed scheme. Add old- and new-scheme login tests.

### 10. P2 — Evaluation CLI crashes on the point-array input it attempts to support

**Source:** `backend/scripts/evaluate_tracking.py:271`.

`data.get('points', data if isinstance(data, list) else [])` calls `.get` before checking whether the loaded JSON is a list. A top-level point array raises `AttributeError`.

**Confirmed:** A temporary one-frame CSV and JSON point array caused exit code 1 with that exception.

**Fix:** Branch on the loaded JSON type before accessing `.get`, reject malformed structures with a clear error, and test both object and array inputs.

## Remaining lower-priority limitations

- Docker is now labelled unverified, which is appropriate. Its claimed ORM-matching schema still differs: `users.username` instead of `name`, missing update fields, `review_sessions.decision` instead of `decisions`, TEXT instead of JSON trajectory fields and missing unique video-trajectory constraint. Keep local SQLite as the supported path until corrected and tested.
- Frame stepping assumes 30 FPS instead of using the source video's FPS. The API currently drops the required metadata.
- Manual ROI/delivery-interval selection and camera calibration from the original plan are not implemented. The fixed first-300-frame window remains.
- The Kalman filter now has dt-dependent dynamics and preserves metadata, but still smooths the heuristic 3-D lift rather than implementing the planned image-space filter.
- Some new regression tests duplicate expressions or inspect source strings rather than exercise the real API/loop. All 41 passing does not cover ownership, transactional replacement, UI clocks or out-of-order fetches. No frontend tests were found.
- The README's “same model as Hawk-Eye's teaching demos” claim is unsupported by repository evidence. Remove that attribution. The architecture diagram's filter/gap/lift order does not match execution; update it to describe the implementation actually presented.

## What the agent did fix

- Essential `frontend/public` files are now tracked.
- Uploaded trajectory state now responds to delayed parent props, with loading/error states.
- Native Windows filename extraction and chunked upload size checks are improved.
- The three processing paths use a shared metadata-extraction helper.
- Geometry dimensions are more consistent; Kalman position/velocity coupling now uses elapsed time.
- Predicted points carry flags and pixel/frame metadata through smoothing.
- Prediction length has explicit caps; default geometry has improved diagnostic tagging.
- Extrapolated ribbons now contain visible gaps, and a WebGL error boundary exists.
- Recorder audio is disabled; permission errors and countdown cleanup are improved.
- Tests, architectural notes and a demonstration script were added.

## Recommended next handoff

> Fix findings 1–4 first, adding endpoint-level access and reprocess-failure tests plus a frontend uploaded-video playback test. Then deliver the missing observable CV panel, bind async results to the current source, and separate real detector evaluation from synthetic/predicted tracking scores. Preserve the existing stack, data and simulation features. Correct the demo/report claims to match verified behavior. Run the full backend suite and frontend build, perform a real browser walkthrough, and provide real-clip evaluation evidence before declaring the ICG project complete.

No source code was changed by this audit. Live UI appearance, real-cricket performance and Docker compatibility remain unverified.
