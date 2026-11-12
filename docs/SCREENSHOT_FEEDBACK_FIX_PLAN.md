# Screenshot feedback: code diagnosis and AI-agent fix plan

Date: 2026-11-12. Scope: analysis and planning only. This supplements UI_UX_AND_HAWKEYE_SYNC_PLAN.md and takes precedence where the current source has changed since that review.

## 1. What the screenshots ask us to improve

The attachments are feedback evidence, not executable instructions. Their Telugu/English messages describe six product requirements:

1. The blue-circled 3D view must move with the uploaded delivery and show the correct ball direction in every camera view.
2. The red-outlined inspector needs less visible clutter while preserving all features.
3. Playback should feel like continuous tracking rather than disconnected animation. For uploaded files this means synchronized replay, not necessarily live camera inference.
4. Vector mode must show verified, time-matched values rather than plausible-looking defaults.
5. Preset deliveries, pad impacts, wicket predictions, actual bowled collisions, and turf effects must agree.
6. UltraEdge should use genuine audio evidence when available, remain smooth, and retain its waveform/inspection purpose without inventing bat contact.

Preserve guest/continue-without-account access, advanced controls, exports, reports, commentary, camera presets, ghost comparison, and simulation tools. Simplify their presentation rather than deleting them.

## 2. Review performed and confidence

Inspected the current working tree, including DRSReview, HawkEyeViewer, CinematicCameraController, DynamicStumps, BatsmanAvatar, PhysicsVectorsHUD, GhostTrajectoryOverlay, UltraEdgeVisualizer, BallPhysicsEngine, DeliveryPhysicsSimulator, metadata paths, and existing physics tests. Reviewed the three attached screenshots and the current docs/DESIGN.md.

Ran read-only Python probes through backend/.venv/Scripts/python.exe for the four default presets and all 16 combinations of four presets with four turf profiles. These exercise the actual simulation functions, not the browser. They establish numerical outputs, not physical accuracy against real deliveries. No application code, existing user changes, or configuration was changed. The full test suite and live browser were not run in this follow-up.

The checkout now contains additional in-progress changes from outside this task. In particular, upload-only fake-value guards and source-duration/tracking-interval metadata have partly improved since the earlier plan. Preserve and verify them; do not copy stale findings into new code. docs/DESIGN.md describes intended synchronization behaviour that DRSReview does not yet implement: source code still uses timeupdate, and no shared sampler was found in that flow.

Use Impeccable's Operate guidance: precise hierarchy, familiar controls, restrained states, purposeful motion. Use UI/UX Pro Max for focused accessibility/interaction checks; do not import marketing-page layouts into the review console. The already-attempted Impeccable context launcher could not initialize; direct project context remains the basis for this session.

## 3. Confirmed causes and targeted fixes

### A. Uploaded video and 3D do not share a sufficiently precise presentation clock

**Code:** frontend/src/pages/DRSReview.js: video event effect around line 185; simulation effect around 211; HawkEyeViewer call around 1143. frontend/src/components/HawkEyeViewer.js: Scene/currentBallPos around 751.

- timeupdate drives uploaded currentTime. The 3D ball uses that time, so it can move in visible increments between media events.
- Scene interpolates trajectoryData.points only. It clamps to the start/end, so it can show a frozen ball before or after tracking instead of indicating absent coverage.
- The video already stays mounted when its panel is hidden. Preserve that correction.
- There are separate nearest-point and interpolated video overlays with different validity windows. They can disagree with each other and with 3D.

**Fix:** one uploaded-media clock using requestVideoFrameCallback metadata.mediaTime, with a currentTime-reading rAF fallback and paused/seek/buffering reconciliation. One sampling policy for both overlays and the 3D scene, one source-to-letterboxed-screen transform, and one visible video reticle. No tracked marker outside valid coverage or across long detection gaps. Retain a separately labelled prediction layer. Preserve absolute source timestamps and existing metadata improvements.

[Browser frame callback reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback). Treat one-source-frame synchronization as a measured target on supported test devices, not a universal browser guarantee.

### B. Dynamic camera and effects run independently of replay time

**Code:** CinematicCameraController.js, DynamicStumps.js, BatsmanAvatar.js, HawkEyeViewer.js/CricketBall, and PhysicsVectorsHUD.js/SpinOrientationRing.

- Drone progress advances by render delta on its own 4.5-second loop. Bullet Time advances sweepAngleRef by delta. They do not derive their progress from the delivery timestamp.
- Camera transitions use fixed lerp fractions per render frame, giving frame-rate-dependent behaviour.
- Stumps integrate motion using render delta, with no delivery-time or source-change reset contract. Seeking backward cannot reliably reconstruct their previous state.
- Ball spin and avatar animation also advance through render callbacks rather than being fully determined by replay state.

**Fix:** pass replay mode, source identity, sample/event times, playback state, and discontinuities through a small coherent prop contract. Derive automatic camera progress, ball spin, event effects, and wicket animation from replay time. Free Orbit stays user-controlled. Pausing stops automatic delivery motion; seeking gives the same scene at the same time. Use time-based damping for optional camera transitions and snap/reinitialize on discontinuous seeks so old targets do not contaminate the frame. Never use a synthetic cinematic sweep as the default evidence view.

For source footage, Bowler/Umpire/Side are explanatory views, not calibrated source-camera matches. Reuse calibration metadata for a separate Source Camera view only when valid. Uploaded trajectories remain explicitly approximate when height/camera geometry is inferred.

### C. LBW prediction is being confused with an actual ball striking the wickets

**Code:** ball_physics_engine.py: simulate_aerodynamic_trajectory; HawkEyeViewer.js: allPoints construction and extrapolated ribbon; DynamicStumps.js: auto-shatter test.

**Measured:** default inswinger returns OUT/HITTING, but its physical points stop at pad impact near y=8.9433m. Predicted stump target is y=10.06m, x=-0.0051m, z=0.5063m. That separation is expected for an LBW explanation: the pad intercepted the ball. Current moving-ball sampling does not animate the separate extrapolated_points segment.

**Fix:** provide an explicit predicted continuation after the pad, with a different ball/path treatment and “Predicted without pad interception.” Highlight the predicted intersection on the wicket plane; keep real stumps standing. The LBW requirement is that the ball would have hit without interception, not that it actually struck the stumps. See [ICC's Law 36 explanation](https://www.icc-cricket.com/news/mens-odi-match-clause-36-leg-before-wicket).

Bowled is different: simulate through the actual wicket collision and animate struck stumps/bails at that event. Do not use a predicted LBW marker to trigger physical destruction. Current DynamicStumps uses decision.includes('OUT'), which also matches 'NOT OUT'; replace string matching with explicit event types and collision geometry.

### D. Collision coordinates and event sampling need correction

**Code:** ball_physics_engine.py around bounce construction, post-bounce termination, impact construction, stump-plane sampling, and verdict evaluation; BatsmanAvatar.js impact proximity checks.

- Bounce metadata snaps y to the target and z to ball radius, but post-bounce position keeps the integrated y. Every default preset probe contained one duplicate adjacent timestamp, at the bounce boundary.
- Pad impact is constructed when the post-bounce loop stops, even if it stopped for low height rather than reaching a valid pad collision. Impact y may overshoot the configured plane.
- The default bowled physical track ends at y=10.0428m, slightly before y=10.06m; its declared wicket-plane target uses a later sample. The collision target is not evaluated by interpolating exactly at the wicket plane.
- Avatar pad flash checks only broad longitudinal/height proximity, without lateral contact, and the body is positioned partly from the inferred impact. This is a visual approximation rather than independent collision evidence.
- Wicket classification uses aggregate centre bounds; grazing corners/ball radius and separate stump/bail geometry need a defined policy. Its clipping approximation is not a validated DRS uncertainty model.

**Fix:** locate events within the integration substep: first pitch contact, valid pad-surface contact, or swept ball-vs-wicket intersection. Store one event timestamp/location shared by path, marker, pad highlight, prediction, decision, and animation. Solve the exact stump-plane crossing for prediction rather than selecting the first point beyond it. Preserve distinct physical and counterfactual tracks. Handle duplicate event times explicitly without blending pre-impact velocity through a discontinuity.

Use the same pitch origin, dimensions, ball radius, and stump geometry in scene, backend, and tests. Rendering a thicker trail must not alter collision geometry. Define what constitutes a bail/stump hit separately from the educational uncertainty category. Unknown batting stance/shot/no-ball context must not silently produce an official match verdict.

### E. Preset labels and turf settings can contradict computed results

**Code:** sample_generator.py/get_all_preset_deliveries; ball_physics_engine.py/simulate_preset_trajectory and apply_pitch_restitution; DRSReview.js preset labels and parameter handlers.

**Measured:** all four default presets return their expected headline decision, but turf changes legitimately change outcomes. The preset named “Leg Break - Umpire's Call” returns NOT OUT/MISSING on green_seamer and OUT/HITTING on dry_dusty. Its default target is on the leg side, although its generator description says off bail. Fixed titles cannot be the source of truth.

The restitution model uses profile restitution/friction and a lateral contact kick; spin_grip is read but unused. The integrator comment calls the method Runge-Kutta, but the loop performs velocity-then-position Euler steps. These are model limits, not proof that all output values are wrong.

**Fix:** preserve named baseline educational examples and their expected default outcomes. Show a neutral delivery label plus the computed result after users change turf/RPM. Do not force OUT or Umpire's Call by rewriting verdict strings. Tune baseline launch/spin conditions against explicit geometric targets only after event calculations are corrected. Make turf material visibly match the selected profile, while deriving bounce and lateral response from that same profile. Add bounds and physical sanity checks; justify any stronger model using observed evidence, not comments about realism.

Guard parameter requests against stale responses, apply settings in demo and uploaded-to-demo flows, and clarify draft versus applied values so dragging an RPM control does not repeatedly restart a delivery. Keep upload-analysis geometry independent of simulation turf experiments.

### F. Vectors and telemetry contain fabricated fallback values and inconsistent spin

**Code:** HawkEyeViewer.js/currentTelemetry; PhysicsVectorsHUD.js/PhysicsVectorArrows and PhysicsTelemetryBadge; ball_physics_engine.py/calculate_instantaneous_forces; GhostTrajectoryOverlay.js/simulateGhostTrajectory.

- Viewer defaults include 35m/s forward velocity, Magnus vector, 0.42N lift, 0.85N drag, 2100RPM, and Reynolds number 172000. PhysicsVectorArrows supplies more defaults. Some `||` fallbacks replace legitimate zero values.
- The moving position interpolates, but telemetry picks a previous sample; the arrow/HUD can describe a different state from the ball.
- Preset spin direction vectors are not unit-normalized before multiplying by omega. Default inswinger advertises 2100RPM but initial vector telemetry yields 2038.7RPM. Offcutter advertises 1900RPM but yields 1784.9RPM.
- Zero vectors are given a visible upward direction/minimum arrow length rather than consistently omitted. Arrow lengths use separate visual scales, so they cannot be interpreted as a common quantitative scale without a legend.
- Ghost delivery physics is computed again in JavaScript using a different model. Divergence therefore combines delivery differences and model differences.

**Fix:** sample position, velocity, and telemetry together with correct handling of impact discontinuities. Use backend force vectors and consistent units; convert coordinates exactly once. Preserve zero; hide unavailable arrows and label unknown metrics. Normalize preset spin axes so requested RPM equals vector magnitude, then recalibrate baseline trajectories. For uploads, inferred speed/spin/forces must carry provenance; do not infer spin from a ball centre track alone.

Retain velocity/spin/gravity/Magnus controls and add drag/net force only if already exposed or needed to explain the existing force decomposition. Show units (m/s, N, RPM), arrow scale/normalization, and “Simulated” or “Model estimate.” Validate Fnet = gravity + drag + Magnus + seam, a = Fnet/m, speed = 3.6*|v|, drag opposing velocity, and Magnus perpendicular to spin/velocity within rounding tolerance. Model parameters remain empirical approximations even when these identities pass.

For ghost comparison, reuse the backend generator for the existing ghost presets or clearly identify the old ghost generator as a different model until migrated. Preserve every existing ghost option; do not silently compare inconsistent quantities as accuracy measurements.

### G. UltraEdge is currently a synthetic demonstration

**Code:** UltraEdgeVisualizer.js: impact inference around 39–80, synthesized cue around 83–159, sampleWaveform around 162–201, status labels around 440–476. HawkEyeViewer.js invokes it with trajectory/time but no audio source.

- It infers contact from a trajectory location, title keywords, or 68% of duration, then generates sinusoidal noise/transients and oscillator clicks.
- It displays labels such as “SPIKE DETECTED - BAT CONTACT” without analysing the uploaded sound.
- It has no source-media audio decode/analysis path. The existing in-app recorder explicitly records audio:false, so those clips cannot support acoustic evidence.
- The cue effect uses proximity to impact time without an isPlaying/seek contract, so scrubbing can emit synthetic cues.

**Fix in two explicit modes:**

1. **Simulation:** retain sensitivity, noise-floor experiments, bat/pad/clean scenarios, zoom, modes, scrubber, and optional synthesized cues. Clearly label the entire panel “Simulated audio demonstration.” Drive the event from simulation contact data, not filename/title heuristics. Playback alone may emit cues; pause/seeking must not create accidental sound. Replay resets predictably.
2. **Uploaded audio analysis:** read the actual source audio through the authorized media path. Start with browser decoding for supported short files using existing Web Audio APIs; handle unsupported containers explicitly. If supported-format extraction is needed server-side, check available tooling first and introduce only that bounded derivative path, with ownership controls and size/time limits. Do not add an audio server framework.

Cache decoded PCM/peaks per source, preserve sample rate/channel metadata and audio-to-video timestamp offset, build min/max peak envelopes at multiple zoom levels, and render using devicePixelRatio/ResizeObserver. Use the media timeline as the playhead; do not start a second independently advancing audio transport. Browser decodeAudioData resamples to the audio context's sample rate, so time mapping must use the decoded sample rate: [MDN decoding reference](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData).

Show raw waveform first; a filtered view must be labelled with its actual filter/settings. Compute candidate transients from measured local energy/noise characteristics rather than generating a spike at an expected contact time. Display “Audio transient — inspect video,” with a frame-synchronized zoom window. An audio spike alone does not establish bat versus pad/stump/ground/crowd contact. Do not output an edge verdict until labelled audiovisual data supports and validates that classifier.

Missing/silent/unsupported audio gets an honest unavailable state, not a flatline that asserts no contact. Keep the educational simulation accessible separately. For future recordings, offer an explicit microphone-enabled recording path and permission explanation; never imply previously silent clips contain recoverable sound.

## 4. UI changes tied to the marked screenshots

Keep the existing token system as the starting point; this fix is not another colour-only redesign.

- Reserve the viewer for video/ball/path. At desktop widths use a compact 280–320px inspector with Overview, Tracking, Physics, and Audio sections. Only the active section expands; diagnostics and exports remain discoverable secondary actions.
- Overview contains current source, tracking quality, and Pitching/Impact/Wickets. Show unverified/unavailable states; remove invented probability gauges and redundant “live/locked” badges.
- Use one primary action, Save review, with explicit permissions. Decision Flow and Delivery Report remain secondary. Keep all actual capabilities in a feature inventory before rearranging them.
- Keep four immediately visible camera choices and a More menu for cinematic modes. Provide Reset camera and clear Free Orbit/Follow Ball states. Do not imply every camera should move: static diagnostic views should still show the moving ball correctly.
- Dock Physics and Audio in a resizable/collapsible inspector or lower evidence panel, rather than stacking translucent boxes over the ball. At phone sizes use Video/3D tabs and a reachable evidence drawer.
- Display a short recent observed trail by default; full path, extrapolation, ghosts, and force vectors are optional layers with clear legends.
- Avoid auto-play of cinematic motion or synthesized audio. Respect reduced motion, keyboard focus, semantic selected/expanded states, and adequate contrast. Keep timeline/play/pause/frame step/rate controls visible at small and short viewport sizes.
- Playback looks like continuous real-time inspection of the uploaded file; show “Replay”/“Uploaded footage,” reserving “Live” for an implemented live-capture pipeline.

## 5. Work packages for your AI agents

The following assignments are a handoff plan, not agents started by this review. Give shared contract changes one owner. Agents should inspect the latest diff before starting because the tree already has user work.

| Package | Ownership and deliverables | Dependencies / gate |
|---|---|---|
| A — Playback/data owner | DRSReview; shared timestamp sampler; video overlay; source metadata round trips; replay discontinuity contract. Preserve existing duration/provenance improvements. | First: publish sample/event shape with physical versus predicted track, source ID, time, provenance, and null rules. |
| B — Physics owner | BallPhysicsEngine, DeliveryPhysicsSimulator, preset metadata, affected tests; exact bounce/pad/wicket events; spin normalization; turf sanity and computed labels. | Agree contracts with A. Publish a small response fixture before renderer work. |
| C — Scene owner | HawkEyeViewer, cameras, stumps, avatar, vectors, ghost consumer. Deterministic sampling, correct collision/prediction rendering, no fallback telemetry. | Uses A/B fixture. Verify default presets before tuning visuals. This owner alone edits HawkEyeViewer. |
| D — Audio owner | UltraEdgeVisualizer; source audio loading/analysis; supported derivative path only if necessary; audio tests. | Uses A's media time/source identity. C adds the prop wiring, avoiding concurrent edits to HawkEyeViewer. |
| E — UX/integration owner | Inspector/layout, responsive/accessibility pass, reports/commentary/exports, feature inventory, end-to-end evidence. | Runs after A–D integration; agrees DRSReview edits with A instead of concurrent rewrites. |

Suggested order: A/B contracts -> A/B fixes -> C/D implementation -> E integration and visual verification. Audio work and numerical physics work can proceed independently once their input contracts are agreed. Do not let multiple agents independently rewrite the shared playback clock, verdict logic, or scene entry component.

## 6. Acceptance checks that prove the fix

### Playback, scene, and layout

- A known-frame-number video fixture and representative cricket clips retain agreement between video time, overlay, 3D sample, telemetry, and audio cursor at 1x/0.5x/0.25x/0.1x. Instrument and report time difference; target <= one source frame under supported CFR playback.
- Pause, buffering, seek backward/forward, replay, rate changes, source switches, and Video -> Split -> 3D -> Split preserve correct media state. No autonomous drone/stump motion after pause. Seeking to the same time reproduces the same automatic scene state, including wicket effects.
- Verify every camera with the same sampled ball position, not separate motion approximations. Invalid coverage hides the tracked ball; predictions remain explicitly distinguishable.
- Preserve every existing feature and guest path in a before/after checklist. Capture screenshots at 375, 768, 1024, and 1440px; test keyboard-only and reduced-motion use. No inspector/toolbars obscure the active ball.

### Physics and vectors

- Exact event coordinates agree across backend events, rendered markers, collision meshes, decision display, and report/export. Check the ball radius at first turf contact and the exact y=10.06m wicket plane.
- Default baselines: inswinger shows pad contact plus predicted HITTING; offcutter shows actual off-stump/bail contact; bouncer misses without a false pad strike; legspin shows the intended, geometrically verified clipping example. If recalibration changes the baseline, update its documented parameters and meaningful tests together.
- Run all 16 preset/turf combinations and representative low/default/high supported RPM values. Physical outcomes may change; titles and reports must follow the computed outcome rather than forcing the preset label.
- Validate normalized RPM, vector identities, zero/missing vectors, signed directions, bounce energy bounds, no penetration, exact event interpolation, and convergence at finer integration steps. Do not confuse expected synthetic verdicts with real-world physical validation.
- Direct bowled collisions and misses behave correctly without depending on verdict text. LBW prediction never triggers real wicket destruction. Reset/seek replay the collision deterministically; random decorative bail impulses must be seeded per source/event or replaced with a fixed illustrative response.
- Test forces on known inputs and compare telemetry to the exact sampled ball state. A null upload force/spin remains unavailable in the view, commentary, JSON/CSV, and reports.

### Audio

- Unit fixtures: known-timestamp transient, clean/silent audio, stereo channels, different sample rates, audio/video start offset, missing audio, and decode error. Injected transient timing should recover within the defined analysis window; report the chosen tolerance.
- Source waveform is deterministic and does not change with simulation contact selectors. Zoom retains brief transients through min/max envelopes; resizing/DPR changes do not blur or shift time.
- Play/pause/seek/speed changes keep the waveform cursor locked to video without extra sound on scrubbing. Simulation cues remain opt-in and labelled.
- Assess candidate detection on labelled real cricket clips, with false positives/negatives and timing error reported. Until sufficient evidence exists, output candidate sound events rather than automatic BAT CONTACT or edge verdicts.

Extend existing backend/tests/test_ball_physics.py and relevant metadata tests, plus focused frontend pure-helper/lifecycle tests using the installed test runner. Run affected suites and the production build, then a browser walkthrough with actual uploaded audio/video. A build alone does not prove motion, collision, or acoustic accuracy.

## 7. Copy-paste handoff prompt

> Implement docs/SCREENSHOT_FEEDBACK_FIX_PLAN.md, using the earlier UI_UX_AND_HAWKEYE_SYNC_PLAN.md for supporting layout details only where it matches current source. Preserve existing uncommitted work and every current feature, including continue without account. Start with a single replay contract and exact physics events. Fix media-to-3D synchronization, deterministic camera/effect replay, pad-versus-wicket geometry, truthful vector telemetry, and surface-dependent preset outputs. Preserve LBW as pad interception plus a separately labelled predicted wicket path; actual bowled requires a real collision. Replace uploaded-footage synthetic UltraEdge evidence with source-audio inspection while retaining the labelled simulation. Reorganize the crowded inspector using Impeccable/UI-UX guidance after correctness is established. Use the package ownership/dependencies in section 5 to avoid concurrent rewrites of shared files. Complete the acceptance checks and provide measured results and before/after screenshots; report model, audio, calibration, and codec limits plainly.

## 8. Limits to keep explicit

No detector retraining, true multi-camera Hawk-Eye reconstruction, certified UltraEdge classification, arbitrary live-stream architecture, or broad dependency migration is required. Smooth replay and internally consistent physics are achievable here; accurate real-world 3D and automatic acoustic edge classification require calibrated footage and labelled validation evidence.
