"""
Integration tests for FastAPI endpoints including Presets and Video processing.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from fastapi.testclient import TestClient
from main import app

@pytest.fixture
def client():
    return TestClient(app)

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
