"""Sign conventions of the swing / seam classifier (x = +off side for a right-handed batter)."""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from services.delivery_classifier import DeliveryClassifier as DC


def _delivery(lat_acc=0.0, post_vx_change=0.0, kmh=125.0, bounce_y=5.0):
    """Synthetic pre/post-bounce path with a constant sideways acceleration in the air (m/s^2)."""
    v = kmh / 3.6
    tb = (bounce_y + 8.8) / v
    pts = []
    for i in range(int(tb / 0.01) + 12):
        t = i * 0.01
        y = -8.8 + v * t
        if t < tb:
            x = 0.2 + 0.5 * lat_acc * t * t - 0.01 * t
            z = 0.036 + 2.2 * (1.0 - t / tb)
            ph = "pre_bounce"
        else:
            xb = 0.2 + 0.5 * lat_acc * tb * tb - 0.01 * tb
            vxb = lat_acc * tb - 0.01 + post_vx_change
            x = xb + vxb * (t - tb)
            z = 0.3
            ph = "post_bounce"
        pts.append({"x": x, "y": y, "z": z, "t": t, "phase": ph})
    return pts


def test_inswing_is_negative_and_named_inswinger():
    r = DC.classify_delivery(_delivery(lat_acc=-4.0), release_speed_kmh=125, length_zone="Good Length")
    sa = r["swing_analysis"]
    assert r["air_swing_mm"] < -25
    assert sa["swing_direction"] == "inswing"
    assert r["delivery_type"] == "inswinger"


def test_outswing_is_positive_and_named_outswinger():
    r = DC.classify_delivery(_delivery(lat_acc=4.0), release_speed_kmh=125, length_zone="Good Length")
    assert r["air_swing_mm"] > 25
    assert r["swing_analysis"]["swing_direction"] == "outswing"
    assert r["delivery_type"] == "outswinger"


def test_seam_sign_off_cutter_and_leg_cutter():
    r_in = DC.classify_delivery(_delivery(post_vx_change=-1.2), release_speed_kmh=125, length_zone="Good Length")
    assert r_in["pitch_deviation_deg"] < -1.0
    assert r_in["swing_analysis"]["seam_direction"] == "in"
    assert r_in["delivery_type"] == "off_cutter"
    r_away = DC.classify_delivery(_delivery(post_vx_change=1.2), release_speed_kmh=125, length_zone="Good Length")
    assert r_away["pitch_deviation_deg"] > 1.0
    assert r_away["swing_analysis"]["seam_direction"] == "away"
    assert r_away["delivery_type"] == "leg_cutter"


def test_spin_turn_directions():
    r = DC.classify_delivery(_delivery(post_vx_change=-1.0, kmh=80), release_speed_kmh=80, length_zone="Good Length")
    assert r["delivery_type"] == "off_spin" and r["swing_analysis"]["bowler_type"] == "spin"
    r = DC.classify_delivery(_delivery(post_vx_change=1.0, kmh=80), release_speed_kmh=80, length_zone="Good Length")
    assert r["delivery_type"] == "leg_spin"


def test_lhb_mirrors_directions():
    r = DC.classify_delivery(_delivery(lat_acc=-4.0), batter_stance="LHB", release_speed_kmh=125,
                             length_zone="Good Length")
    # moving towards -x is towards the OFF side of a left-hander: away from him
    assert r["swing_analysis"]["swing_direction"] == "outswing"


def test_camera_measurement_overrides_and_noise_gate():
    meas = {"swing_m": -0.012, "sigma_m": 0.02, "lateral_accel_mps2": -0.4, "air_time_s": 0.4}
    r = DC.classify_delivery(_delivery(), swing_measurement=meas, release_speed_kmh=125, length_zone="Full")
    sa = r["swing_analysis"]
    assert sa["swing_method"] == "camera_ray_curvature"
    assert sa["air_swing_mm"] == -12.0 and sa["air_swing_sigma_mm"] == 20.0
    assert sa["air_swing_significant"] is False and sa["swing_direction"] == "none"


def test_side_on_view_reports_line_unmeasurable():
    r = DC.classify_delivery(_delivery(lat_acc=-4.0), lateral_observable=False, release_speed_kmh=100,
                             length_zone="Full")
    sa = r["swing_analysis"]
    assert sa["lateral_measurable"] is False and r["air_swing_mm"] == 0.0
    assert r["delivery_type"] == "length_only"
    assert sa["pace_category"] == "Medium Pace"
    assert "cannot be measured" in sa["explanation"]


def test_pace_bands():
    assert DC.pace_category(80)["key"] == "spin"
    assert DC.pace_category(100)["key"] == "medium"
    assert DC.pace_category(125)["key"] == "medium_fast"
    assert DC.pace_category(135)["key"] == "fast_medium"
    assert DC.pace_category(145)["key"] == "fast"


def test_measure_air_swing_from_pixels_real_and_slow_motion():
    """Known curved flight (+/-0.6 m/s^2 sideways) through two cameras, real time and half-speed slow motion."""
    from services.camera_geometry import Camera, look_at
    from services.delivery_tracker import _measure_air_swing

    for cam_pos in [(0.5, -18.0, 4.0), (6.0, -12.0, 5.0)]:
        rvec, tvec = look_at(cam_pos, (0.0, 8.0, 0.0))
        cam = Camera(1400.0, 640.0, 360.0, rvec, tvec, 1280, 720)
        for s in (1.0, 0.5):
            for a_true in (0.6, -0.6):
                g = 9.81 * s * s
                X0 = np.array([0.3, -9.0, 2.1])
                v = np.array([-0.4, 36.0, -1.0]) * s
                T_v = 0.5 / s  # 0.5 s of real flight
                t = np.linspace(0.0, T_v, int(30 * T_v) + 1)
                uv = np.array([cam.project(X0 + v * ti - np.array([0, 0, 0.5 * g * ti * ti])
                                           + np.array([0.5 * a_true * (s * ti) ** 2, 0, 0]))[0] for ti in t])
                fit = {"t0": 0.0, "tb": 0.0, "s": s, "g_eff": g, "bounce": False,
                       "theta": np.concatenate([X0, v])}
                r = _measure_air_swing(cam, fit, t, uv, 0.0, T_v)
                assert r is not None
                assert abs(r["swing_m"] - 0.5 * a_true * 0.25) < 0.01  # +/-0.075 m
                assert abs(r["lateral_accel_mps2"] - a_true) < 0.08
                assert abs(r["air_time_s"] - 0.5) < 1e-6
