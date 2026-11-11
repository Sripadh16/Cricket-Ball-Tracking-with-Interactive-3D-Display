"""
Isolated API endpoint tests with an isolated temp-file SQLite database.
Each test session gets a fresh DB so production data is never touched.
Tests presets, authentication, two-user ownership isolation, secure media streaming,
reprocess atomicity, unverified event suppression, and password hash migration.
"""
import pytest
import sys
import os
import tempfile
import uuid
import bcrypt
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

# ---------------------------------------------------------------------------
# Point DATABASE_URL at a fresh temp file BEFORE any src import.
# ---------------------------------------------------------------------------
_tmp_db_fd, _tmp_db_path = tempfile.mkstemp(suffix=".db", prefix="drs_test_")
os.close(_tmp_db_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db_path}"

from sqlalchemy import create_engine       # noqa: E402
from sqlalchemy.orm import sessionmaker    # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from database import Base                  # noqa: E402
import main as _main_module                # noqa: E402
from models.user import User               # noqa: E402
from models.video import Video             # noqa: E402
from models.trajectory import Trajectory   # noqa: E402
from models.review_session import ReviewSession  # noqa: E402
from services.auth_service import AuthService  # noqa: E402
from services.ball_tracking_service import BallTrackingService  # noqa: E402

# Re-create engine pointing at the temp file and create tables
_test_engine = create_engine(
    os.environ["DATABASE_URL"], connect_args={"check_same_thread": False}
)
Base.metadata.create_all(bind=_test_engine)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=_test_engine)

from database import get_db                # noqa: E402

def _override_get_db():
    db = _TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

_main_module.app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(scope="session")
def client():
    """FastAPI test client backed by an isolated temp-file SQLite database."""
    return TestClient(_main_module.app)


@pytest.fixture(scope="session")
def test_users(client):
    """Create two test users (User A and User B) and return their tokens and IDs."""
    db = _TestingSessionLocal()
    auth_svc = AuthService(db)

    # Register User A
    user_a = User(
        email="usera@test.com",
        name="User A",
        hashed_password=auth_svc.get_password_hash("PasswordA123!")
    )
    db.add(user_a)
    db.commit()
    db.refresh(user_a)
    user_a_id = user_a.id
    user_a_email = user_a.email
    token_a = auth_svc.create_access_token({"sub": "usera@test.com"})

    # Register User B
    user_b = User(
        email="userb@test.com",
        name="User B",
        hashed_password=auth_svc.get_password_hash("PasswordB123!")
    )
    db.add(user_b)
    db.commit()
    db.refresh(user_b)
    user_b_id = user_b.id
    user_b_email = user_b.email
    token_b = auth_svc.create_access_token({"sub": "userb@test.com"})

    db.close()
    return {
        "user_a": {"id": user_a_id, "email": user_a_email, "token": token_a, "headers": {"Authorization": f"Bearer {token_a}"}},
        "user_b": {"id": user_b_id, "email": user_b_email, "token": token_b, "headers": {"Authorization": f"Bearer {token_b}"}},
    }


# ─── Public Presets Tests ─────────────────────────────────────────────────────

def test_api_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "running"


def test_guest_auth_endpoint(client):
    """Guest authentication provisions or returns a guest access token seamlessly."""
    response = client.post("/auth/guest")
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

    # Verify the guest token can access authenticated routes
    headers = {"Authorization": f"Bearer {data['access_token']}"}
    resp = client.get("/videos/", headers=headers)
    assert resp.status_code == 200
    assert "videos" in resp.json()


def test_get_preset_deliveries(client):
    """Presets remain accessible without authentication."""
    response = client.get("/videos/presets")
    assert response.status_code == 200
    data = response.json()
    assert "presets" in data
    assert len(data["presets"]) == 4
    preset_ids = [p["id"] for p in data["presets"]]
    assert "inswinger_lbw" in preset_ids
    assert "bouncer_missing" in preset_ids


def test_get_preset_trajectory_inswinger(client):
    """Preset trajectory remains accessible without authentication."""
    response = client.get("/videos/presets/inswinger_lbw")
    assert response.status_code == 200
    data = response.json()
    assert data["ball_detected"] is True
    assert len(data["points"]) > 20
    assert data["drs_evaluation"]["decision"] == "OUT"
    assert data["drs_evaluation"]["pitching"] == "IN LINE"
    assert data["drs_evaluation"]["impact"] == "IN LINE"
    assert data["drs_evaluation"]["wickets"] == "HITTING"


def test_preset_trajectory_has_required_fields(client):
    """All required DRS fields must be present in a preset trajectory response."""
    for preset in ["inswinger_lbw", "bouncer_missing", "legspin_umpires_call", "offcutter_bowled"]:
        resp = client.get(f"/videos/presets/{preset}")
        assert resp.status_code == 200, f"Preset {preset} returned {resp.status_code}"
        data = resp.json()
        for field in ["points", "timestamps", "confidence_score", "ball_detected"]:
            assert field in data, f"Missing field '{field}' in preset '{preset}'"
        assert data.get("drs_evaluation") is not None, f"No drs_evaluation for '{preset}'"
        assert "decision" in data["drs_evaluation"]


# ─── Finding 1: Authentication & Ownership Verification ──────────────────────

def test_anonymous_video_routes_return_401(client):
    """All private video and review endpoints must reject unauthenticated requests with 401."""
    fake_id = str(uuid.uuid4())
    assert client.get("/videos/").status_code == 401
    assert client.get(f"/videos/{fake_id}/trajectory").status_code == 401
    assert client.delete(f"/videos/{fake_id}").status_code == 401
    assert client.post(f"/videos/{fake_id}/reprocess").status_code == 401
    assert client.post(f"/videos/{fake_id}/track").status_code == 401
    assert client.get(f"/videos/{fake_id}/stream").status_code == 401
    assert client.get(f"/reviews/{fake_id}").status_code == 401
    assert client.post("/reviews/", json={"video_id": fake_id, "decisions": []}).status_code == 401


def test_invalid_tokens_rejected_with_401(client):
    """Invalid or expired tokens must be rejected with 401 and not downgraded to anonymous."""
    bad_headers = {"Authorization": "Bearer completely-invalid-jwt-token"}
    resp = client.get("/videos/", headers=bad_headers)
    assert resp.status_code == 401
    assert "detail" in resp.json()

    resp_stream = client.get(f"/videos/{uuid.uuid4()}/stream?token=invalid-token")
    assert resp_stream.status_code == 401


def test_video_list_and_trajectory_with_auth(client, test_users):
    """Authenticated user can list videos and query trajectory."""
    headers_a = test_users["user_a"]["headers"]
    resp = client.get("/videos/", headers=headers_a)
    assert resp.status_code == 200
    assert "videos" in resp.json()

    # Trajectory for non-existent video returns 404 for authenticated user
    fake_id = str(uuid.uuid4())
    resp = client.get(f"/videos/{fake_id}/trajectory", headers=headers_a)
    assert resp.status_code == 404


def test_two_user_video_ownership_isolation(client, test_users):
    """User B must be forbidden (403) from accessing or modifying User A's videos."""
    db = _TestingSessionLocal()
    user_a = test_users["user_a"]
    user_b = test_users["user_b"]

    # Create video record for User A
    video_a = Video(
        id=str(uuid.uuid4()),
        user_id=user_a["id"],
        filename="user_a_match.mp4",
        file_path="/tmp/fake_match.mp4",
        status="processed",
        duration=5.0
    )
    db.add(video_a)
    db.commit()

    # Add trajectory for video_a
    traj_a = Trajectory(
        id=str(uuid.uuid4()),
        video_id=video_a.id,
        points=[{"x": 0.0, "y": 0.0, "z": 1.0, "t": 0.0, "is_predicted": False}],
        timestamps=[0.0],
        confidence_score=0.95,
        ball_detected=True,
        additional_data={
            "debug_info": {"frames_processed": 30, "ball_detections": 28},
            "video_info": {"fps": 30.0, "frame_count": 30, "width": 1280, "height": 720}
        }
    )
    db.add(traj_a)
    db.commit()
    db.close()

    # 1. User A lists videos: sees video_a
    resp_a = client.get("/videos/", headers=user_a["headers"])
    assert resp_a.status_code == 200
    assert any(v["id"] == video_a.id for v in resp_a.json()["videos"])

    # 2. User B lists videos: does NOT see video_a
    resp_b = client.get("/videos/", headers=user_b["headers"])
    assert resp_b.status_code == 200
    assert not any(v["id"] == video_a.id for v in resp_b.json()["videos"])

    # 3. User A can get trajectory with observable debug_info (Finding 6)
    resp_traj_a = client.get(f"/videos/{video_a.id}/trajectory", headers=user_a["headers"])
    assert resp_traj_a.status_code == 200
    data_a = resp_traj_a.json()
    assert "debug_info" in data_a
    assert data_a["debug_info"]["frames_processed"] == 30
    assert data_a["video_info"]["fps"] == 30.0

    # 4. User B cannot read trajectory (403 Forbidden)
    resp_traj_b = client.get(f"/videos/{video_a.id}/trajectory", headers=user_b["headers"])
    assert resp_traj_b.status_code == 403

    # 5. User B cannot reprocess User A's video (403 Forbidden)
    resp_reproc_b = client.post(f"/videos/{video_a.id}/reprocess", headers=user_b["headers"])
    assert resp_reproc_b.status_code == 403

    # 6. User B cannot run track on User A's video (403 Forbidden)
    resp_track_b = client.post(f"/videos/{video_a.id}/track", headers=user_b["headers"])
    assert resp_track_b.status_code == 403

    # 7. User B cannot delete User A's video (403 Forbidden)
    resp_del_b = client.delete(f"/videos/{video_a.id}", headers=user_b["headers"])
    assert resp_del_b.status_code == 403


def test_video_streaming_endpoint(client, test_users):
    """GET /videos/{id}/stream verifies ownership via Bearer header or ?token= query param."""
    db = _TestingSessionLocal()
    user_a = test_users["user_a"]
    user_b = test_users["user_b"]

    # Create dummy video media file
    temp_media = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    temp_media.write(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00")
    temp_media.close()

    video = Video(
        id=str(uuid.uuid4()),
        user_id=user_a["id"],
        filename="stream_test.mp4",
        file_path=temp_media.name,
        status="processed"
    )
    db.add(video)
    db.commit()
    db.close()

    try:
        # User A via Bearer header
        resp_a = client.get(f"/videos/{video.id}/stream", headers=user_a["headers"])
        assert resp_a.status_code == 200
        assert resp_a.headers["content-type"] == "video/mp4"

        # User A via ?token= query parameter (HTML5 video tag)
        resp_query = client.get(f"/videos/{video.id}/stream?token={user_a['token']}")
        assert resp_query.status_code == 200

        # User B via ?token= is forbidden (403)
        resp_b = client.get(f"/videos/{video.id}/stream?token={user_b['token']}")
        assert resp_b.status_code == 403

        # Anonymous stream access rejected (401)
        resp_anon = client.get(f"/videos/{video.id}/stream")
        assert resp_anon.status_code == 401
    finally:
        if os.path.exists(temp_media.name):
            os.remove(temp_media.name)


def test_video_diagnostics_endpoint(client, test_users):
    """Diagnostics endpoint returns CV observable metrics with two-user ownership isolation."""
    db = _TestingSessionLocal()
    user_a = test_users["user_a"]
    user_b = test_users["user_b"]

    video = Video(
        id=str(uuid.uuid4()),
        user_id=user_a["id"],
        filename="cv_diag_test.mp4",
        file_path="/tmp/cv_diag_test.mp4",
        status="processed"
    )
    db.add(video)
    db.commit()

    traj = Trajectory(
        id=str(uuid.uuid4()),
        video_id=video.id,
        points=[
            {"x": 0.0, "y": 1.0, "z": 0.5, "t": 0.0, "is_predicted": False, "confidence": 0.92, "pixel_x": 320, "pixel_y": 180},
            {"x": 0.0, "y": 2.0, "z": 0.6, "t": 0.1, "is_predicted": False, "confidence": 0.90, "pixel_x": 325, "pixel_y": 190},
            {"x": 0.0, "y": 3.0, "z": 0.7, "t": 0.2, "is_predicted": True, "confidence": 0.75, "pixel_x": 330, "pixel_y": 200},
        ],
        timestamps=[0.0, 0.1, 0.2],
        confidence_score=0.91,
        ball_detected=True,
        additional_data={
            "debug_info": {"frames_processed": 3, "ball_detections": 2, "pitch_detected": True, "stumps_detected": True},
            "video_info": {"fps": 30.0, "width": 1280, "height": 720}
        }
    )
    db.add(traj)
    db.commit()
    db.close()

    # 1. Anonymous access -> 401
    assert client.get(f"/videos/{video.id}/diagnostics").status_code == 401

    # 2. User B access -> 403 Forbidden
    resp_b = client.get(f"/videos/{video.id}/diagnostics", headers=user_b["headers"])
    assert resp_b.status_code == 403

    # 3. User A access -> 200 with diagnostics
    resp_a = client.get(f"/videos/{video.id}/diagnostics", headers=user_a["headers"])
    assert resp_a.status_code == 200
    diag = resp_a.json()
    assert diag["video_id"] == video.id
    assert diag["measured_points"] == 2
    assert diag["predicted_points"] == 1
    assert diag["total_trajectory_points"] == 3
    assert diag["measured_ratio"] == 0.667
    assert diag["pitch_detected"] is True
    assert diag["stumps_detected"] is True


def test_review_ownership_isolation(client, test_users):
    """Reviews enforce ownership on creation and retrieval."""
    db = _TestingSessionLocal()
    user_a = test_users["user_a"]
    user_b = test_users["user_b"]

    video = Video(
        id=str(uuid.uuid4()),
        user_id=user_a["id"],
        filename="review_test.mp4",
        file_path="/tmp/fake_review.mp4",
        status="processed"
    )
    db.add(video)
    db.commit()
    db.close()

    # User B cannot create review for User A's video (403)
    resp_b = client.post(
        "/reviews/",
        headers=user_b["headers"],
        json={"video_id": video.id, "decisions": [{"type": "LBW", "outcome": "OUT", "timestamp": 1.2, "confidence": 0.9}]}
    )
    assert resp_b.status_code == 403

    # User A can create review for own video (200)
    resp_a = client.post(
        "/reviews/",
        headers=user_a["headers"],
        json={"video_id": video.id, "decisions": [{"type": "LBW", "outcome": "OUT", "timestamp": 1.2, "confidence": 0.9}], "notes": "Clear LBW"}
    )
    assert resp_a.status_code == 200
    review_id = resp_a.json()["id"]

    # User B cannot read User A's review (403)
    resp_get_b = client.get(f"/reviews/{review_id}", headers=user_b["headers"])
    assert resp_get_b.status_code == 403

    # User A can read own review (200)
    resp_get_a = client.get(f"/reviews/{review_id}", headers=user_a["headers"])
    assert resp_get_a.status_code == 200
    assert resp_get_a.json()["notes"] == "Clear LBW"


# ─── Finding 3: Reprocess Atomic Rollback on Persistence Failure ──────────────

def test_reprocess_atomic_rollback_on_failure(client, test_users):
    """If persistence fails during reprocess, the old trajectory must survive and status remains processed."""
    db = _TestingSessionLocal()
    user_a = test_users["user_a"]

    # Create dummy video media file
    temp_media = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
    temp_media.write(b"dummy_mp4_bytes")
    temp_media.close()

    video = Video(
        id=str(uuid.uuid4()),
        user_id=user_a["id"],
        filename="reprocess_test.mp4",
        file_path=temp_media.name,
        status="processed"
    )
    db.add(video)
    db.commit()

    old_traj_id = str(uuid.uuid4())
    old_traj = Trajectory(
        id=old_traj_id,
        video_id=video.id,
        points=[{"x": 1.0, "y": 2.0, "z": 3.0, "t": 0.1}],
        confidence_score=0.88,
        ball_detected=True,
        additional_data={"lbw_analysis": ["ORIGINAL_TRAJECTORY"]}
    )
    db.add(old_traj)
    db.commit()
    db.close()

    # Mock BallTrackingService.track_ball to succeed, but simulate DB persistence failure
    dummy_track_result = {
        "points": [{"x": 9.0, "y": 9.0, "z": 9.0, "t": 0.5}],
        "timestamps": [0.5],
        "confidence_score": 0.99,
        "ball_detected": True,
        "additional_data": {"lbw_analysis": ["NEW_FAILED_TRAJECTORY"]}
    }

    try:
        with patch.object(BallTrackingService, "track_ball", return_value=dummy_track_result):
            # Patch _build_additional_data to raise an exception during replacement preparation
            with patch("api.videos._build_additional_data", side_effect=RuntimeError("Simulated DB persistence failure")):
                resp = client.post(f"/videos/{video.id}/reprocess", headers=user_a["headers"])
                assert resp.status_code == 500

        # Verify old trajectory survived and video status is still 'processed'
        verify_db = _TestingSessionLocal()
        persisted_traj = verify_db.query(Trajectory).filter(Trajectory.video_id == video.id).first()
        persisted_video = verify_db.query(Video).filter(Video.id == video.id).first()

        assert persisted_traj is not None, "Old trajectory was wiped out by failed reprocess!"
        assert persisted_traj.id == old_traj_id, "Old trajectory ID changed despite failure"
        assert persisted_video.status == "processed", f"Expected video status 'processed', got {persisted_video.status}"
        verify_db.close()
    finally:
        if os.path.exists(temp_media.name):
            os.remove(temp_media.name)


# ─── Finding 9: Password Migration & Compatibility ──────────────────────────

def test_password_compatibility_legacy_and_prehashed():
    """Verify raw bcrypt hashes authenticate and upgrade to SHA-256 pre-hashed format."""
    db = _TestingSessionLocal()
    auth_svc = AuthService(db)

    raw_password = "LegacySecretPassword123!"
    # Generate legacy raw-bcrypt hash (without SHA-256 pre-hashing)
    legacy_salt = bcrypt.gensalt()
    legacy_hash = bcrypt.hashpw(raw_password.encode('utf-8'), legacy_salt).decode('utf-8')

    legacy_user = User(
        email="legacy_user@test.com",
        name="Legacy User",
        hashed_password=legacy_hash
    )
    db.add(legacy_user)
    db.commit()

    # 1. Verify password directly
    assert auth_svc.verify_password(raw_password, legacy_hash) is True

    # 2. Authenticate user -> verifies legacy hash AND upgrades to pre-hashed bcrypt in DB
    authenticated = auth_svc.authenticate_user("legacy_user@test.com", raw_password)
    assert authenticated is not None
    assert authenticated.id == legacy_user.id

    # 3. Verify upgraded hash in database is pre-hashed
    db.refresh(legacy_user)
    upgraded_hash = legacy_user.hashed_password
    assert upgraded_hash != legacy_hash, "Legacy hash was not transparently upgraded"
    # Pre-hashed verify should succeed
    assert auth_svc.verify_password(raw_password, upgraded_hash) is True
    db.close()


# ─── Finding 4: Physical Event Honesty on Real Video ──────────────────────────

def test_unverified_events_suppression_on_horizontal_track():
    """Flat horizontal trajectory must NOT receive fake bounce, fake pad impact, or fake metric speed."""
    svc = BallTrackingService()
    # 4 constant-height points (no bounce curvature, no pad contact)
    flat_trajectory = [
        {"x": 0.0, "y": 5.0, "z": 0.8, "t": 0.0, "confidence": 0.8, "is_predicted": False, "pixel_x": 100, "pixel_y": 200},
        {"x": 0.0, "y": 10.0, "z": 0.8, "t": 0.1, "confidence": 0.8, "is_predicted": False, "pixel_x": 100, "pixel_y": 250},
        {"x": 0.0, "y": 15.0, "z": 0.8, "t": 0.2, "confidence": 0.8, "is_predicted": False, "pixel_x": 100, "pixel_y": 300},
        {"x": 0.0, "y": 20.0, "z": 0.8, "t": 0.3, "confidence": 0.8, "is_predicted": False, "pixel_x": 100, "pixel_y": 350},
    ]
    tracking_data = {"ball_trajectory": flat_trajectory}
    _, drs_data = svc._analyze_lbw_decisions(tracking_data)

    # 1. No physical bounce curvature -> bounce_point must be None
    assert drs_data["bounce_point"] is None, "Fake bounce point detected on flat trajectory"
    assert drs_data["post_bounce_points"] == []

    # 2. Unverified pad impact -> impact_point and drs_evaluation must be None
    assert drs_data["impact_point"] is None, "Fake pad impact detected on uncalibrated footage"
    assert drs_data["drs_evaluation"] is None, "Fabricated LBW decision produced on uncalibrated footage"

    # 3. Metric speeds must be None (no invented km/h)
    assert drs_data["release_speed_kmh"] is None, "Fabricated metric release speed on uncalibrated footage"
    assert drs_data["bounce_speed_kmh"] is None, "Fabricated bounce speed on uncalibrated footage"

    # 4. 2D pixel speed is reported honestly
    assert drs_data.get("release_speed_px_per_sec") is not None
    assert drs_data["release_speed_px_per_sec"] > 0


# ─── Progress & DRS Lifecycle Tests ──────────────────────────────────────────

def test_get_video_progress_not_found(client):
    """GET /videos/{id}/progress for non-existent video returns 404."""
    resp = client.get("/videos/nonexistent-id-9999/progress")
    assert resp.status_code == 404


def test_drs_review_lifecycle(client, test_users):
    """Test full DRS review lifecycle: create review record, fetch review, list reviews."""
    user_a = test_users["user_a"]
    db = _TestingSessionLocal()
    video_id = str(uuid.uuid4())
    video = Video(
        id=video_id,
        user_id=user_a["id"],
        filename="drs_lifecycle_test.mp4",
        file_path="/tmp/fake_lifecycle.mp4",
        status="processed"
    )
    db.add(video)
    db.commit()
    db.close()

    payload = {
        "video_id": video_id,
        "decisions": [
            {
                "type": "lbw",
                "outcome": "OUT",
                "timestamp": 1.45,
                "confidence": 0.98
            }
        ],
        "notes": "Official DRS Review: OUT"
    }
    create_resp = client.post("/reviews/", json=payload, headers=user_a["headers"])
    assert create_resp.status_code == 200, f"Create review failed: {create_resp.text}"
    review_data = create_resp.json()
    assert "id" in review_data
    review_id = review_data["id"]

    get_resp = client.get(f"/reviews/{review_id}", headers=user_a["headers"])
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == review_id

    list_resp = client.get("/reviews/", headers=user_a["headers"])
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1

