# DRS - Cricket Decision Review System

Upload a delivery, get the ball's tracked path, a 3-D replay you can orbit, and a simplified
LBW read-out. Classical computer vision only - no trained model, no calibration rig, no
broadcast camera array.

The backend is a FastAPI service that runs the tracking pipeline over an uploaded clip and
stores the resulting trajectory. The frontend is a React review console that plays the clip
next to a Three.js reconstruction of the pitch, stumps, and ball path.

![DRS login screen](docs/screenshot.png)

## What it does

- **Video library** - upload MP4, MOV, AVI, MKV, or WEBM clips (500 MB default cap). Files are
  stored on disk, metadata and processing status in the database, and tracking starts
  automatically on upload.
- **Ball detection** - per-frame detection that fuses HSV colour thresholding, frame-difference
  motion, and shape/circularity checks, with a short-horizon position prediction that bridges
  frames where the ball is momentarily lost.
- **Scene understanding** - pitch boundaries from a green HSV mask and contour analysis; stumps
  located by four independent strategies (edge, colour, template, shape) whose candidates are
  clustered into a single stump line; rough bowler and batter positions from motion and contours.
- **Trajectory clean-up** - outlier rejection, Kalman smoothing, and a pixel-to-3-D lift that
  uses the configured pitch dimensions and camera model, plus a per-trajectory confidence score.
- **LBW read-out** - for each trajectory point: distance to the stumps, an in-line check between
  batter and stumps, and an OUT / NOT OUT call with a likelihood value. Intentionally simple; see
  [Scope and limitations](#scope-and-limitations).
- **Review console** - video, split, and 3-D playback modes, variable playback speed, frame
  scrubbing, and four fixed camera angles in the 3-D view (umpire, side, bowler, aerial).
- **Optional accounts** - email/password registration with JWT sessions. Uploads work anonymously
  too; a clip is tied to a user only when a token is present.

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy, OpenCV, NumPy |
| Auth | JWT via python-jose, bcrypt hashing via passlib |
| Frontend | React 18, MUI 5, Three.js with react-three-fiber and drei |
| Database | SQLite by default; PostgreSQL when `DATABASE_URL` points at one |
| Infrastructure | Docker, Docker Compose, Makefile helpers |

## Getting started

Requirements: Python 3.11+, Node.js 18+.

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # optional - the defaults run out of the box
python run_server.py          # http://localhost:8000, interactive docs at /docs
```

With no `DATABASE_URL` set, the API creates a SQLite file at `backend/drs.db` and writes uploads
to `uploads/` at the repository root.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env          # REACT_APP_API_BASE_URL defaults to http://localhost:8000
npm start                     # http://localhost:3000
```

From the repository root, `make install` installs both sides and `make dev` starts both servers
together. `make help` lists the available targets.

### Docker

```bash
docker-compose up -d
```

This brings up PostgreSQL, the API on port 8000, and the frontend dev server on port 3000
(Redis, nginx, and MinIO services are also defined but are not required by the app).
See [`docker/README.md`](docker/README.md) for details.

If your compose profile mounts `docker/ssl`, generate a local self-signed certificate first;
see [`docker/ssl/README.md`](docker/ssl/README.md) for the one-liner. Certs are gitignored and
must not be committed.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account, returns a JWT |
| `POST` | `/auth/login` | Log in with email and password |
| `POST` | `/auth/token` | OAuth2 password-grant token endpoint |
| `GET` | `/auth/me` | Current user |
| `GET` | `/videos/` | List videos (the caller's, or all when anonymous) |
| `POST` | `/videos/upload` | Upload a clip and run tracking |
| `POST` | `/videos/{id}/track` | Run tracking on an existing clip |
| `POST` | `/videos/{id}/reprocess` | Discard the stored trajectory and track again |
| `GET` | `/videos/{id}/trajectory` | Trajectory points, stumps, players, and LBW analysis |
| `DELETE` | `/videos/{id}` | Delete a clip and its derived data |
| `POST` | `/reviews/` | Save a review session against a clip |
| `GET` | `/reviews/{id}` | Fetch a review session |
| `GET` | `/health` | Health check |

## Project structure

```
backend/
  run_server.py              # entry point
  src/
    main.py                  # FastAPI app, routers, static uploads mount
    config.py                # env-driven settings: paths, JWT, pitch and tracking constants
    api/                     # videos, reviews, auth routers
    services/
      ball_tracking_service.py   # the whole CV pipeline
      video_service.py, review_service.py, auth_service.py
    models/                  # SQLAlchemy models: user, video, trajectory, review_session
frontend/
  src/
    pages/                   # AuthPage, Dashboard, DRSReview
    components/HawkEyeViewer.js  # Three.js pitch, stumps, and trajectory
    api/client.js            # axios instance with token interceptor
docker/                      # per-service Dockerfiles, nginx config, helper script
specs/                       # feature spec, data model, API contract, and plan
```

## Scope and limitations

- The pipeline is tuned for a reasonably steady camera behind the stumps and a ball that stands
  out against the pitch. Cluttered, shaky, or low-contrast footage degrades detection.
- 3-D positions are derived from the assumed pitch dimensions, camera height, camera angle, and
  focal length in `backend/src/config.py` rather than from a calibration step, so depth is
  approximate.
- Only the first `MAX_PROCESSING_FRAMES` frames of a clip are analysed (default 300).
- The LBW output is a proximity and in-line heuristic, not an implementation of ICC Rule 36. This
  is a learning and review tool, not a certified officiating system, and it is not affiliated
  with the ICC or Hawk-Eye.

## License

MIT - see [LICENSE](LICENSE).
