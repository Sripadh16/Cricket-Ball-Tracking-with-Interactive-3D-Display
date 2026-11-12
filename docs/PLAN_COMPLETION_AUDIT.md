# UI, replay motion, physics and audio audit

## Follow-up: actual uploaded clip and overflow fix

The running backend originally used a virtual environment missing the declared `ultralytics` dependency, so the classical fallback selected the umpire's shirt. The backend was restarted with the installed detector runtime. `run_server.py` now stops with an actionable dependency error in an incomplete environment. With a loaded model, weak colour/shape fallbacks no longer override a model detection or convert a model miss into a shirt detection. The pixel-speed gate now permits fast broadcast ball movement, and predictions stop at the source frame boundary. The zero-timestamp gap calculation was also corrected.

The user's existing 37-frame, 25fps uploaded delivery was reprocessed through the existing ownership-checked transactional reprocess function. Result: 10 measured detections between 0.92s and 1.32s and one prediction at 1.36s. An annotated source-pixel preview is saved at `ui-audit/real-clip-detection.webm`; the 1.20s frame was visually inspected with the reticle on the ball. This is partial coverage, not successful reconstruction of the complete delivery. Early frames remain undetected. A new review button jumps to the first tracked frame.

Desktop split panels now have explicit constrained grid columns and a bounded row. The source video is positioned within its panel instead of contributing intrinsic dimensions. Review entry resets page scroll, and the tablet CSS breakpoint matches the component breakpoint. Browser checks passed for split boundaries and visible toolbar/playback at 1200, 1279, 1440 and 1920px, including the wide recorded simulation source. The phone and tablet checks remain in the harness. Follow-up checks: 20 frontend tests, 57 targeted backend tests, production build and whitespace check passed. Existing dependency warnings remain.

Date: 2026-11-12. Covers `UI_UX_AND_HAWKEYE_SYNC_PLAN.md` and `SCREENSHOT_FEEDBACK_FIX_PLAN.md`. This is the current audit; the earlier UI audit describes an earlier checkpoint. Existing uncommitted work was preserved. No dependency was added.

## Conclusion

Core UI flows and the identified replay defects have been implemented and tested. Neither plan can honestly be called fully validated for arbitrary cricket footage. Camera registration, airborne height and representative reference-data accuracy remain open. The product should continue to describe uploaded 3D as approximate reconstruction and physics/audio demonstrations as simulations.

## Implementation against both plans

| Requirement | Current implementation | Status / limit |
|---|---|---|
| Entry, guest access, upload library | Guest action preserved; upload/review task hierarchy, graphite tokens, lazy review loading | Implemented; browser fixture tested |
| Reduce clutter without removing tools | Four primary camera choices, advanced disclosures, measurements collapsed, separate simulation settings | Implemented; advanced styling still has local colours |
| Responsive review | One viewer on phone, stacked tablet evidence, desktop split view and inspector | Implemented; emulated widths 375/768/1024/1440, no physical-device certification |
| Source-driven tracking | Mounted video, presented-frame callback with fallback, buffering/seek reconciliation, one overlay and shared sampler | Implemented; synthetic 30fps timing checked, long-run real/VFR validation open |
| Honest coverage and measurements | No invented upload speeds/verdicts/reticle; gaps and out-of-coverage hide moving ball; export/report provenance | Implemented |
| Landmark correction | Four source-pixel corners, pointer or numeric entry, owned validated API, projection update and stale inference invalidation | Implemented; height remains heuristic; successful reprocessing replaces manual correction |
| Source timestamps | Valid decoder timestamps retained; invalid FPS rejected; FPS fallback explicitly marked approximate | Partial: no guaranteed VFR normalization/transcoding pipeline |
| Source camera alignment | Unverified reconstruction identified in UI; original-pixel overlay remains separate | Open: calibrated intrinsics/extrinsics and validated airborne reconstruction |
| Replay motion | Absolute-time camera, bat, spin and automatic wicket poses; gentler camera sweeps; subtle ball trail; no bounce pulse or ghost hue pulse; simulation stops once | Implemented; seekable deterministic helpers tested; automatic motion respects reduced-motion preference |
| Collision and verdict consistency | Swept ball-radius collision against finite stump/bail geometry, contact-truncated physical path, separate theoretical stump-plane prediction, no stump shatter from LBW verdict | Implemented; decorative wicket followthrough is illustrative, not a rigid-body contact solver |
| Turf and vectors | Turf spin grip affects bounce, actual contact height, shared interpolation of force/velocity fields, outgoing bounce telemetry, null-safe vectors and explicit visual scales | Implemented; 48 preset/turf/RPM combinations checked; model is not experimentally fitted |
| UltraEdge evidence | Decode actual supported source audio, signed per-channel extrema, transient-preserving display/zoom, local-baseline candidate markers, no automatic edge verdict | Implemented; candidate sound is not proof of bat contact |
| Audio honesty and lifecycle | Explicit demo switch, no fallback synthetic waveform in source mode, late response guard, abort/close decode contexts, no separate replay audio clock | Implemented; unknown container audio offset explicitly unverified; decoder/container compatibility limited to browser support |
| Ghost comparison | Retained with separate simplified-model label | Implemented; divergence is not an accuracy measurement |

## Corrected defects

- Uploaded pause, buffering and seeking could leave a stale clock; queued callbacks now respect those states.
- Position and force telemetry could represent different instants; shared interpolation now handles both, including discontinuous bounce telemetry.
- Automatic wicket effects previously followed verdict text or render delta. They now require an explicit bowled contact and derive every pose from event elapsed time. Unstruck stumps stay upright; bails use modest impulses; automatic lights decay without strobing.
- Camera paths no longer advance on independent loops or use frame-count damping. The default side view keeps the delivery readable; uploaded avatars start hidden.
- The simulator could manufacture bounce timing, duplicate contact timestamps, and display a ball beyond an actual wicket collision. Ground contact, monotonically sampled output and the first physical wicket contact now agree.
- Manual pitch correction validates source dimensions, corner geometry and ownership, preserves source pixels/time, and clears obsolete inferred events rather than presenting them as current evidence.
- Real audio no longer becomes synthetic evidence when decoding fails. Stereo cancellation and dropped final-buffer samples are covered by regression checks.
- Opening audio on a small viewer could consume the scene row. Explicit grid tracks preserve scene height and make the dock scrollable.

## Verification

| Check | Observed result |
|---|---|
| Frontend unit/component tests | 19 passed across 9 suites |
| Physics, calibration and completion tests | 29 passed |
| Phase 1 and phase 2 regression tests | 30 passed |
| API regressions including ownership/calibration | 17 passed |
| Production build | Passed; existing missing MediaPipe source-map and stale Browserslist warnings |
| Browser replay | Generated bowled delivery captured; simulation stops at end; paused canvas stays identical; reduced-motion render exercised |
| Browser core flows | Guest, library, uploaded review, explicit reviewer assessment and camera toolbar passed without uncaught exceptions |
| Browser timing | 8 samples at each of 1x, 0.5x, 0.25x and 0.1x; maximum displayed-time difference 0.003 seconds on the synthetic 30fps fixture |

The timing number reflects the displayed timeline's hundredth-second rounding against presented media timestamps. It does not measure tracking accuracy, hardware latency or commercial Hawk-Eye equivalence. Headless rendering and captured frames do not establish a hardware frame-rate guarantee. Installed Testing Library and existing datetime code emit deprecation warnings.

Latest browser artifacts live in `docs/ui-audit/current/`: `results.json`, `simulation-motion.webm`, motion keyframes, desktop/phone audio and upload screenshots. Reproduce with `node scripts/audit_ui.cjs <Chromium executable> docs/ui-audit/fixture.json docs/ui-audit/current frontend/build` after building the frontend. API tests may require localhost socket access for the in-process test client.

## Remaining acceptance gates

1. Obtain representative original deliveries with independently labelled release/bounce/pad/stump events, frame timestamps and camera calibration. Measure reconstruction errors and timing over full clips; report misses and uncertainty.
2. Verify variable-frame-rate, rotated and non-browser-decodable media on the intended deployment. Add timestamp-preserving normalization only when the supported ingest contract and decoder tooling are available.
3. Verify source audio start offsets and contact annotations on real clips. Browser waveform candidates cannot distinguish bat, pad, ground or unrelated noise by themselves.
4. Profile real target hardware and check touch/screen-reader operation, long clips and large-text advanced panels. The current tests exercise controlled fixtures and emulated viewports.

Do not mark these gates passed on the basis of preset simulations or the synthetic browser fixture.
