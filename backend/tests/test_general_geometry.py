"""
Ground-truth tests for the camera solver and the ballistic flight fit across camera placements.
A known delivery is projected through a known camera (with pixel noise); the pipeline must recover
the bounce point, the ball position at the stumps and the speed.
"""
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from services.camera_geometry import Camera, look_at, solve_camera, HALF_L, PITCH_HALF_W, STUMP_H  # noqa: E402
from services.ballistic_fit import fit_flight, state_at, time_at_y, physical_score, choose_reconstruction, BALL_R  # noqa: E402

W, H = 1280, 720


def make_cam(C, T, fov):
    f = W / (2 * np.tan(np.radians(fov) / 2))
    rvec, tvec = look_at(C, T)
    return Camera(f, W / 2, H / 2, rvec, tvec, W, H)


def delivery(speed_kmh=130.0, bounce_y=6.0, bounce_x=0.05, line_x_rel=0.0, ez=0.55, ex=0.93, fps=50.0, s=1.0):
    """Ground-truth flight: release at y=-8.5, bounce, then on towards the stumps. Returns t (video), X."""
    v = speed_kmh / 3.6
    y_rel = -8.5
    T1 = (bounce_y - y_rel) / v
    # choose release height giving the bounce: z(T1) = r -> vz0 from release height 2.1
    z0 = 2.1
    vz0 = (BALL_R - z0 + 0.5 * 9.81 * T1 ** 2) / T1
    x0 = bounce_x - line_x_rel * T1
    vx = (bounce_x - x0) / T1
    vz_in = vz0 - 9.81 * T1
    vz_out = -ez * vz_in
    vy_out = ex * v
    dt = (1.0 / fps) * s  # real time per frame
    ts, Xs = [], []
    t = 0.0
    while True:
        if t <= T1:
            X = np.array([x0 + vx * t, y_rel + v * t, z0 + vz0 * t - 4.9 * t * t])
        else:
            tau = t - T1
            X = np.array([bounce_x + vx * ex * tau, bounce_y + vy_out * tau, BALL_R + vz_out * tau - 4.9 * tau * tau])
        if X[1] > 9.0:
            break
        ts.append(t / s)
        Xs.append(X)
        t += dt
    return np.array(ts), np.array(Xs), dict(T1=T1, bounce=(bounce_x, bounce_y), vz_out=vz_out, vy_out=vy_out,
                                              vx_out=vx * ex)


def truth_at_stumps(gt):
    bx, by = gt["bounce"]
    tau = (HALF_L - by) / gt["vy_out"]
    return bx + gt["vx_out"] * tau, BALL_R + gt["vz_out"] * tau - 4.9 * tau * tau


def features(cam, rng, ends=("striker", "bowler")):
    stumps = []
    for end in ends:
        y = HALF_L if end == "striker" else -HALF_L
        base = cam.project([0, y, 0])[0]
        top = cam.project([0, y, STUMP_H])[0]
        if not (0 <= base[0] < W and 0 <= base[1] < H) or cam.depth([0, y, 0])[0] <= 0.5:
            continue
        hpx = abs(base[1] - top[1])
        if hpx < 8:
            continue
        stumps.append({"x": base[0] + rng.normal(0, 1), "y": base[1] + rng.normal(0, 1), "h": hpx * (1 + rng.normal(0, 0.02))})
    edges = []
    for xw in (-PITCH_HALF_W, PITCH_HALF_W):
        ys = np.linspace(-HALF_L, HALF_L, 60)
        pts = np.stack([np.full_like(ys, xw), ys, np.zeros_like(ys)], 1)
        pts = pts[cam.depth(pts) > 0.5]
        uv = cam.project(pts)
        ok = (uv[:, 0] >= 0) & (uv[:, 0] < W) & (uv[:, 1] >= 0) & (uv[:, 1] < H)
        uv = uv[ok] + rng.normal(0, 1.0, (ok.sum(), 2))
        edges.append({"samples": uv.tolist()} if len(uv) >= 15 else None)
    return stumps, {"edges": edges}


def pick(cams, ts, uv):
    cam, fit, _ = choose_reconstruction(cams, ts, uv)
    return cam, fit


CAMERAS = {
    "broadcast_behind_bowler": ((0, -HALF_L - 30, 7), (0, 4, 0), 18),
    "net_session_low_behind_bowler": ((0.4, -HALF_L - 3, 1.7), (0, 3, 0), 60),
    "behind_striker": ((0, HALF_L + 25, 6), (0, -3, 0), 22),
    "side_on_square_leg": ((40, 0, 3), (0, 0, 0), 40),
    "oblique_point": ((-25, -15, 5), (0, 2, 0), 35),
    "drone_high": ((0, -HALF_L - 5, 25), (0, 2, 0), 55),
}


@pytest.mark.parametrize("name", list(CAMERAS))
def test_reconstruction_from_any_camera(name):
    rng = np.random.default_rng(7)
    C, T, fov = CAMERAS[name]
    cam = make_cam(C, T, fov)
    ts, Xs, gt = delivery()
    uv = cam.project(Xs) + rng.normal(0, 1.0, (len(Xs), 2))
    stumps, edges = features(cam, rng)
    cams = solve_camera(W, H, stumps, edges)
    assert cams, f"{name}: camera not solved"
    est, fit = pick(cams, ts, uv)
    assert fit is not None, name
    assert fit["bounce"], f"{name}: bounce not found"
    Xb, _ = state_at(fit, fit["tb"])
    assert abs(Xb[1] - gt["bounce"][1]) < 0.6, (name, Xb, gt["bounce"])
    t_st = time_at_y(fit, HALF_L, fit["tb"], fit["tb"] + 2.0)
    assert t_st is not None
    Xs_st, _ = state_at(fit, t_st)
    zt = truth_at_stumps(gt)[1]
    assert abs(Xs_st[2] - zt) < 0.12, (name, Xs_st, zt)
    # one stump set seen obliquely leaves a focal/distance ambiguity that only the flight resolves
    assert abs(fit["speed_kmh"] - 130) < (20 if name == "oblique_point" else 15), (name, fit["speed_kmh"])


@pytest.mark.parametrize("ez,ex,bounce_y", [(0.40, 0.85, 4.5), (0.70, 0.95, 7.5)])
def test_bounce_physics_not_forced_by_prior(ez, ex, bounce_y):
    """Different restitution / lengths than the prior centre must still be recovered from the track."""
    rng = np.random.default_rng(11)
    cam = make_cam(*CAMERAS["broadcast_behind_bowler"][:2], CAMERAS["broadcast_behind_bowler"][2])
    ts, Xs, gt = delivery(ez=ez, ex=ex, bounce_y=bounce_y)
    uv = cam.project(Xs) + rng.normal(0, 1.0, (len(Xs), 2))
    stumps, edges = features(cam, rng)
    est, fit = pick(solve_camera(W, H, stumps, edges), ts, uv)
    Xb, _ = state_at(fit, fit["tb"])
    assert abs(Xb[1] - bounce_y) < 0.6
    t_st = time_at_y(fit, HALF_L, fit["tb"], fit["tb"] + 2.0)
    assert abs(state_at(fit, t_st)[0][2] - truth_at_stumps(gt)[1]) < 0.15


def test_slow_motion_is_detected():
    rng = np.random.default_rng(3)
    cam = make_cam((0, -HALF_L - 30, 7), (0, 4, 0), 18)
    ts, Xs, gt = delivery(s=0.25)  # 4x slow motion replay
    uv = cam.project(Xs) + rng.normal(0, 1.0, (len(Xs), 2))
    stumps, edges = features(cam, rng)
    est, fit = pick(solve_camera(W, H, stumps, edges), ts, uv)
    assert abs(fit["s"] - 0.25) < 0.08, fit["s"]
    assert abs(fit["speed_kmh"] - 130) < 20, fit["speed_kmh"]


@pytest.mark.parametrize("name", ["broadcast_behind_bowler", "net_session_low_behind_bowler", "oblique_point"])
def test_manual_pitch_corners_alone_solve_the_camera(name):
    """Guided calibration: four clicked pitch corners (no stumps / edges detected) reconstruct the flight."""
    rng = np.random.default_rng(5)
    C, T, fov = CAMERAS[name]
    cam = make_cam(C, T, fov)
    corners_w = [(-PITCH_HALF_W, -HALF_L, 0), (PITCH_HALF_W, -HALF_L, 0), (PITCH_HALF_W, HALF_L, 0), (-PITCH_HALF_W, HALF_L, 0)]
    if (cam.depth(np.array(corners_w)) <= 0.5).any():
        pytest.skip("corners behind this camera")
    corners = (cam.project(np.array(corners_w)) + rng.normal(0, 2.0, (4, 2))).tolist()
    ts, Xs, gt = delivery()
    uv = cam.project(Xs) + rng.normal(0, 1.0, (len(Xs), 2))
    est, fit = pick(solve_camera(W, H, [], None, corners), ts, uv)
    assert fit is not None and fit["bounce"]
    Xb, _ = state_at(fit, fit["tb"])
    assert abs(Xb[1] - gt["bounce"][1]) < 0.6, (name, Xb)
    t_st = time_at_y(fit, HALF_L, fit["tb"], fit["tb"] + 2.0)
    assert abs(state_at(fit, t_st)[0][2] - truth_at_stumps(gt)[1]) < 0.15
