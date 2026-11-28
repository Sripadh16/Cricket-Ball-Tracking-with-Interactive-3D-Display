---
title: Crease / Lab production readiness
date: 2026-11-28
type: feat
origin: docs/PROJECT_CONTEXT_AND_ROADMAP.md
---

# Crease / Lab production readiness

Preserve the offline educational simulation and improve uploaded footage as an evidence review. Keep each change reversible. The original `codex/demo-studio` branch starts at `200b9f7`. The implementation branch has a documentation checkpoint at `2ef68d6`. Record an audit and use a path-limited commit for each verified phase. Git can revert application files; database migrations require backups and their own recovery instructions.

| Phase | Implementation | Acceptance evidence |
| --- | --- | --- |
| 0. Repeatable baseline | Align test commands, pin direct backend dependencies, check bundled physics data against its generator, and run clean installs, build and tests in CI. Bound failures in the fixture browser harness. | Run the replay freshness check, frontend build and tests, and backend suites where the installed environment supports them. Validate workflow and browser harness configuration. |
| 1. Hosted footage foundation | Establish a same-origin container path, versioned schema upgrades and meaningful readiness. Require deployment secrets, replace general session tokens in media URLs with clip-scoped tickets, add resource limits and use tested range responses. | Validate fresh and upgraded data, same-origin routes, owner-only media, ticket expiry, no-cache behavior, invalid media and range handling. Record the difference between local results and packaged end-to-end results. |
| 2. Reliable analysis jobs | Persist job state and use atomic claims, bounded processing, recovery and retry. Keep prior valid results visible during retries. Serialize calibration and deletion with processing and preserve recoverability when database or storage operations fail. | Test restart, duplicate claims, simultaneous mutations, old result retention and idempotent deletion across supported stores. |
| 3. Guided review | Put source-only, candidates and fitted flight states up front. Show tracking coverage, retry, and guidance. Give event jumps and waveform inspection accessible controls. Keep calibrated and projected evidence distinct in UI and exports. | Test pending, failure, partial-track and 3D review, keyboard navigation, source switching and mobile widths. Check simulation playback and no-verdict behavior. |
| 4. Returning users and measurement | Add private review routes and saved assessment history, allow a guest to keep a workspace, and remove avoidable library media requests. Add a reproducible tracking benchmark workflow and establish performance baselines. | Verify refresh and private links, guest promotion and expiry, dated assessment history, responsive library requests and instrumented timing. Judge detector improvements against independently labeled clips. |

Real-clip accuracy and participant outcomes depend on access to consented footage, independent ground truth and pilot users. The repository changes can provide tooling and workflows for that validation. Production traffic and external publication require a separate release decision. Local audits record commands, results and limits after each phase.

## Phase 0 audit

- The phase changes dependency declarations, CI, developer commands and verification. Application behavior and generated replay data are unchanged. The direct Python dependency versions resolve in the local package-index dry run; transitives still resolve at install time.
- The fixture upload test passed through guest creation, real tracking, trajectory retrieval, HTTP range playback and deletion. All 28 frontend tests and the four bundled-replay checks passed.
- Chrome passed the fixture audit at every configured size from 375 to 1920 pixels. The largest difference between displayed time and presented-frame time was 3 ms over 32 samples. The harness now fails with a named timeout rather than waiting indefinitely for a debugger command. The Chrome run required host loopback access.
- Workflow YAML and the browser script passed syntax checks. GitHub CI still needs its first run. This phase does not establish field tracking accuracy or PostgreSQL deployment behavior.
- The Phase 0 full backend run later completed with 114 passed and four fixture-dependent skips. Its production frontend build passed.

## Phase 1 audit

- The root Compose path now builds the API and a static same-origin frontend, with private PostgreSQL and explicit deployment secrets. SQLite remains available for local development. Schema startup checks and the migration test preserve current SQLite data. The legacy PostgreSQL upgrade runs in a transaction and is covered by a CI service test pending execution.
- Workspace bearer tokens were removed from media URLs. The API issues 30-minute, clip-scoped tickets, checks ownership, uses standard Range and HEAD handling, and sets media cache controls. Library rows use lightweight icons. Native playback can request a replacement ticket from the review.
- Upload probes reject corrupt, oversized or over-resolution inputs and known clips over the duration limit. File names on disk use generated IDs. Source audio inspection caps downloaded media at 25 MB. Quota checks, upload admission and job scheduling will be made atomic in Phase 2.
- The playback regression failed before implementation and passed after. The local API and schema run reported 20 passed and one PostgreSQL skip. During the self-audit I fixed an import-order issue that sent the test worker to a different database than its API requests. Frontend verification passed 29 tests and built successfully. Compose configuration and the production-secret rejection check passed. The local Docker engine was unavailable, so the container build and proxy workflow still need a packaged run.

## Phase 2 audit

- Persistent queue, lease recovery, bounded claims, atomic publication and recoverable media deletion are implemented. Expired workers cannot renew or publish. Failed replacement analysis retains the previous trajectory.
- Review polling preserves saved evidence during retry, displays failure without discarding the saved result, and retries temporary connection failures.
- Local targeted backend verification: 26 passed, one PostgreSQL skip. Earlier full backend run: 114 passed, five skipped (before the final regression additions). Frontend: 31 tests across ten suites passed; production build succeeded with existing dependency source-map and Browserslist warnings.
- Active-job mutation regression covers duplicate reprocessing, calibration and deletion rejection while previous analysis remains readable. PostgreSQL concurrency and packaged deployment remain unverified.

## Phase 3 audit

- Evidence classification, candidate coverage, retry while retaining prior evidence, event navigation, audio-marker controls and evidence-aware exports implemented.
- Frontend: 35 tests in ten suites passed; production build passed. Existing Chrome fixture audit passed offline simulation, library, review, camera toolbar, mobile overflow and explicit reviewer outcome, with no uncaught exceptions. Maximum timestamp error 3 ms across 32 fixture samples at 1x, 0.5x, 0.25x and 0.1x. This does not measure real-world detector accuracy or establish full accessibility compliance.
