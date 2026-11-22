#!/usr/bin/env python3
"""
Synthetic broadcast-style delivery clips WITH exact ground truth, for demonstrating and validating the
tracking -> camera solve -> 3D flight -> DRS pipeline end to end.

Each clip is rendered through a pinhole camera (the same model the tracker solves for), with a textured
outfield and pitch, crease markings, 3D stumps and bails, a batter with pads, a shaded red ball with a
ground shadow and motion blur, sensor noise and H.264 compression. A JSON file next to every clip holds
the true bounce point, pad impact, ball position at the stump plane, speed and the correct DRS verdict.

Usage:
    python scripts/generate_hawkeye_synthetic.py [output_dir]
Requires ffmpeg on PATH.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))
from services.camera_geometry import Camera, look_at  # noqa: E402

G = 9.81
R_BALL = 0.036
HALF_L = 10.06
STUMP_H = 0.711
STUMP_HALF_W = 0.1143
W, H, FPS = 1280, 720, 50


# ----------------------------------------------------------------------------------------- physics
def simulate(release, v0, ez=0.52, ex=0.9, pad=None, dt=0.0005, t_end=2.2):
    """Ballistic flight with a turf bounce; stops at the pad (then drops/deflects) if `pad` is given."""
    X = np.array(release, float)
    V = np.array(v0, float)
    t = 0.0
    out = [(t, X.copy())]
    events = {}
    hit_pad = False
    while t < t_end:
        if not hit_pad:
            X = X + V * dt + np.array([0, 0, -0.5 * G * dt * dt])
            V = V + np.array([0, 0, -G * dt])
            if X[2] < R_BALL and V[2] < 0:
                X[2] = R_BALL
                if "bounce" not in events:
                    events["bounce"] = (t, X.copy(), V.copy())
                V = np.array([V[0] * 0.97, V[1] * ex, -V[2] * ez])
            if pad is not None and X[1] >= pad["y"] and abs(X[0] - pad["x"]) < 0.16 and X[2] < 0.75:
                hit_pad = True
                events["impact"] = (t, X.copy(), V.copy())
                V = np.array([0.9, -2.0, 0.6])  # deflects off the pad towards leg / back up the pitch
        else:
            X = X + V * dt + np.array([0, 0, -0.5 * G * dt * dt])
            V = V + np.array([0, 0, -G * dt])
            if X[2] < R_BALL:
                X[2] = R_BALL
                V = np.array([V[0] * 0.6, V[1] * 0.6, abs(V[2]) * 0.3])
        t += dt
        out.append((t, X.copy()))
    return out, events


def unobstructed_target(release, v0, ez=0.52, ex=0.9):
    """Where the ball would have crossed the stump plane had the pad not been there (true Hawk-Eye answer)."""
    path, ev = simulate(release, v0, ez, ex, pad=None, t_end=2.0)
    for (t0, a), (t1, b) in zip(path, path[1:]):
        if a[1] < HALF_L <= b[1]:
            k = (HALF_L - a[1]) / (b[1] - a[1])
            return a + k * (b - a), ev
    return None, ev


# ----------------------------------------------------------------------------------------- rendering
def background(cam: Camera, rng) -> np.ndarray:
    """Static scene via per-pixel ray casting onto the ground plane (vectorised)."""
    u, v = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    d = np.stack([(u - cam.cx) / cam.f, (v - cam.cy) / cam.f, np.ones_like(u)], -1) @ cam.R  # world dirs
    C = cam.centre
    s = -C[2] / np.where(d[..., 2] < -1e-6, d[..., 2], -1e-6)
    ground = d[..., 2] < -1e-6
    gx = C[0] + s * d[..., 0]
    gy = C[1] + s * d[..., 1]
    img = np.zeros((H, W, 3), np.float32)
    # sky / stands: soft gradient, darker band of stands near the horizon
    elev = d[..., 2] / np.linalg.norm(d, axis=-1)
    sky = np.stack([235 - 60 * elev, 215 - 40 * elev, 190 - 20 * elev], -1)
    stands = (elev < 0.06) & ~ground
    sky[stands] = [70, 80, 90]
    img[:] = sky
    # outfield grass with mowing stripes along the pitch and fine noise
    stripe = (np.floor((gy + 100) / 3.0) % 2).astype(np.float32)
    grass = np.stack([60 + 8 * stripe, 120 + 18 * stripe, 55 + 6 * stripe], -1)
    noise = rng.normal(0, 4, (H, W, 1)).astype(np.float32)
    img[ground] = (grass + noise)[ground]
    # pitch strip: straw/tan with texture, slightly worn in the middle
    pitch = ground & (np.abs(gx) <= 1.525) & (np.abs(gy) <= 11.0)
    wear = np.exp(-(gx ** 2) / 0.6) * 12
    tan = np.stack([140 - wear, 182 - wear, 205 - wear * 0.5], -1)
    img[pitch] = (tan + rng.normal(0, 6, (H, W, 1)))[pitch]
    # creases (white, 5 cm): popping & bowling creases, return creases at both ends
    lw = 0.05
    line = np.zeros((H, W), bool)
    for ys in (-1, 1):
        line |= (np.abs(gy - ys * 8.84) < lw / 2) & (np.abs(gx) <= 1.83)
        line |= (np.abs(gy - ys * HALF_L) < lw / 2) & (np.abs(gx) <= 1.32)
        for xs in (-1, 1):
            line |= (np.abs(gx - xs * 1.32) < lw / 2) & (ys * gy >= 8.84 - 1.22 * 0) & (ys * gy <= HALF_L + 1.22)
    img[ground & line] = [235, 240, 240]
    return np.clip(img, 0, 255).astype(np.uint8)


def draw_box(img, cam, x0, x1, y, z0, z1, color, shade=0.8):
    """Upright rectangle (vertical plane facing the pitch) as a filled projected polygon."""
    P = np.array([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]])
    if (cam.depth(P) <= 0.3).any():
        return
    q = cam.project(P).astype(np.int32)
    cv2.fillConvexPoly(img, q, color, lineType=cv2.LINE_AA)
    # simple side shading strip for volume
    mid = (q[1] + q[2]) // 2
    cv2.line(img, tuple(q[1]), tuple(q[2]), tuple(int(c * shade) for c in color), 2, cv2.LINE_AA)


def draw_stumps(img, cam, y):
    for xc in (-0.0968, 0.0, 0.0968):
        base = cam.project([[xc, y, 0.0]])[0]
        top = cam.project([[xc, y, STUMP_H]])[0]
        depth = cam.depth([[xc, y, 0.3]])[0]
        w = max(2, int(round(cam.f * 0.035 / depth)))
        p0 = tuple(np.round(base).astype(int)); p1 = tuple(np.round(top).astype(int))
        cv2.line(img, p0, p1, (150, 190, 215), w + 1, cv2.LINE_AA)       # wood edge
        cv2.line(img, p0, p1, (185, 222, 240), max(1, w - 1), cv2.LINE_AA)  # lit face
    # bails
    for a, b in ((-0.0968, 0.0), (0.0, 0.0968)):
        p = cam.project([[a, y, STUMP_H + 0.01], [b, y, STUMP_H + 0.01]]).astype(int)
        cv2.line(img, tuple(p[0]), tuple(p[1]), (120, 160, 190), 2, cv2.LINE_AA)


def draw_batter(img, cam, pad):
    """Right-handed batter at the crease: pads/legs, torso, helmet, bat. Drawn back-to-front."""
    y = pad["y"] + 0.12
    x = pad["x"]
    white, dark = (238, 238, 236), (70, 40, 25)
    draw_box(img, cam, x - 0.22, x - 0.06, y + 0.15, 0.0, 0.82, white)   # back leg
    draw_box(img, cam, x - 0.30, x + 0.30, y + 0.10, 0.80, 1.45, white)  # torso
    draw_box(img, cam, x - 0.12, x + 0.12, y + 0.08, 1.45, 1.72, dark)   # helmet
    draw_box(img, cam, x + 0.25, x + 0.33, y - 0.05, 0.10, 0.95, (120, 170, 205))  # bat
    draw_box(img, cam, x - 0.08, x + 0.10, y, 0.0, 0.80, white)          # front pad (in line)


def draw_ball(img, cam, X, alpha=1.0):
    dep = cam.depth([X])[0]
    if dep <= 0.3:
        return
    c = cam.project([X])[0]
    r = max(1.6, cam.f * R_BALL / dep)
    ri = int(np.ceil(r + 2))
    cx, cy = int(np.floor(c[0])), int(np.floor(c[1]))
    if not (ri <= cx < W - ri and ri <= cy < H - ri):
        return
    yy, xx = np.mgrid[-ri:ri + 1, -ri:ri + 1].astype(np.float32)
    dx, dy = xx + (cx - c[0]) + 0.5, yy + (cy - c[1]) + 0.5
    dist = np.sqrt(dx ** 2 + dy ** 2)
    cover = np.clip(r + 0.5 - dist, 0, 1)[..., None] * alpha
    light = np.clip(1.15 - 0.55 * ((dx + 0.35 * r) ** 2 + (dy + 0.35 * r) ** 2) / (r * r + 1e-6), 0.45, 1.15)
    col = np.stack([28 * light, 30 * light, 205 * light], -1)
    patch = img[cy - ri:cy + ri + 1, cx - ri:cx + ri + 1].astype(np.float32)
    img[cy - ri:cy + ri + 1, cx - ri:cx + ri + 1] = np.clip(patch * (1 - cover) + col * cover, 0, 255).astype(np.uint8)


def draw_shadow(img, cam, X):
    g = np.array([X[0] + 0.25 * X[2], X[1] + 0.1 * X[2], 0.0])  # sun from behind-left
    dep = cam.depth([g])[0]
    if dep <= 0.3:
        return
    c = cam.project([g])[0]
    r = cam.f * R_BALL / dep
    overlay = img.copy()
    cv2.ellipse(overlay, (int(c[0]), int(c[1])), (max(1, int(r * 1.3)), max(1, int(r * 0.6))), 0, 0, 360, (40, 70, 70), -1,
                cv2.LINE_AA)
    a = 0.45 * np.exp(-X[2] / 1.2)
    cv2.addWeighted(overlay, a, img, 1 - a, 0, img)


def render_clip(name, cam, release, v0, pad, out_dir: Path, rng, lead_s=0.8, tail_s=1.0, ez=0.52, ex=0.9):
    path, ev = simulate(release, v0, ez, ex, pad=pad, t_end=2.0)
    target, ev_free = unobstructed_target(release, v0, ez, ex)
    ts = np.array([p[0] for p in path]); Xs = np.array([p[1] for p in path])
    bg = background(cam, rng)
    t_imp = ev["impact"][0] if "impact" in ev else None
    n = int((lead_s + (t_imp or 0.7) + tail_s) * FPS)
    ffmpeg = shutil.which("ffmpeg")
    out = out_dir / f"{name}.mp4"
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                             "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], stdin=subprocess.PIPE)
    exposure = 1.0 / 120.0
    for i in range(n):
        t = i / FPS - lead_s
        frame = bg.copy()
        draw_stumps(frame, cam, -HALF_L)
        if 0 <= t <= ts[-1]:
            # shadow + 3-sample motion blur over the exposure
            Xc = Xs[min(len(Xs) - 1, np.searchsorted(ts, t))]
            draw_shadow(frame, cam, Xc)
        ball_layer = []
        if 0 <= t <= ts[-1]:
            for k in range(3):
                tk = t + (k - 1) * exposure / 2
                j = min(len(Xs) - 1, max(0, np.searchsorted(ts, tk)))
                ball_layer.append(Xs[j])
        # depth order: ball behind the batter is hidden by the batter (painter's algorithm)
        ball_behind = [X for X in ball_layer if X[1] > pad["y"] + 0.1] if pad else []
        ball_front = [X for X in ball_layer if X not in ball_behind] if pad else ball_layer
        draw_stumps(frame, cam, HALF_L)
        for X in ball_behind:
            draw_ball(frame, cam, X, alpha=0.6)
        if pad:
            draw_batter(frame, cam, pad)
        for X in ball_front:
            draw_ball(frame, cam, X, alpha=0.6 if len(ball_front) > 1 else 1.0)
        frame = np.clip(frame.astype(np.int16) + rng.normal(0, 2.2, frame.shape).astype(np.int16), 0, 255).astype(np.uint8)
        cv2.putText(frame, "SYNTHETIC TEST DELIVERY", (W - 250, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 240, 240), 1,
                    cv2.LINE_AA)
        proc.stdin.write(frame.tobytes())
    proc.stdin.close()
    proc.wait()

    # ground truth
    b_t, b_X, b_V = ev["bounce"]
    speed = float(np.linalg.norm(v0)) * 3.6
    gt = {"clip": out.name, "fps": FPS, "resolution": [W, H], "camera_position_m": cam.centre.round(3).tolist(),
          "focal_px": round(cam.f, 1), "release_video_time_s": lead_s, "release_speed_kmh": round(speed, 1),
          "bounce": {"x": round(float(b_X[0]), 3), "y": round(float(b_X[1]), 3), "video_time_s": round(lead_s + b_t, 3)},
          "length_from_stumps_m": round(HALF_L - float(b_X[1]), 2)}
    if "impact" in ev:
        i_t, i_X, _ = ev["impact"]
        gt["pad_impact"] = {"x": round(float(i_X[0]), 3), "y": round(float(i_X[1]), 3), "z": round(float(i_X[2]), 3),
                            "video_time_s": round(lead_s + i_t, 3)}
    if target is not None:
        gt["at_stump_plane"] = {"x": round(float(target[0]), 3), "z": round(float(target[2]), 3)}
        tx, tz = target[0], target[2]
        if abs(tx) <= STUMP_HALF_W and tz <= STUMP_H:
            wk = "HITTING"
        elif abs(tx) <= STUMP_HALF_W + R_BALL and tz <= STUMP_H + R_BALL:
            wk = "UMPIRE'S CALL"
        else:
            wk = "MISSING"
        pitching = "IN LINE" if abs(b_X[0]) <= STUMP_HALF_W + R_BALL else ("OUTSIDE OFF" if b_X[0] > 0 else "OUTSIDE LEG")
        imp = gt.get("pad_impact", {}).get("x", 0.0)
        impact = "IN LINE" if abs(imp) <= STUMP_HALF_W else "OUTSIDE"
        decision = ("NOT OUT (Pitched Outside Leg)" if pitching == "OUTSIDE LEG" else
                    "NOT OUT (Impact Outside)" if impact == "OUTSIDE" else
                    "OUT" if wk == "HITTING" else "UMPIRE'S CALL" if wk == "UMPIRE'S CALL" else "NOT OUT (Missing)")
        gt["expected_drs"] = {"pitching": pitching, "impact": impact, "wickets": wk, "decision": decision}
    (out_dir / f"{name}.ground_truth.json").write_text(json.dumps(gt, indent=2))
    return out, gt


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "sample_videos" / "synthetic"
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(2026)
    f = W / (2 * np.tan(np.radians(19.0) / 2))
    # Broadcast camera: high behind the bowler's arm, long lens, as on TV.
    cam = Camera(f, W / 2, H / 2, *look_at((0.9, -HALF_L - 26.0, 6.2), (0.0, 3.5, 0.4)), W, H)

    # 1) LBW OUT: 136 km/h, pitches on a good length in line, hits the pad in front, would hit middle/leg.
    rel = (0.35, -8.9, 2.15)
    v = 136 / 3.6
    t_b = (5.6 - rel[1]) / (v * 0.995)
    vz = (R_BALL - rel[2] + 0.5 * G * t_b ** 2) / t_b
    vx = (0.02 - rel[0]) / t_b
    v0 = np.array([vx, np.sqrt(max(1.0, v * v - vx * vx - vz * vz)), vz])
    render_clip("synthetic_lbw_out", cam, rel, v0, {"x": 0.0, "y": 8.75}, out_dir, rng)

    # 2) NOT OUT: angled in from wide of the crease, pitches outside leg stump.
    rel2 = (-1.05, -8.9, 2.1)
    v2 = 131 / 3.6
    t_b2 = (6.3 - rel2[1]) / (v2 * 0.995)
    vz2 = (R_BALL - rel2[2] + 0.5 * G * t_b2 ** 2) / t_b2
    vx2 = (-0.30 - rel2[0]) / t_b2
    v02 = np.array([vx2, np.sqrt(max(1.0, v2 * v2 - vx2 * vx2 - vz2 * vz2)), vz2])
    render_clip("synthetic_not_out_leg", cam, rel2, v02, {"x": -0.05, "y": 8.75}, out_dir, rng)
    print("written to", out_dir)


if __name__ == "__main__":
    main()
