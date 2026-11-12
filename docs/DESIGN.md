# DESIGN.md — Crease / Lab: Video Analysis Workspace

Date: 2026-11-12
Direction: Precision video-analysis desk, task-oriented, educational tool (not certified umpiring system)

## Design tokens

| Token | Value |
|---|---|
| App background | `#101318` (graphite workspace) |
| Panel | `#181d25` / `#181d25` |
| Elevated panel | `#202733` |
| Main text | `#f2f5f9` |
| Secondary text | `#adb8c7` |
| Primary action | `#8ab4ff` with `#101318` text (blue action accent) |
| Observed ball trail | `#F6D365` (plan: cricket-yellow) |
| Tracking available | `#8ab4ff` or neutral label |
| Tracking uncertain | Amber `#dfbd83` |
| Error | `#e89583` |
| Typography | Segoe UI/system; monospace for time + measurements |
| Border radius | 6–10px |
| Spacing scale | 4, 8, 12, 16, 24, 32px |

## Layout targets

- **≥1280px desktop**: Split view (video + 3D) with ~300px inspector aside. Shared timeline at bottom.
- **768–1279px tablet**: Inspector collapses to drawer/below; viewers share remaining width.
- **<768px mobile**: One viewer at a time (Video/3D tab strip), timeline always reachable.

## Hierarchy rules

1. Task first: upload and review are primary. Simulation lab is clearly secondary.
2. Inspector default: tracking quality, Pitching, Impact, Wickets — all may be "Unavailable."
3. Advanced features (exports, diagnostics, force vectors, avatars, themes) go into labelled secondary sections.
4. No decorative gradients, glass panels, or all-caps telemetry walls inside the workspace.
5. Simulation data always carries a "Simulated" label. Missing real-upload metrics stay null/unavailable.

## Coordinate space contract

Backend: x lateral, y down pitch, z height
Three.js mapping: (x, z, y)
Pixel coords: stored pixel_x/pixel_y in source video frame pixels
Overlay mapping: source pixels → contain-rectangle scale + letterbox offset

## Synchronization

- One media clock for uploads: requestVideoFrameCallback where available, rAF fallback.
- Simulation has a separate animation clock — isolated from video paths.
- One shared `sampleTrajectoryAtTime` helper used by video overlay and 3D viewer.
- Full video duration from `loadedmetadata`; tracking interval stored separately as `tracking_start_s` / `tracking_end_s`.

## Status vocabulary

- **Tracking available**: ball detected in this region of the video.
- **Tracking uncertain**: predicted/interpolated, clearly labelled.
- **No tracking**: before first detection or after last — marker hidden.
- **Unavailable**: real upload metric not available from single-camera uncalibrated footage.
- **Approximate reconstruction**: 3D positions derived from heuristic single-camera geometry.

## Verified UI implementation — 2026-11-12

- Continue without account is explicit and opens the existing simulation path.
- Upload is primary; simulation remains available as a secondary task.
- Review controls use four primary camera options, More cameras, and expandable measurements/tools.
- Uploaded Video/Split/3D layouts retain one media element and one video-frame callback clock, with a media-currentTime fallback.
- Source-pixel overlay and 3D ball share the trajectory sampler; unknown coverage hides the moving marker.
- Review assessment starts unselected. Reports describe educational analysis, with unavailable metrics preserved.
- Scene/review code loads separately from the entry page. No dependencies were added.
- See UI_UX_IMPLEMENTATION_AUDIT.md for the tested scope and remaining calibration/media limitations.

### Verification result

The isolated production build and all nine focused tests pass. Headless Chromium checks at 375/768/1024/1440px pass. On the synthetic 30fps fixture, the displayed timeline differed from the presented-frame timestamp by at most 3ms in 32 samples across four playback rates. This is a rounded UI-time measurement, not a real-world tracking or calibration accuracy claim. See docs/ui-audit/results.json and UI_UX_IMPLEMENTATION_AUDIT.md for traces and remaining gates.
