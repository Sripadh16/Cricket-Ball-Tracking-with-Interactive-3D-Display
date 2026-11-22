"""
Single-camera geometry for cricket footage.

World frame (metres): x across the pitch (bowler's right = +x = off side for a right-hander),
y along the pitch (bowler stumps at -L/2, striker stumps at +L/2), z up.

The camera is a pinhole with square pixels and the principal point at the image centre.
It is solved from whatever the frame offers:
  * stump sets (base + top of the middle stump, one or both ends)
  * the two long edges of the pitch strip (lines x = +/-1.525 on the ground)
  * manually picked pitch corners
by a robust nonlinear least-squares fit started from many plausible camera placements
(behind the bowler, behind the striker, side-on and oblique, high and low).
"""
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np
from scipy.optimize import least_squares

PITCH_L = 20.12
HALF_L = PITCH_L / 2.0
PITCH_HALF_W = 1.525
STUMP_H = 0.711


@dataclass
class Camera:
    f: float
    cx: float
    cy: float
    rvec: np.ndarray
    tvec: np.ndarray
    W: int
    H: int
    rms_px: float = 0.0
    source: str = ""
    assign: tuple = ()

    @property
    def K(self) -> np.ndarray:
        return np.array([[self.f, 0, self.cx], [0, self.f, self.cy], [0, 0, 1.0]])

    @property
    def R(self) -> np.ndarray:
        return cv2.Rodrigues(np.asarray(self.rvec, dtype=np.float64))[0]

    @property
    def P(self) -> np.ndarray:
        return self.K @ np.hstack([self.R, np.asarray(self.tvec, dtype=np.float64).reshape(3, 1)])

    @property
    def centre(self) -> np.ndarray:
        return -self.R.T @ np.asarray(self.tvec, dtype=np.float64).reshape(3)

    def project(self, X: np.ndarray) -> np.ndarray:
        X = np.atleast_2d(np.asarray(X, dtype=np.float64))
        Xc = X @ self.R.T + np.asarray(self.tvec, dtype=np.float64).reshape(1, 3)
        z = np.where(np.abs(Xc[:, 2]) < 1e-9, 1e-9, Xc[:, 2])
        return np.stack([self.f * Xc[:, 0] / z + self.cx, self.f * Xc[:, 1] / z + self.cy], axis=1)

    def depth(self, X: np.ndarray) -> np.ndarray:
        X = np.atleast_2d(np.asarray(X, dtype=np.float64))
        return (X @ self.R.T + np.asarray(self.tvec, dtype=np.float64).reshape(1, 3))[:, 2]

    def ground_point(self, u: float, v: float, z: float = 0.0) -> Optional[np.ndarray]:
        """Intersect the pixel ray with the horizontal plane at height z."""
        d = self.R.T @ np.array([(u - self.cx) / self.f, (v - self.cy) / self.f, 1.0])
        C = self.centre
        if abs(d[2]) < 1e-9:
            return None
        s = (z - C[2]) / d[2]
        if s <= 0:
            return None
        return C + s * d

    def to_dict(self) -> Dict:
        C = self.centre
        return {"f_px": round(float(self.f), 2), "cx": float(self.cx), "cy": float(self.cy),
                "rvec": [float(v) for v in np.ravel(self.rvec)], "tvec": [float(v) for v in np.ravel(self.tvec)],
                "camera_position_m": [round(float(v), 3) for v in C], "rms_px": round(float(self.rms_px), 2),
                "source": self.source, "width": self.W, "height": self.H}

    @classmethod
    def from_dict(cls, d: Dict) -> "Camera":
        return cls(d["f_px"], d["cx"], d["cy"], np.array(d["rvec"]), np.array(d["tvec"]), d["width"], d["height"],
                   d.get("rms_px", 0.0), d.get("source", ""))


def look_at(C: Sequence[float], target: Sequence[float], roll: float = 0.0) -> Tuple[np.ndarray, np.ndarray]:
    C = np.asarray(C, dtype=np.float64)
    fwd = np.asarray(target, dtype=np.float64) - C
    fwd /= np.linalg.norm(fwd)
    up = np.array([0.0, 0.0, 1.0])
    right = np.cross(fwd, up)
    if np.linalg.norm(right) < 1e-6:
        right = np.array([1.0, 0.0, 0.0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    R = np.stack([right, down, fwd])  # rows: camera x (right), y (down), z (forward)
    if roll:
        c, s = np.cos(roll), np.sin(roll)
        R = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]]) @ R
    rvec = cv2.Rodrigues(R)[0].ravel()
    return rvec, -R @ C


# --------------------------------------------------------------------------- feature extraction

def detect_pitch_edges(frame: np.ndarray) -> Optional[Dict]:
    """Find the two long edges of the pitch strip as image lines (each: point + unit direction + samples)."""
    H, W = frame.shape[:2]
    scale = 640.0 / max(W, H)
    small = cv2.resize(frame, (int(W * scale), int(H * scale))) if scale < 1 else frame.copy()
    if scale >= 1:
        scale = 1.0
    h, w = small.shape[:2]
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    Hh, S, V = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    grass = (Hh >= 30) & (Hh <= 95) & (S >= 55)
    # Pitch: tan / straw / worn grey-green, i.e. low-saturation or yellow-brown, reasonably bright.
    pitch = (~grass) & (V >= 90) & (((Hh >= 5) & (Hh <= 34) & (S >= 25)) | (S < 60)) & (V <= 250)
    mask = pitch.astype(np.uint8) * 255
    k = max(3, int(0.012 * w)) | 1
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((2 * k + 1, 2 * k + 1), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    best, best_score = None, 0.0
    for i in range(1, n):
        x, y, bw, bh, area = stats[i]
        if area < 0.02 * w * h:
            continue
        comp = (labels == i).astype(np.uint8)
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        hull = cv2.convexHull(max(cnts, key=cv2.contourArea))
        solidity = area / max(1.0, cv2.contourArea(hull))
        (_, _), (rw, rh), _ = cv2.minAreaRect(hull)
        elong = max(rw, rh) / max(1.0, min(rw, rh))
        # trapezoid strips are solid and elongated; reject the whole-sky / whole-frame blobs
        if solidity < 0.75 or area > 0.7 * w * h:
            continue
        score = area * solidity * min(elong, 6.0)
        if score > best_score:
            best, best_score = comp, score
    if best is None:
        return None

    # Left/right boundary of the strip per row (strip runs roughly up the image) or per column (side-on).
    rows = np.where(best.any(axis=1))[0]
    cols = np.where(best.any(axis=0))[0]
    vertical = (rows.max() - rows.min()) >= 0.6 * (cols.max() - cols.min())
    edges = []
    if vertical:
        ys = np.arange(rows.min() + 2, rows.max() - 2)
        left, right = [], []
        for y in ys:
            xs = np.where(best[y])[0]
            if len(xs) < 3:
                continue
            if xs[0] > 1:
                left.append((xs[0], y))
            if xs[-1] < w - 2:
                right.append((xs[-1], y))
        sides = (left, right)
    else:
        xs_ = np.arange(cols.min() + 2, cols.max() - 2)
        top, bottom = [], []
        for x in xs_:
            ys = np.where(best[:, x])[0]
            if len(ys) < 3:
                continue
            if ys[0] > 1:
                top.append((x, ys[0]))
            if ys[-1] < h - 2:
                bottom.append((x, ys[-1]))
        sides = (top, bottom)
    for pts in sides:
        if len(pts) < 15:
            edges.append(None)
            continue
        P = np.array(pts, dtype=np.float32)
        line = None
        # RANSAC-like robust line: cv2.fitLine with Huber, then keep inliers
        for _ in range(2):
            vx, vy, x0, y0 = cv2.fitLine(P, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
            d = np.abs((P[:, 0] - x0) * vy - (P[:, 1] - y0) * vx)
            keep = d < max(2.0, 0.006 * w)
            if keep.sum() < 10:
                break
            P = P[keep]
            line = (vx, vy, x0, y0)
        if line is None or len(P) < 15:
            edges.append(None)
            continue
        span = np.ptp(P[:, 1] if vertical else P[:, 0])
        if span < 0.2 * (h if vertical else w):
            edges.append(None)
            continue
        idx = np.linspace(0, len(P) - 1, min(25, len(P))).astype(int)
        edges.append({"samples": (P[idx] / scale).tolist(), "line": [float(line[0]), float(line[1]),
                                                                       float(line[2] / scale), float(line[3] / scale)]})
    if sum(e is not None for e in edges) == 0:
        return None
    return {"edges": edges, "orientation": "vertical" if vertical else "horizontal"}


# --------------------------------------------------------------------------- camera solving

def _params_to_cam(p: np.ndarray, W: int, H: int) -> Camera:
    return Camera(float(np.exp(p[0])), W / 2.0, H / 2.0, p[1:4], p[4:7], W, H)


def _line_dist(cam: Camera, samples: np.ndarray, x_world: float) -> np.ndarray:
    """Distance (px) from detected edge samples to the projection of the ground line x = x_world."""
    Y = np.array([-HALF_L - 2.0, HALF_L + 2.0])
    ends = np.array([[x_world, Y[0], 0.0], [x_world, Y[1], 0.0]])
    if (cam.depth(ends) <= 0.2).any():  # clip to the part in front of the camera
        C = cam.centre
        ys = np.linspace(-HALF_L - 2, HALF_L + 2, 30)
        pts = np.stack([np.full_like(ys, x_world), ys, np.zeros_like(ys)], 1)
        good = cam.depth(pts) > 0.2
        if good.sum() < 2:
            return np.full(len(samples), 200.0)
        pts = pts[good][[0, -1]]
        ends = pts
    a, b = cam.project(ends)
    d = b - a
    nrm = np.hypot(*d)
    if nrm < 1e-6:
        return np.full(len(samples), 200.0)
    n = np.array([-d[1], d[0]]) / nrm
    return (samples - a) @ n


def _residuals(p, W, H, obs_pts, obs_w, edges, roll_prior=True):
    cam = _params_to_cam(p, W, H)
    res = []
    if len(obs_pts):
        Xw = np.array([o[0] for o in obs_pts])
        uv = np.array([o[1] for o in obs_pts])
        dep = cam.depth(Xw)
        proj = cam.project(Xw)
        r = (proj - uv) * np.asarray(obs_w)[:, None]
        r[dep <= 0.3] = 300.0
        res.append(r.ravel())
    for samples, xw in edges:
        res.append(_line_dist(cam, samples, xw) / 4.0)
    # weak priors: no roll, camera above the ground, plausible focal length
    right_axis = cam.R[0]  # camera x axis expressed in world coordinates
    res.append(np.array([right_axis[2] / 0.12]))  # horizon roughly level
    C = cam.centre
    res.append(np.array([min(0.0, C[2] - 0.6) / 0.1]))
    res.append(np.array([(p[0] - np.log(1.2 * W)) / 2.5]))
    return np.concatenate(res)


def _initial_guesses(W: int) -> List[np.ndarray]:
    guesses = []
    fovs = [20, 45, 70]
    placements = []
    for D in (6, 20, 60):
        for h in (1.6, 6.0, 20.0):
            placements.append(((0, -HALF_L - D, h), (0, 3.0, 0)))       # behind bowler
            placements.append(((0, HALF_L + D, h), (0, -3.0, 0)))       # behind striker
    for D in (15, 45, 90):
        for h in (2.0, 8.0):
            for sgn in (1, -1):
                placements.append(((sgn * D, 0, h), (0, 0, 0)))          # square
                placements.append(((sgn * D * 0.7, -D * 0.7, h), (0, 2, 0)))  # oblique, bowler side
                placements.append(((sgn * D * 0.7, D * 0.7, h), (0, -2, 0)))  # oblique, striker side
    placements.append(((0, -HALF_L - 2, 25.0), (0, 0, 0)))                # drone
    for C, T in placements:
        for fov in fovs:
            f = W / (2 * np.tan(np.radians(fov) / 2))
            rvec, tvec = look_at(C, T)
            guesses.append(np.concatenate([[np.log(f)], rvec, tvec]))
    return guesses


def _branch(rvec) -> int:
    fwd = cv2.Rodrigues(np.asarray(rvec, dtype=np.float64))[0][2]
    return 0 if abs(fwd[1]) < 0.35 else (1 if fwd[1] > 0 else -1)


def _refine_camera(p0, W, H, obs_pts, obs_w, edge_terms, fixed_logf: Optional[float] = None) -> Optional[Camera]:
    try:
        if fixed_logf is None:
            sol = least_squares(_residuals, p0, args=(W, H, obs_pts, obs_w, edge_terms),
                                loss="soft_l1", f_scale=2.0, max_nfev=150)
            p = sol.x
        else:
            sol = least_squares(lambda q: _residuals(np.concatenate([[fixed_logf], q]), W, H, obs_pts, obs_w, edge_terms),
                                p0, loss="soft_l1", f_scale=2.0, max_nfev=80)
            p = np.concatenate([[fixed_logf], sol.x])
    except Exception:
        return None
    cam = _params_to_cam(p, W, H)
    if obs_pts:
        Xw = np.array([o[0] for o in obs_pts])
        uv = np.array([o[1] for o in obs_pts])
        if (cam.depth(Xw) <= 0.3).any():
            return None
        pt_err = np.hypot(*(cam.project(Xw) - uv).T)
    else:
        pt_err = np.array([0.0])
    e_err = np.concatenate([np.abs(_line_dist(cam, s_, x)) for s_, x in edge_terms]) if edge_terms else np.array([0.0])
    cam.rms_px = float(np.sqrt(np.mean(np.concatenate([pt_err, e_err]) ** 2)))
    return cam


def solve_camera(W: int, H: int, stump_sets: List[Dict], edges: Optional[Dict] = None,
                 corners: Optional[Sequence[Sequence[float]]] = None, creases: Optional[List[Dict]] = None) -> List[Camera]:
    """
    stump_sets: [{"x": u_base, "y": v_base, "h": height_px, "end": "bowler"|"striker"|None}, ...]
    corners: 4 manual pitch corners [bowler-left, bowler-right, batter-right, batter-left] (pixels).
    Returns candidate cameras (one per plausible end assignment), best first.
    """
    # Most precise route: crease lines + pitch edges fix the ground plane exactly (no stump boxes needed).
    if corners is None and creases and len(creases) >= 2 and edges:
        line_cams = camera_from_lines(W, H, edges, creases)
        good = [c for c in line_cams if c.rms_px <= max(3.0, 0.004 * W)]
        if good:
            return good
    edge_samples = []
    if edges:
        for e in edges.get("edges", []):
            if e is not None:
                edge_samples.append(np.array(e["samples"], dtype=np.float64))

    assignments: List[List[str]] = [[]]
    for s in stump_sets:
        opts = [s["end"]] if s.get("end") else ["striker", "bowler"]
        assignments = [a + [o] for a in assignments for o in opts]
    assignments = [a for a in assignments if len(set(a)) == len(a)] or [[]]

    corner_world = [(-PITCH_HALF_W, -HALF_L, 0), (PITCH_HALF_W, -HALF_L, 0),
                    (PITCH_HALF_W, HALF_L, 0), (-PITCH_HALF_W, HALF_L, 0)]
    results: List[Camera] = []
    guesses = _initial_guesses(W)
    for assign in assignments:
        obs_pts, obs_w = [], []
        for s, end in zip(stump_sets, assign):
            yw = HALF_L if end == "striker" else -HALF_L
            sig = max(2.0, 0.06 * s["h"])
            obs_pts.append(((0.0, yw, 0.0), (s["x"], s["y"])))
            obs_pts.append(((0.0, yw, STUMP_H), (s["x"], s["y"] - s["h"])))
            obs_w += [1.0 / sig, 1.0 / (1.5 * sig)]
        if corners is not None:
            for Xw, uv in zip(corner_world, corners):
                obs_pts.append((Xw, tuple(uv)))
                obs_w.append(1.0 / 3.0)
        n_constraints = 2 * len(obs_pts) + (len(edge_samples) * 2)
        if n_constraints < 7:
            continue
        # Edge assignment: the two detected edges map to x=-1.525/+1.525 in either order.
        edge_orders = [[]]
        if len(edge_samples) == 2:
            edge_orders = [[-PITCH_HALF_W, PITCH_HALF_W], [PITCH_HALF_W, -PITCH_HALF_W]]
        elif len(edge_samples) == 1:
            edge_orders = [[-PITCH_HALF_W], [PITCH_HALF_W]]
        # Keep the best solution per viewing branch: looking up the pitch (+y), down it (-y) or across it.
        # With one stump set the frame cannot tell these apart; the ball flight decides later.
        branches: Dict[int, Tuple[Camera, list]] = {}
        for order in edge_orders:
            edge_terms = list(zip(edge_samples, order))
            scored = {-1: [], 0: [], 1: []}
            for g in guesses:
                r = _residuals(g, W, H, obs_pts, obs_w, edge_terms)
                scored[_branch(g[1:4])].append((float(np.sum(np.minimum(r ** 2, 1e4))), g))
            for key in scored:
                scored[key].sort(key=lambda s_: s_[0])
                for _, g in scored[key][:3]:
                    cam = _refine_camera(g, W, H, obs_pts, obs_w, edge_terms)
                    if cam is None:
                        continue
                    k_ = _branch(cam.rvec)
                    cam.source = "+".join(filter(None, ["stumps:" + ",".join(assign) if assign else "",
                                                         f"pitch_edges:{len(edge_terms)}" if edge_terms else "",
                                                         "manual_corners" if corners is not None else ""]))
                    cam.assign = tuple(assign)
                    if k_ not in branches or cam.rms_px < branches[k_][0].rms_px:
                        branches[k_] = (cam, edge_terms)
        if not branches:
            continue
        best_rms = min(c.rms_px for c, _ in branches.values())
        anchor = np.mean([o[0] for o in obs_pts], axis=0) if obs_pts else np.zeros(3)
        for cam0, terms in branches.values():
            if cam0.rms_px > max(2.0 * best_rms, best_rms + 3.0):
                continue
            results.append(cam0)
            # Focal/distance family: with few features (e.g. one stump set + pitch edges) a closer camera
            # with a wider lens explains the frame equally well. Keep every member that still fits.
            # absolute lens range: wide phone lens (~90 deg) to long broadcast telephoto (~3 deg)
            for f_abs in W * np.geomspace(0.45, 16.0, 32):  # ~12% steps
                k = f_abs / cam0.f
                if abs(np.log(k)) < 0.05:
                    continue
                Cn = anchor + (cam0.centre - anchor) * k
                fixed = float(np.log(f_abs))
                q0 = np.concatenate([np.ravel(cam0.rvec), -cam0.R @ Cn])
                cam = _refine_camera(q0, W, H, obs_pts, obs_w, terms, fixed_logf=fixed)
                if cam is None or _branch(cam.rvec) != _branch(cam0.rvec):
                    continue
                if cam.rms_px <= max(1.6 * cam0.rms_px, cam0.rms_px + 2.5):
                    cam.source = cam0.source + f"+lens({f_abs / W:.1f}W)"
                    cam.assign = cam0.assign
                    results.append(cam)
    results.sort(key=lambda c: c.rms_px)
    return results


# --------------------------------------------------------------------------- crease lines -> exact ground plane
CREASE_YS = (-HALF_L, -8.84, 8.84, HALF_L)  # bowling & popping creases at both ends (metres)


def detect_creases(frame: np.ndarray, edges: Optional[Dict]) -> List[Dict]:
    """White crease lines running ACROSS the pitch strip (in `frame` pixel coordinates), ordered along the pitch.
    Top-hat (thin bright structures) inside a band around the strip, Hough segments roughly perpendicular to
    the strip direction, merged per line; short pieces (players, logos) are rejected by length."""
    if not edges or sum(e is not None for e in edges.get("edges", [])) < 2:
        return []
    h, w = frame.shape[:2]
    lines = [np.array(e["line"], dtype=np.float64) for e in edges["edges"] if e is not None]
    d0v, d1v = lines[0][:2], lines[1][:2]
    axis = d0v + d1v * np.sign(np.dot(d0v, d1v))
    axis /= np.linalg.norm(axis) + 1e-9
    if axis[1] < 0:
        axis = -axis

    def edge_offset(line, pts):
        vx, vy, x0, y0 = line
        return (pts - np.array([x0, y0])) @ np.array([-vy, vx])

    yy, xx = np.mgrid[0:h, 0:w]
    P = np.stack([xx.ravel(), yy.ravel()], 1).astype(np.float64)
    o0, o1 = edge_offset(lines[0], P), edge_offset(lines[1], P)
    inside = np.sign(o0) != np.sign(o1)
    width_local = np.abs(o0) + np.abs(o1)
    near = inside | (np.minimum(np.abs(o0), np.abs(o1)) < 0.3 * width_local)
    band = near.reshape(h, w)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    k = max(9, int(0.02 * w)) | 1
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    white = ((tophat > 22) & (hsv[..., 1] < 70) & (hsv[..., 2] > 150) & band).astype(np.uint8) * 255
    segs = cv2.HoughLinesP(white, 1, np.pi / 360, threshold=18, minLineLength=max(12, int(0.025 * w)), maxLineGap=6)
    if segs is None:
        return []
    # group segments that are collinear (same direction, each midpoint on the group's line); longest first
    seg_list = []
    for x1, y1, x2, y2 in np.asarray(segs).reshape(-1, 4):
        d = np.array([x2 - x1, y2 - y1], dtype=np.float64)
        L = float(np.linalg.norm(d))
        if L < 1 or abs(np.dot(d / L, axis)) > 0.5:  # must run across the pitch
            continue
        seg_list.append((L, np.array([x1, y1], float), np.array([x2, y2], float), d / L))
    seg_list.sort(key=lambda z: -z[0])
    tol = max(2.5, 0.004 * h)
    groups: List[Dict] = []
    for L, a, b, u in seg_list:
        mid = (a + b) / 2
        for g in groups:
            n = np.array([-g["u"][1], g["u"][0]])
            if abs(np.dot(u, g["u"])) > np.cos(np.radians(4)) and abs((mid - g["p"]) @ n) < tol \
                    and abs((a - g["p"]) @ n) < 2 * tol and abs((b - g["p"]) @ n) < 2 * tol:
                g["pts"] += [tuple(a), tuple(b)]
                g["len"] += L
                break
        else:
            groups.append({"p": mid, "u": u, "pts": [tuple(a), tuple(b)], "len": L,
                           "s": float(mid @ axis)})
    out = []
    for g in groups:
        pts = np.array(g["pts"], dtype=np.float64)
        centre = pts.mean(0)[None]
        strip_w = abs(edge_offset(lines[0], centre)[0]) + abs(edge_offset(lines[1], centre)[0])
        if g["len"] < 0.55 * strip_w:
            continue
        vx, vy, x0, y0 = cv2.fitLine(pts.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        tv = (pts - np.array([x0, y0])) @ np.array([vx, vy])
        ts = np.linspace(tv.min(), tv.max(), 15)
        out.append({"samples": np.stack([x0 + vx * ts, y0 + vy * ts], 1).tolist(), "s": g["s"], "length": float(g["len"])})
    out.sort(key=lambda c: -c["length"])
    out = out[:4]
    out.sort(key=lambda c: c["s"])
    return out


def _world_line_dist(cam: Camera, samples: np.ndarray, P0, P1) -> np.ndarray:
    ends = np.array([P0, P1], dtype=np.float64)
    if (cam.depth(ends) <= 0.2).any():
        return np.full(len(samples), 200.0)
    a, b = cam.project(ends)
    d = b - a
    nrm = float(np.hypot(*d))
    if nrm < 1e-6:
        return np.full(len(samples), 200.0)
    return (samples - a) @ (np.array([-d[1], d[0]]) / nrm)


def _line_residuals(p, W, H, edge_terms, crease_terms):
    cam = _params_to_cam(p, W, H)
    res = []
    for samples, xw in edge_terms:
        res.append(_world_line_dist(cam, samples, (xw, -HALF_L - 2, 0), (xw, HALF_L + 2, 0)) / 2.0)
    for samples, yw in crease_terms:
        res.append(_world_line_dist(cam, samples, (-2.0, yw, 0), (2.0, yw, 0)) / 1.5)
    res.append(np.array([min(0.0, cam.centre[2] - 0.6) / 0.1]))
    return np.concatenate(res)


def _cam_from_homography(Hm: np.ndarray, W: int, H: int) -> Optional[np.ndarray]:
    """Decompose a ground-plane homography (world x,y,1 -> image) into [log f, rvec, tvec] (square pixels,
    principal point at the image centre)."""
    Hc = np.array([[1, 0, -W / 2.0], [0, 1, -H / 2.0], [0, 0, 1]]) @ Hm
    h1, h2, h3 = Hc[:, 0], Hc[:, 1], Hc[:, 2]
    f2s = []
    if abs(h1[2] * h2[2]) > 1e-12:
        f2s.append(-(h1[0] * h2[0] + h1[1] * h2[1]) / (h1[2] * h2[2]))
    if abs(h1[2] ** 2 - h2[2] ** 2) > 1e-12:
        f2s.append(-(h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / (h1[2] ** 2 - h2[2] ** 2))
    f2s = [x for x in f2s if (0.2 * W) ** 2 < x < (40 * W) ** 2]
    if not f2s:
        return None
    f = float(np.sqrt(f2s[0]))
    Kinv = np.diag([1 / f, 1 / f, 1.0])
    lam = 1.0 / np.linalg.norm(Kinv @ h1)
    r1, r2, t = lam * (Kinv @ h1), lam * (Kinv @ h2), lam * (Kinv @ h3)
    if t[2] < 0:
        r1, r2, t = -r1, -r2, -t
    U, _, Vt = np.linalg.svd(np.stack([r1, r2, np.cross(r1, r2)], 1))
    Rm = U @ Vt
    if np.linalg.det(Rm) < 0:
        return None
    return np.concatenate([[np.log(f)], cv2.Rodrigues(Rm)[0].ravel(), t])


def _lines_rms(cam: Camera, edge_terms, crease_terms) -> float:
    d = np.concatenate(
        [np.abs(_world_line_dist(cam, s_, (x, -HALF_L - 2, 0), (x, HALF_L + 2, 0))) for s_, x in edge_terms] +
        [np.abs(_world_line_dist(cam, s_, (-2.0, y, 0), (2.0, y, 0))) for s_, y in crease_terms])
    return float(np.sqrt(np.mean(d ** 2)))


def camera_from_lines(W: int, H: int, edges: Dict, creases: List[Dict]) -> List[Camera]:
    """Ground-plane homography from line correspondences (pitch edges x=+/-1.525, creases y=Y), decomposed into
    focal length and pose, then refined on line distances. RANSAC-like: every subset (>=2) of the detected cross
    lines and every ordered crease labelling is scored in closed form; spurious lines (graphics, shadows) simply
    fall out. The best few hypotheses are refined nonlinearly."""
    import itertools
    edge_samples = [np.array(e["samples"], dtype=np.float64) for e in edges.get("edges", []) if e is not None]
    if len(edge_samples) != 2 or len(creases) < 2:
        return []
    crease_all = [np.array(c["samples"], dtype=np.float64) for c in creases[:5]]
    allpts = np.vstack(edge_samples + crease_all)
    c0 = allpts.mean(0)
    sc = np.sqrt(2) / (np.mean(np.linalg.norm(allpts - c0, axis=1)) + 1e-9)
    T = np.array([[sc, 0, -sc * c0[0]], [0, sc, -sc * c0[1]], [0, 0, 1]])
    hyps = []
    for e_order in ((-PITCH_HALF_W, PITCH_HALF_W), (PITCH_HALF_W, -PITCH_HALF_W)):
        edge_terms = list(zip(edge_samples, e_order))
        for kk in range(min(4, len(crease_all)), 1, -1):
            for subset in itertools.combinations(range(len(crease_all)), kk):  # detected lines (ordered along pitch)
                cs = [crease_all[i] for i in subset]
                for orient in (1, -1):
                    ys_sorted = sorted(CREASE_YS, key=lambda y: orient * y)
                    for combo in itertools.combinations(range(4), kk):
                        ys = [ys_sorted[i] for i in combo]
                        rows = []
                        for lw, smp in [(np.array([1.0, 0.0, -x]), s_) for x, s_ in zip(e_order, edge_samples)] + \
                                       [(np.array([0.0, 1.0, -y]), s_) for y, s_ in zip(ys, cs)]:
                            ph = (T @ np.hstack([smp, np.ones((len(smp), 1))]).T).T
                            rows.extend(np.kron(lw, q) for q in ph)
                        try:
                            _, _, Vt = np.linalg.svd(np.array(rows))
                            Hm = np.linalg.inv(Vt[-1].reshape(3, 3) @ T)
                        except np.linalg.LinAlgError:
                            continue
                        p0 = _cam_from_homography(Hm, W, H)
                        if p0 is None:
                            continue
                        cam = _params_to_cam(p0, W, H)
                        if cam.centre[2] < 0.5:
                            continue
                        crease_terms = list(zip(cs, ys))
                        rms = _lines_rms(cam, edge_terms, crease_terms)
                        # more confirmed creases is better evidence: small bonus per extra line
                        hyps.append((rms, p0, edge_terms, crease_terms, orient, ys))
    thr0 = max(2.0, 0.0025 * W)
    hyps.sort(key=lambda h_: (h_[0] > thr0, -len(h_[5]), h_[0]))
    out: List[Camera] = []
    for _, p0, edge_terms, crease_terms, orient, ys in hyps[:8]:
        try:
            sol = least_squares(_line_residuals, p0, args=(W, H, edge_terms, crease_terms),
                                loss="soft_l1", f_scale=1.5, max_nfev=200)
        except Exception:
            continue
        cam = _params_to_cam(sol.x, W, H)
        if cam.centre[2] < 0.5:
            continue
        cam.rms_px = _lines_rms(cam, edge_terms, crease_terms)
        cam.source = f"creases:{len(crease_terms)}+pitch_edges:2"
        cam.assign = ("orient", orient, tuple(round(y, 2) for y in ys))
        out.append(cam)
    # Two creases + two edges always fit exactly (4 lines fix a homography), so prefer hypotheses that explain
    # MORE lines within tolerance; only then compare residuals.
    thr = max(1.2, 0.0015 * W)
    out.sort(key=lambda c: (c.rms_px > thr, -len(c.assign[2]), c.rms_px))
    return out
