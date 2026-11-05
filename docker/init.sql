-- Database initialization for DRS (PostgreSQL Docker path)
-- ============================================================
-- STATUS: UNVERIFIED for production use. The primary documented setup
-- path is SQLite (run locally without Docker). This schema is provided
-- for reference only. Before using Docker, verify this file matches
-- the current ORM models (backend/src/models/).
--
-- Schema matches ORM models as of 2026-11-04:
--   models/user.py, models/video.py, models/trajectory.py, models/review_session.py
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── users ──────────────────────────────────────────────────────────────────
-- Matches: models/user.py  (String PK, username, email, hashed_password, is_active)
CREATE TABLE IF NOT EXISTS users (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username            VARCHAR(255) UNIQUE NOT NULL,
    email               VARCHAR(255) UNIQUE,
    hashed_password     VARCHAR(255) NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── videos ─────────────────────────────────────────────────────────────────
-- Matches: models/video.py  (user_id string, filename, file_path, status, file_size)
-- NOTE: user_id is a plain String (no FK) so anonymous uploads work.
CREATE TABLE IF NOT EXISTS videos (
    id                          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id                     VARCHAR(255) NOT NULL,
    filename                    VARCHAR(255) NOT NULL,
    file_path                   VARCHAR(500) NOT NULL,
    file_size                   INTEGER,
    duration                    FLOAT,
    resolution                  VARCHAR(20),
    status                      VARCHAR(20) DEFAULT 'uploaded',
    upload_date                 TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processing_started_at       TIMESTAMP WITH TIME ZONE,
    processing_completed_at     TIMESTAMP WITH TIME ZONE
);

-- ── trajectories ───────────────────────────────────────────────────────────
-- Matches: models/trajectory.py  (video_id FK, points JSON, additional_data JSON)
CREATE TABLE IF NOT EXISTS trajectories (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    video_id            VARCHAR(36) NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    points              TEXT,          -- JSON array of {x,y,z,t,confidence,is_predicted}
    timestamps          TEXT,          -- JSON array
    confidence_score    FLOAT DEFAULT 0,
    ball_detected       BOOLEAN DEFAULT false,
    additional_data     TEXT,          -- JSON: all DRS fields (stumps, lbw, debug_info, etc.)
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── review_sessions ────────────────────────────────────────────────────────
-- Matches: models/review_session.py
CREATE TABLE IF NOT EXISTS review_sessions (
    id                  VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
    video_id            VARCHAR(36) NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id             VARCHAR(255) NOT NULL,
    decision            VARCHAR(100),
    notes               TEXT,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ── indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_videos_user_id       ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status         ON videos(status);
CREATE INDEX IF NOT EXISTS idx_trajectories_video_id ON trajectories(video_id);
CREATE INDEX IF NOT EXISTS idx_reviews_video_id      ON review_sessions(video_id);

-- ── default admin user (password: admin123) ────────────────────────────────
-- Hash generated with bcrypt 12 rounds. Change before any non-local use.
INSERT INTO users (username, email, hashed_password)
VALUES (
    'admin',
    'admin@drs.local',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6fMmiLpBqG'
)
ON CONFLICT (username) DO NOTHING;
