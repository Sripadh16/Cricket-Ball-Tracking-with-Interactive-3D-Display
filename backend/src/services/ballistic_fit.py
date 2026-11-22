"""
Fit a physical cricket-ball flight to a 2D track seen through a solved camera.

Model (video time t, slow-motion factor s so real time = s * t, g_eff = g * s^2):
  bounce:    X(t) = B + v_in * tau - 1/2 g_eff tau^2 z_hat     (tau = t - t_b < 0)
             X(t) = B + v_out * tau - 1/2 g_eff tau^2 z_hat    (tau >= 0),   B = (x_b, y_b, r_ball)
  full toss: X(t) = P0 + v * tau - 1/2 g_eff tau^2 z_hat        (tau = t - t_ref)

For fixed (t_b, s) the "point lies on its pixel ray" constraints are LINEAR in the unknowns, so a
dense grid over (t_b, s) with (depth-normalised) linear solves gives global starting points; a robust
nonlinear refinement of the reprojection error then polishes the best few. The bounce lying on the
ground plane is what makes single-camera depth well posed.
"""
from typing import Dict, Optional, Tuple

import numpy as np
from scipy.optimize import least_squares

from services.camera_geometry import Camera

G = 9.81
BALL_R = 0.036
SLOWMO_FACTORS = (1.0, 0.5, 1 / 3, 0.25, 0.2, 1 / 6, 0.125, 0.1)


def _design(t: np.ndarray, tb: float, g_eff: float, bounce: bool):
    """X(t) = A(t) @ theta + c(t). Returns A (n,3,k) and c (n,3)."""
    tau = t - tb
    n = len(t)
    if bounce:
        A = np.zeros((n, 3, 8))  # xb, yb, vin(3), vout(3)
        A[:, 0, 0] = 1.0
        A[:, 1, 1] = 1.0
        pre = tau < 0
        for ax in range(3):
            A[:, ax, 2 + ax] = np.where(pre, tau, 0.0)
            A[:, ax, 5 + ax] = np.where(pre, 0.0, tau)
        c = np.zeros((n, 3))
        c[:, 2] = BALL_R - 0.5 * g_eff * tau ** 2
    else:
        A = np.zeros((n, 3, 6))  # P0(3), v(3)
        for ax in range(3):
            A[:, ax, ax] = 1.0
            A[:, ax, 3 + ax] = tau
        c = np.zeros((n, 3))
        c[:, 2] = -0.5 * g_eff * tau ** 2
    return A, c


def _linear_solve(cam: Camera, t, uv, w, tb, g_eff, bounce, iters: int = 2):
    P = cam.P
    A, c = _design(t, tb, g_eff, bounce)
    a_u = uv[:, 0:1] * P[2][None, :] - P[0][None, :]
    a_v = uv[:, 1:2] * P[2][None, :] - P[1][None, :]
    rows = np.concatenate([np.einsum("na,nak->nk", a_u[:, :3], A), np.einsum("na,nak->nk", a_v[:, :3], A)])
    rhs = -np.concatenate([np.einsum("na,na->n", a_u[:, :3], c) + a_u[:, 3],
                           np.einsum("na,na->n", a_v[:, :3], c) + a_v[:, 3]])
    ww = np.concatenate([w, w])
    theta = None
    for _ in range(iters):
        theta, *_ = np.linalg.lstsq(rows * ww[:, None], rhs * ww, rcond=None)
        X = np.einsum("nak,k->na", A, theta) + c
        dep = np.clip(np.abs(cam.depth(X)), 0.5, None)  # 1/depth turns algebraic error into ~pixels
        ww = np.concatenate([w / dep, w / dep]) * float(np.median(dep))
    return theta


def _positions(theta, t, tb, g_eff, bounce):
    A, c = _design(t, tb, g_eff, bounce)
    return np.einsum("nak,k->na", A, theta) + c


def _reproj(cam, theta, t, uv, tb, g_eff, bounce):
    X = _positions(theta, t, tb, g_eff, bounce)
    dep = cam.depth(X)
    err = cam.project(X) - uv
    err[dep <= 0.2] = 500.0
    return err, X


def _plausibility(theta, tb, s, bounce, X) -> Tuple[float, Dict]:
    """Penalty (pixel^2-like units) for physically implausible flights."""
    info: Dict = {}
    pen = 0.0
    if bounce:
        vin, vout = theta[2:5] / s, theta[5:8] / s
        speed = float(np.linalg.norm(vin))
        if vin[2] >= -0.3:
            pen += 400 * (vin[2] + 0.3) ** 2 + 50
        if vout[2] <= 0.3:
            pen += 400 * (0.3 - vout[2]) ** 2 + 50
        if np.linalg.norm(vout) > 1.02 * speed:
            pen += 50 + 20 * (np.linalg.norm(vout) - speed) ** 2
        if np.sign(vin[1]) != np.sign(vout[1]) or abs(vout[1]) < 0.4 * abs(vin[1]):
            pen += 200
        if abs(theta[0]) > 2.5:
            pen += 30 * (abs(theta[0]) - 2.5) ** 2
        # Ball-on-turf bounce prior (typical restitution). Only matters when few frames follow the bounce.
        if vin[2] < -0.3 and abs(vin[1]) > 1.0:
            e_z = -vout[2] / vin[2]
            r_y = vout[1] / vin[1]
            pen += 2.0 * ((e_z - 0.55) / 0.15) ** 2
            pen += 2.0 * ((r_y - 0.9) / 0.07) ** 2
            pen += 2.0 * ((vout[0] - vin[0]) / 1.0) ** 2
    else:
        speed = float(np.linalg.norm(theta[3:6] / s))
    kmh = speed * 3.6
    info["speed_kmh"] = kmh
    if kmh < 40:
        pen += 0.5 * (40 - kmh) ** 2
    if kmh > 170:
        pen += 0.5 * (kmh - 170) ** 2
    pen += 400 * float(np.sum(np.clip(BALL_R * 0.5 - X[:, 2], 0, None) ** 2))
    pen += 5 * float(np.sum(np.clip(X[:, 2] - 4.0, 0, None) ** 2))
    pen += 5 * float(np.sum(np.clip(np.abs(X[:, 0]) - 4.0, 0, None) ** 2))
    # Weak prior: deliveries stay near the pitch centre line. Negligible when the camera sees the
    # line directly (end-on), decisive when line is the camera's depth direction (side-on).
    pen += 0.5 * float(np.mean((X[:, 0] / 0.6) ** 2)) * len(X) * 0.2
    return pen, info


def _pack_fit(cam, tt, uv, w, theta, tb, s, bounce, t0, sol=None) -> Dict:
    g_eff = G * s * s
    err, X = _reproj(cam, theta, tt, uv, tb, g_eff, bounce)
    px = np.hypot(*err.T)
    fit = {"bounce": bool(bounce), "theta": np.asarray(theta, dtype=np.float64), "tb": float(tb) + t0, "t0": t0,
           "s": float(s), "g_eff": g_eff, "rms_px": float(np.sqrt(np.mean(px ** 2))), "max_px": float(px.max()),
           "residuals_px": px.tolist(), "sigma_x_m": None}
    fit["speed_kmh"] = float(np.linalg.norm(state_at(fit, t0)[1]) * 3.6)
    if sol is not None:
        try:  # lateral (line) uncertainty from the Gauss-Newton covariance
            J = sol.jac  # include the physics-prior row: it is what constrains the post-bounce line
            cov = np.linalg.pinv(J.T @ J) * max(1.0, float(np.mean(px ** 2)))
            i_x, i_vx = (0, 5) if bounce else (0, 3)
            fit["sigma_x_m"] = float(np.sqrt(max(0.0, cov[i_x, i_x]) + max(0.0, cov[i_vx, i_vx]) * 0.04 * s * s))
        except Exception:
            pass
    return fit


def _refine(cam, tt, uv, w, start, dt, max_nfev: int = 200):
    bounce = start["bounce"]
    nth = 8 if bounce else 6

    s_fixed = float(start["s"])  # slow-motion factor stays on its discrete hypothesis (1x, 2x, 4x ...)

    def unpack(p):
        return p[:nth], (p[nth] if bounce else start["tb"]), s_fixed

    def resid(p):
        theta, tb, s = unpack(p)
        err, X = _reproj(cam, theta, tt, uv, tb, G * s * s, bounce)
        pen, _ = _plausibility(theta, tb, s, bounce, X)
        return np.concatenate([(err * w[:, None]).ravel(), [np.sqrt(pen)]])

    p0 = np.concatenate([start["theta"], [start["tb"]] if bounce else []])
    lo = np.full(len(p0), -np.inf)
    hi = np.full(len(p0), np.inf)
    if bounce:
        lo[nth], hi[nth] = tt[0] - 0.5 * dt, tt[-1] + 0.5 * dt
    p0 = np.clip(p0, lo + 1e-9, hi - 1e-9)
    try:
        sol = least_squares(resid, p0, bounds=(lo, hi), loss="soft_l1", f_scale=3.0, max_nfev=max_nfev)
    except Exception:
        return None
    theta, tb, s = unpack(sol.x)
    r = resid(sol.x)
    return float(np.sum(r ** 2)), theta, tb, s, bounce, sol


def fit_flight(cam: Camera, t: np.ndarray, uv: np.ndarray, conf: Optional[np.ndarray] = None,
               allow_slowmo: bool = True, quick: bool = False) -> Optional[Dict]:
    t = np.asarray(t, dtype=np.float64)
    uv = np.asarray(uv, dtype=np.float64)
    n = len(t)
    if n < 5:
        return None
    w = np.ones(n) if conf is None else 0.5 + 0.5 * np.clip(np.asarray(conf, dtype=np.float64), 0, 1)
    t0 = float(t[0])
    tt = t - t0
    dt = float(np.median(np.diff(tt)))
    scales = SLOWMO_FACTORS if allow_slowmo else (1.0,)
    if quick:
        scales = tuple(x for x in scales if x in (1.0, 0.5, 0.25))
    grid = []
    for s_ in scales:
        g_eff = G * s_ * s_
        step = dt / (2.0 if quick else 3.0)
        cands = [(True, tb) for tb in np.arange(tt[1] - 0.5 * dt, tt[-2] + 0.5 * dt, step)]
        cands.append((False, float(np.median(tt))))
        for bounce, tb in cands:
            try:
                theta = _linear_solve(cam, tt, uv, w, tb, g_eff, bounce)
            except np.linalg.LinAlgError:
                continue
            err, X = _reproj(cam, theta, tt, uv, tb, g_eff, bounce)
            sse = float(np.sum((np.hypot(*err.T) * w) ** 2))
            pen, _ = _plausibility(theta, tb, s_, bounce, X)
            grid.append({"score": sse + pen + (6.0 if bounce else 0.0), "theta": theta, "tb": float(tb), "s": s_,
                         "bounce": bounce})
    if not grid:
        return None
    grid.sort(key=lambda g_: g_["score"])
    if quick:  # one short refinement of the best linear start: stable enough to rank cameras
        out = _refine(cam, tt, uv, w, grid[0], dt, max_nfev=40)
        if out is None:
            g0 = grid[0]
            return _pack_fit(cam, tt, uv, w, g0["theta"], g0["tb"], g0["s"], g0["bounce"], t0)
        _, theta, tb, s, bounce, _ = out
        return _pack_fit(cam, tt, uv, w, theta, tb, s, bounce, t0)
    starts = []
    for s_ in scales:  # best start of every slow-motion hypothesis
        best_s = next((g_ for g_ in grid if g_["s"] == s_), None)
        if best_s is not None and best_s["score"] < grid[0]["score"] * 4 + 50:
            starts.append(best_s)
    for g_ in grid:
        if all(not (g_["bounce"] == q["bounce"] and abs(g_["s"] - q["s"]) < 1e-6 and abs(g_["tb"] - q["tb"]) < 1.5 * dt)
               for q in starts):
            starts.append(g_)
        if len(starts) >= 6:
            break
    best = None
    for st in starts:
        out = _refine(cam, tt, uv, w, st, dt)
        if out is None:
            continue
        # model-size penalty for a bounce, and real time preferred unless slow motion clearly fits better
        key = out[0] + (6.0 if out[4] else 0.0) + (0.0 if out[3] == 1.0 else 8.0 + 0.1 * len(tt))
        if best is None or key < best[0]:
            best = (key,) + out[1:]
    if best is None:
        g0 = grid[0]
        return _pack_fit(cam, tt, uv, w, g0["theta"], g0["tb"], g0["s"], g0["bounce"], t0)
    _, theta, tb, s, bounce, sol = best
    return _pack_fit(cam, tt, uv, w, theta, tb, s, bounce, t0, sol)


def state_at(fit: Dict, t: float) -> Tuple[np.ndarray, np.ndarray]:
    """3D position and REAL-time velocity (m/s) at video time t."""
    tau = (t - fit["t0"]) - (fit["tb"] - fit["t0"])
    g, s, th = fit["g_eff"], fit["s"], fit["theta"]
    if fit["bounce"]:
        v = th[2:5] if tau < 0 else th[5:8]
        X = np.array([th[0], th[1], BALL_R]) + v * tau - np.array([0, 0, 0.5 * g * tau * tau])
    else:
        v = th[3:6]
        X = th[:3] + v * tau - np.array([0, 0, 0.5 * g * tau * tau])
    V = v - np.array([0, 0, g * tau])
    return X, V / s


def time_at_y(fit: Dict, y_target: float, t_from: float, t_to: float) -> Optional[float]:
    """First video time in [t_from, t_to] where the model crosses y = y_target."""
    ts = np.linspace(t_from, t_to, 400)
    ys = np.array([state_at(fit, x)[0][1] for x in ts])
    idx = np.where(np.diff(np.sign(ys - y_target)) != 0)[0]
    if not len(idx):
        return None
    i = idx[0]
    a, b = ys[i], ys[i + 1]
    return float(ts[i] + (y_target - a) / (b - a) * (ts[i + 1] - ts[i])) if b != a else float(ts[i])


def physical_score(cam: Camera, fit: Dict, t_first: float) -> Tuple[float, Dict]:
    """Lower is better. Combines camera feature fit, flight reprojection and cricket plausibility."""
    notes: Dict = {}
    score = (cam.rms_px / 1.5) ** 2 * 3.0 + fit["rms_px"] ** 2
    X0, V0 = state_at(fit, t_first)
    if V0[1] <= 0:  # the ball travels from the bowler's end towards the striker
        return 1e9, {"reason": "reversed"}
    t_rel = time_at_y(fit, -8.4, t_first - 3.0, t_first + 3.0)
    if t_rel is not None and t_rel <= t_first + 1e-6 and (not fit["bounce"] or t_rel < fit["tb"]):
        Xr, _ = state_at(fit, t_rel)
        notes["release_z"] = float(Xr[2])
        score += 25.0 * (max(0.0, 1.3 - Xr[2]) ** 2 + max(0.0, Xr[2] - 2.8) ** 2) / 0.04
    if X0[2] > 1.4 and X0[1] < 0.0:
        # first tracked point is at the hand: bowlers release with the front foot near the popping crease,
        # i.e. about 8.8 m from the striker's stumps (soft prior; only matters when the camera scale is ambiguous)
        w_rel = 2.0 if X0[1] < -7.0 else 1.0  # weaker where a high first point may be mid-flight (release hidden)
        score += w_rel * (max(0.0, abs(X0[1] + 8.8) - 0.4) / 0.6) ** 2  # dead zone: only clearly wrong scales
    if X0[1] < -9.8:  # in flight the ball is never behind the bowling crease (y = -10.06)
        score += 40.0 * (X0[1] + 9.8) ** 2 / 0.04
    if fit["bounce"]:
        Xb, _ = state_at(fit, fit["tb"])
        notes["bounce_y"] = float(Xb[1])
        if Xb[1] < -4.0:
            score += 40.0 * (Xb[1] + 4.0) ** 2
        if Xb[1] > 10.3:
            score += 40.0 * (Xb[1] - 10.3) ** 2
    kmh = fit["speed_kmh"]
    score += 0.02 * max(0.0, 60 - kmh) ** 2 + 0.02 * max(0.0, kmh - 160) ** 2
    if fit["s"] < 0.9:  # assume real time unless the curvature clearly says slow motion
        score += 2.0
    notes["score"] = score
    return score, notes


def choose_reconstruction(cams, t, uv, conf=None, top_k: int = 3):
    """Screen every candidate camera with a quick fit, fully fit the best few, return (cam, fit, score)."""
    screened = []
    for c in cams:
        f = fit_flight(c, t, uv, conf, quick=True)
        if f is None:
            continue
        sc, _ = physical_score(c, f, float(t[0]))
        screened.append((sc, c))
    screened.sort(key=lambda x: x[0])
    best = (None, None, float("inf"))
    for _, c in screened[:top_k]:
        f = fit_flight(c, t, uv, conf)
        if f is None:
            continue
        sc, _ = physical_score(c, f, float(t[0]))
        if sc < best[2]:
            best = (c, f, sc)
    return best
