# UI/UX implementation audit

Current follow-up: [Both-plan completion audit](PLAN_COMPLETION_AUDIT.md) supersedes the completion status and test counts below, including the new calibration, motion, physics and audio work. This document retains the earlier UI checkpoint.

Date: 2026-11-12. Scope: the UI/UX work in UI_UX_AND_HAWKEYE_SYNC_PLAN.md, including the shared playback and sampling needed by that interface. The later physics/UltraEdge plan is a separate workstream.

## Verdict

The original implementation was incomplete. This pass implements the core entry/library/review experience and corrects the problems found during source review and browser checks. It does **not** certify the entire first plan as complete: manual camera calibration, source-camera reconstruction, variable-frame-rate normalization, and representative real-cricket validation remain open.

Implementation integrity: **pass for the tested core UI flows**, with the remaining limits below. There were existing uncommitted changes when this pass started, and additional physics/audio edits arrived during it. Those changes were preserved; they are not all attributable to this UI pass.

## Audit health

Provisional assessment of the audited UI surfaces, not a WCAG certification or real-device performance benchmark:

| Dimension | Score | Evidence and limitation |
|---|---:|---|
| Accessibility | 3/4 | Explicit guest entry, labelled playback/source controls, readable timeline value, explicit reviewer outcome, visible focus, semantic disclosure controls. Core text tokens measured; full screen-reader and touch testing not performed. |
| Performance | 3/4 | Review/3D code loads on demand; initial gzip bundle fell from roughly 445 KB to 159 KB in the measured build. Real-device rendering performance remains unmeasured. |
| Theming | 2/4 | Shared graphite/blue workspace palette implemented. Legacy secondary viewer tools and report panels still contain local colours/styles. |
| Responsive layout | 3/4 | Phone defaults to one viewer, tablet stacks evidence, desktop uses an inspector, timeline remains reachable. Browser viewport checks are distinct from physical touch-device verification. |
| Implementation integrity | 3/4 | One source-media clock and shared sample policy, one observed overlay, unavailable data preserved, no certification claims in the report. Calibration and source-media coverage are still limited. |
| Total | **14/20** | **Good for tested core flows; remaining work is explicit.** |

The bundled Impeccable detector/context engine could not initialize its cache earlier in this session. The score comes from source inspection, rendered screenshots, targeted tests, and the stated measurements; it is not detector output.

## Findings corrected

### P1 — Incomplete uploaded analysis crashed the review

Location: frontend/src/pages/DRSReview.js, length-zone display. Removing fabricated fallback data exposed an unchecked string operation on null. A clip with no measured zone could blank the review. Null is now displayed as unavailable and guarded throughout that display. A regression test renders incomplete/no-detection analysis.

### P1 — Uploaded playback and overlays used inconsistent timing/sampling

Locations: DRSReview.js, HawkEyeViewer.js, utils/mediaClock.js, utils/trajectory.js.

- The mounted source video now drives time through presented-frame callbacks, with a media-currentTime rAF fallback.
- Media pause/play/seek/rate/wait/end/error events reconcile playback state; subscriptions and outstanding callbacks are cancelled on source changes/unmount.
- The observed marker and moving 3D ball share sample selection, gap, and coverage rules. Missing segments do not become stationary tracked balls.
- Duplicate timestamps are resolved deterministically on an immutable prepared track. Missing/invalid points are handled without manufacturing coordinates.
- One SVG overlay replaces the competing crosshair/reticle systems. Source pixels, including pixel zero, map into the video's contain rectangle and update after resize/layout changes.
- The default trail shows the recent 0.3 seconds. Explanatory/predicted scene layers remain separate controls.

The browser probe initially measured up to 70ms between the displayed timeline and presented media frames. The native callback now commits its frame-time update synchronously; initial subscription and ordinary media events retain normal React scheduling. This is deliberately limited to the browser frame boundary, following [React's browser-integration guidance](https://react.dev/reference/react-dom/flushSync). Synchronous rendering has a performance cost, so profile representative hardware before extending it to other updates.

This verifies a timing architecture and controlled fixture behaviour; it does not prove accurate 3D reconstruction from arbitrary uploaded footage.

### P1 — Unknown results could become a reviewer verdict or fabricated report data

Locations: DRSReview.js, MatchReportCard.js, DRSCommentary.js, DecisionFlowHUD.js, PhysicsVectorsHUD.js.

- Reviewer assessment starts unselected when automated evidence is absent. Save requires an explicit outcome and a signed-in uploaded clip; unsupported simulation save has an explanation.
- Saving reviewer notes no longer requires a completed automated trajectory.
- Unknown speed, probability, length, bounce angle, spin, seam deviation, confidence, and partial decision fields remain unavailable/null where touched.
- Removed the report's unsupported “ICC certified,” fixed millimetre accuracy, “official verified,” and default OUT claims, including its PNG output.
- Commentary no longer interprets a missing impact event as evidence of a clean ball passing to the stumps.

The underlying physical/uncertainty model is outside this UI audit; a supplied number is not independently validated merely by displaying it correctly.

### P1 — Phone/tablet controls competed with the footage

Locations: index.css, DRSReview.js, HawkEyeViewer.js.

- Desktop has a 300px evidence inspector. Below the desktop breakpoint, content uses a scrolling stacked layout rather than squeezing three narrow columns.
- Phone review starts with Video and offers Video/3D tabs; switching views keeps the source media mounted.
- Timeline stays sticky on smaller screens; inspector bottom clearance keeps content reachable behind it.
- Umpire, Side, Top, and Orbit are the four primary camera choices. All remaining cameras are in More cameras.
- Camera controls occupy a reserved strip below the scene. Measurements, diagnostics, exports, and advanced scene tools are disclosed on demand.

### P2 — Guest entry and task hierarchy were unclear

Locations: AuthPage.js, Dashboard.js, App.js.

- Continue without account is visible and retains the existing simulation route. It does not invent guest upload permissions.
- Upload is the main library task; simulation remains secondary and available.
- Source clips can be opened while analysis is pending. App polls the existing progress endpoint and loads that clip's completed analysis, with stale-response guards and cleanup.
- Real uploads identify the filename and source mode; presets remain in the simulation workspace.
- Sign-in/account creation, file browsing, recording, deletion confirmation, search, exports, reports, commentary, and existing advanced tools remain available.

### P2 — Entry page loaded the complete 3D application

Location: App.js. The review workspace now uses React lazy/Suspense. No dependency was introduced. The initial bundle measurement above refers to an actual build; total downloaded code after opening a review remains larger.

### P2 — Core control contrast and interaction semantics were inconsistent

Locations: App.js, index.css, DRSReview.js.

Shared primary actions now use dark text on the blue accent. Normal text and secondary text tokens were measured against their actual intended opaque surfaces:

| Pair | Contrast |
|---|---:|
| #F2F5F9 on #101318 | 17.02:1 |
| #ADB8C7 on #202733 | 7.47:1 |
| #101318 on #8AB4FF | 8.91:1 |

These are token checks, not a claim that every legacy composed overlay passes. Main icon and camera targets have 44px minimum hit areas. Native buttons, selects, disclosure controls, and slider semantics retain keyboard interaction. Selected speed is exposed with aria-pressed. Reduced motion suppresses workspace transitions and substitutes a static view for cinematic camera modes; a full scene-effects motion review remains open.

## Validation and artifacts

- Frontend tests cover track preparation/sampling/letterboxing, presented-media-time/fallback/callback cleanup, incomplete-analysis review rendering, media-error recovery, explicit assessment selection, processing-to-ready transition, and truthful report output.
- The dependency-free browser harness is scripts/audit_ui.cjs. It starts a local static server and headless Chromium, using synthetic API/media fixtures without reading private footage or creating accounts.
- docs/ui-audit/ contains the generated 30fps WebM timing fixture, API fixture, desktop/phone/tablet captures, and results.json. The fixture is visibly labelled synthetic.
- Browser checks exercise guest entry, library, review layouts, the camera toolbar, and the assessment dialog. Source decoding/seeking and timing are evaluated against the controlled fixture.
- Keyboard/screen-reader semantics were inspected in code; physical touch gestures, screen-reader output, live uploads, recording permissions, real clip calibration, and codec coverage were not comprehensively exercised.

Build/test details and the authoritative final browser measurements are recorded in docs/ui-audit/results.json and the final verification note below.

## Remaining findings

| Priority | Finding | Required follow-up |
|---|---|---|
| P1 — full first-plan gate | Manual landmark correction/calibration, validated source-camera view, and robust VFR/source-timestamp handling remain incomplete. | Implement against the actual calibration/decoder contracts; verify on representative footage. Do not imply an arbitrary upload is calibrated. |
| P2 | Secondary tools still use local colours and dense small controls. | Consolidate scene/report tool styling and verify open disclosures at large text sizes and on touch hardware. |
| P2 | Full audio/physics accuracy is not established by these UI checks. | Complete SCREENSHOT_FEEDBACK_FIX_PLAN.md and validate independent reference footage/data. |
| P2 — verification | Long-run drift, all supported media containers, keyboard focus visibility across every modal, and the entire 3D reduced-motion behaviour were not measured exhaustively. | Expand the existing harness around real deployment targets rather than adding arbitrary precision claims. |

No P0 failure remained in the tested fixture flows. An unchecked feature or platform is unverified, not passed.

Recommended next sequence: harden calibration/media boundaries, adapt the remaining advanced controls, then polish the integrated scene. Preserve the corrected null handling, feature inventory, guest route, and source-clock architecture while doing so.

## Final verification

| Check | Observed result |
|---|---|
| Frontend regression suite | **9 passed in 5 suites**, using `CI=true npm --prefix frontend test -- --watchAll=false --runInBand`. Includes incomplete decision objects and media clock lifecycle/fallback checks. |
| Isolated production build | **Passed with CI=true**, using the installed react-scripts BUILD_PATH support to write into a temporary directory independently of other agents' build output. |
| Browser functional checks | **Passed**, headless local Chromium with a synthetic source video/API fixture. Guest entry, library, review, explicit assessment, and camera toolbar all exercised with no uncaught browser exceptions. |
| Responsive viewports | **375, 768, 1024, 1440px** checked for document overflow; screenshots saved. These are emulated viewport checks, not physical touch-device tests. |
| Presented-frame versus displayed timeline | **Maximum 0.003 seconds at each of 1x, 0.5x, 0.25x, 0.1x**, 8 observations per rate, 32 total. Passed the 30fps fixture's one-frame tolerance plus 5ms rounding allowance. |
| Whitespace validation | Scoped `git diff --check` passed for the UI source/helpers reviewed here. The broader checkout also contains another workstream's UltraEdge whitespace change. |

Timing was observed after a render opportunity against a continuously monitored presented-frame timestamp. The control displays hundredths, so the 3ms result reflects display rounding; it is not a claim of 3ms tracking accuracy, end-to-end rendering latency, camera calibration accuracy, or commercial Hawk-Eye equivalence. The synthetic run does not establish long-run drift or real-cricket detection quality.

The build retains the existing missing MediaPipe source-map warning and outdated Browserslist notice. Tests retain the installed Testing Library/React act deprecation warning. No dependency upgrades or warning suppression were introduced.

Artifacts:

- [Desktop uploaded review](ui-audit/upload-desktop.png)
- [Phone uploaded review](ui-audit/upload-mobile.png)
- [768px review](ui-audit/upload-768.png)
- [1024px review](ui-audit/upload-1024.png)
- [Desktop simulation](ui-audit/demo-desktop.png)
- [Phone guest entry](ui-audit/entry-mobile.png)
- [Machine-readable results and timing traces](ui-audit/results.json)

Reproduce with `node scripts/audit_ui.cjs <Chromium executable> docs/ui-audit/fixture.json docs/ui-audit <production build directory>`. The optional build argument allows independent verification while other workstreams use the default build directory.
