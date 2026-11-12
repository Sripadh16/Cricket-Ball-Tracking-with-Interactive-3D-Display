import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))
from services.pitch_calibration import calibrate_pitch
from services.wicket_geometry import first_wicket_contact, STUMP_SPACING
from services.ball_physics_engine import BallPhysicsEngine, BALL_MASS
from services.sample_generator import DeliveryPhysicsSimulator
from services.ball_tracking_service import BallTrackingService
from unittest.mock import patch, MagicMock


def test_invalid_fps_is_rejected_without_manufacturing_timestamps():
    capture = MagicMock()
    capture.isOpened.return_value = True
    capture.get.side_effect = [0, 30, 640, 480]
    with patch('services.ball_tracking_service.cv2.VideoCapture', return_value=capture):
        with pytest.raises(ValueError, match='frame rate is unavailable'):
            BallTrackingService.__new__(BallTrackingService).track_ball('fixture.mp4')
    capture.release.assert_called_once()


def test_manual_pitch_correction_preserves_pixels_height_and_time():
    corners = [[100, 100], [200, 100], [300, 400], [0, 400]]
    points = [dict(pixel_x=100, pixel_y=100, x=99, y=99, z=1.2, t=2.5)]
    corrected, metadata = calibrate_pitch(points, corners, 640, 480)
    assert corrected[0]['x'] == pytest.approx(-1.525, abs=1e-5)
    assert corrected[0]['y'] == pytest.approx(-10.06, abs=1e-5)
    assert corrected[0]['z'] == 1.2 and corrected[0]['t'] == 2.5
    assert points[0]['x'] == 99
    assert metadata['height_status'] == 'heuristic_unverified'
    for invalid in ([[0, 0]] * 4, [[0, 0], [200, 400], [200, 0], [0, 400]],
                    [[0, 0], [700, 0], [200, 400], [0, 400]]):
        with pytest.raises(ValueError):
            calibrate_pitch(points, invalid, 640, 480)


def test_swept_wicket_contact_uses_radius_and_real_geometry():
    def path(x, z):
        return [dict(x=x, y=9.8, z=z, t=1), dict(x=x, y=10.06, z=z, t=1.01)]
    hit = first_wicket_contact(path(STUMP_SPACING, 0.5))
    assert hit['hit_stump'] == 'Off Stump'
    assert 1 < hit['time'] < 1.01
    assert hit['y'] == pytest.approx(10.06 - 0.019 - 0.036, abs=1e-5)
    assert first_wicket_contact(path(0.3, 0.5)) is None
    assert first_wicket_contact(path(0, 0.9)) is None


@pytest.mark.parametrize('velocity', [[0, 0, 0], [2, 30, -3], [-1, 15, 2]])
def test_force_identities_and_nonzero_spin_at_rest(velocity):
    data = BallPhysicsEngine.calculate_instantaneous_forces(velocity, [100, 0, 0])
    net = np.sum([data[key] for key in ['gravity_vector', 'drag_vector', 'magnus_vector', 'seam_vector']], axis=0)
    np.testing.assert_allclose(net, data['net_force_vector'], atol=0.0003)
    np.testing.assert_allclose(np.array(data['net_force_vector']) / BALL_MASS, data['acceleration'], atol=0.001)
    assert np.dot(data['drag_vector'], velocity) <= 0
    assert abs(np.dot(data['magnus_vector'], velocity)) < 0.005
    assert data['spin_rpm'] == pytest.approx(100 * 60 / (2 * np.pi), abs=0.1)


@pytest.mark.parametrize('rpm', [0, 1600, 2800])
def test_supported_rpm_turf_sweep(rpm):
    for preset in ['inswinger_lbw', 'offcutter_bowled', 'bouncer_missing', 'legspin_umpires_call']:
        for turf in ['standard_hard', 'green_seamer', 'dry_dusty', 'damp_clay']:
            data = DeliveryPhysicsSimulator.generate_delivery(preset, pitch_type=turf, rpm=rpm)
            assert data['points'][0]['spin_rpm'] == pytest.approx(rpm, abs=0.1)
            assert all(a['t'] < b['t'] for a, b in zip(data['points'], data['points'][1:]))
            assert data['bounce_point']['z'] == 0.036
            assert data['points'][-1]['t'] <= data['video_duration']
            if data['collision_event'] and data['collision_event']['type'] == 'bowled':
                assert not data['has_pad_interception']
                assert data['drs_evaluation']['decision'] == 'OUT'
