"""
Isolated API endpoint tests with an isolated temp-file SQLite database.
Each test session gets a fresh DB so production data is never touched.
"""
import pytest
import sys
import os
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

# ---------------------------------------------------------------------------
# Point DATABASE_URL at a fresh temp file BEFORE any src import.
# We use a named temp file so all connections within the test session share
# the same database (unlike sqlite:// in-memory which isolates per connection).
# ---------------------------------------------------------------------------
_tmp_db_fd, _tmp_db_path = tempfile.mkstemp(suffix=".db", prefix="drs_test_")
os.close(_tmp_db_fd)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp_db_path}"

from sqlalchemy import create_engine       # noqa: E402
from sqlalchemy.orm import sessionmaker    # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Import ORM models to register them with Base, then create tables
from database import Base                  # noqa: E402
import main as _main_module                # noqa: E402  (app creation, router registration)

# Re-create engine pointing at the temp file and create tables
_test_engine = create_engine(
    os.environ["DATABASE_URL"], connect_args={"check_same_thread": False}
)
Base.metadata.create_all(bind=_test_engine)
_TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_test_engine)

# Override the FastAPI get_db dependency to use our isolated DB
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


def test_api_root(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "running"


def test_get_preset_deliveries(client):
    response = client.get("/videos/presets")
    assert response.status_code == 200
    data = response.json()
    assert "presets" in data
    assert len(data["presets"]) == 4
    preset_ids = [p["id"] for p in data["presets"]]
    assert "inswinger_lbw" in preset_ids
    assert "bouncer_missing" in preset_ids


def test_get_preset_trajectory_inswinger(client):
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


def test_video_list_returns_list(client):
    """GET /videos/ must return a response containing a 'videos' key."""
    resp = client.get("/videos/")
    assert resp.status_code == 200
    body = resp.json()
    assert "videos" in body
    assert isinstance(body["videos"], list)


def test_trajectory_404_for_unknown_video(client):
    """GET /videos/{id}/trajectory for a non-existent video must return 404."""
    resp = client.get("/videos/00000000-0000-0000-0000-000000000000/trajectory")
    # The endpoint queries video first — if video not found, returns 404
    assert resp.status_code == 404, (
        f"Expected 404 for unknown video, got {resp.status_code}: {resp.text}"
    )


def test_get_video_progress_not_found(client):
    """GET /videos/{id}/progress for non-existent video returns 404."""
    resp = client.get("/videos/nonexistent-id-9999/progress")
    assert resp.status_code == 404


def test_drs_review_lifecycle(client):
    """Test full DRS review lifecycle: create review record, fetch review, list reviews."""
    payload = {
        "video_id": "test-video-uuid-1234",
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
    create_resp = client.post("/reviews/", json=payload)
    assert create_resp.status_code == 200, f"Create review failed: {create_resp.text}"
    review_data = create_resp.json()
    assert "id" in review_data
    review_id = review_data["id"]

    get_resp = client.get(f"/reviews/{review_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == review_id

    list_resp = client.get("/reviews/")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
