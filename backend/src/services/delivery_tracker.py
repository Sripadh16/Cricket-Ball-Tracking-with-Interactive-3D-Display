"""
Delivery tracker: finds the one real delivery in a clip and reconstructs it.

Pipeline
1. One pass over the video collecting, per frame: camera shift (phase correlation),
   stump boxes (YOLO) and small moving ball-coloured blobs + small YOLO ball boxes.
2. A dynamic-programming search links candidates into the single most consistent
   fast-moving chain. Static false positives (caps, shoes, logos) can never form one.
3. When both sets of stumps are visible and separated across the image (side-on or
   oblique camera), the stumps give a metric scale at each end of the pitch, so each
   ball pixel maps to (distance down the pitch, height) in the vertical plane through
   the middle of the pitch.
4. A gravity-constrained fit (parabola before the bounce, parabola after it) turns the
   noisy samples into a smooth physical path, and the post-bounce path is projected to
   the stump plane for the DRS verdict.

World frame: x across the pitch, y down the pitch (bowler stumps -L/2, striker stumps
+L/2), z up. All metres.
"""
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

G = 9.81
BALL_R = 0.036
STUMP_H = 0.711
STUMP_HALF_W = 0.1143
PITCH_L = 20.12
STUMP_Y = PITCH_L / 2.0


def _capture_times(times: List[float], dups: List[bool], cuts: List[bool]) -> List[float]:
    """Evenly re-time the unique frames of each shot (undoes pulldown jitter from frame-rate conversion)."""
    t = np.array(times, dtype=np.float64)
    out = t.copy()
    n = len(t)
    start = 0
    for end in [i for i in range(1, n) if cuts[i]] + [n]:
        idx = [i for i in range(start, end) if not dups[i]]
        dup_idx = [i for i in range(start, end) if dups[i]]
        gaps = np.diff(dup_idx) if len(dup_idx) >= 4 else np.array([])
        # Only frame-rate conversion (pulldown) repeats frames on a regular cadence. Runs of identical frames from
        # a static tripod shot (nothing moving yet) are real time and must not be re-timed.
        periodic = (len(gaps) >= 3 and 3 <= float(np.median(gaps)) <= 8
                    and float(np.mean(np.abs(gaps - np.median(gaps)) <= 1)) >= 0.8)
        if periodic and len(idx) >= 4:
            j = np.arange(len(idx))
            b, a = np.polyfit(j, t[idx], 1)
            for k, i in enumerate(idx):
                out[i] = a + b * k
        start = end
    return out.tolist()


LINE_NOT_MEASURED = "LINE NOT MEASURED (Height Only)"


def _trim_chain_junk(chain: List[Dict[str, Any]], diag: float) -> List[Dict[str, Any]]:
    """Keep the real flight when the chain was bridged onto unrelated detections across a frame gap.

    A gap of 3+ frames splits the chain only if the jump across it disagrees with the motion on every side that
    has motion to compare, so a ball briefly hidden behind the bowler or umpire stays in one piece."""
    if len(chain) < 8:
        return chain

    def velocity(a, b):
        return np.array([b["sx"] - a["sx"], b["sy"] - a["sy"]]) / max(1, b["frame"] - a["frame"])

    segments, start = [], 0
    for i in range(len(chain) - 1):
        gap = chain[i + 1]["frame"] - chain[i]["frame"]
        if gap < 3:
            continue
        jump = np.array([chain[i + 1]["sx"] - chain[i]["sx"], chain[i + 1]["sy"] - chain[i]["sy"]])
        sides = []
        if i >= 1:
            sides.append(velocity(chain[i - 1], chain[i]))
        if i + 2 < len(chain):
            sides.append(velocity(chain[i + 1], chain[i + 2]))
        if all(np.hypot(*(jump - v * gap)) > 0.6 * np.hypot(*(v * gap)) + 0.01 * diag for v in sides):
            segments.append(chain[start:i + 1])
            start = i + 1
    segments.append(chain[start:])

    def travel(seg):
        return sum(min(float(np.hypot(b["sx"] - a["sx"], b["sy"] - a["sy"])), 0.03 * diag) for a, b in zip(seg, seg[1:]))

    best = max(segments, key=travel)
    return best if len(best) >= 6 else chain


def _apply(M: np.ndarray, x: float, y: float) -> Tuple[float, float]:
    v = M @ np.array([x, y, 1.0])
    return float(v[0] / v[2]), float(v[1] / v[2])


def _camera_step(prev_small: Optional[np.ndarray], small: np.ndarray, k: float) -> Tuple[np.ndarray, bool]:
    """Similarity transform (pan, zoom, roll) from the previous frame to this one, in full-res pixels.
    Returns (3x3 matrix, is_cut). Background corners are tracked with pyramidal LK and fitted with RANSAC,
    so moving players and the ball do not bias it. A failed fit means a camera cut."""
    if prev_small is None:
        return np.eye(3), True
    h, w = small.shape[:2]
    mask = np.zeros_like(prev_small)
    mask[int(0.06 * h):int(0.86 * h), :] = 255  # skip scorebug / logo bands
    pts = cv2.goodFeaturesToTrack(prev_small, maxCorners=300, qualityLevel=0.01, minDistance=7, mask=mask)
    if pts is None or len(pts) < 12:
        diff = float(np.mean(cv2.absdiff(prev_small, small)))
        return np.eye(3), diff > 25.0
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_small, small, pts, None, winSize=(21, 21), maxLevel=3)
    good = st.ravel() == 1
    if good.sum() < 10:
        return np.eye(3), True
    A, inl = cv2.estimateAffinePartial2D(pts[good], nxt[good], method=cv2.RANSAC, ransacReprojThreshold=2.0)
    if A is None or inl is None or inl.sum() < max(8, 0.35 * good.sum()):
        return np.eye(3), True
    scale = float(np.hypot(A[0, 0], A[1, 0]))
    if not (0.85 < scale < 1.18) or np.hypot(A[0, 2], A[1, 2]) > 0.15 * w:
        return np.eye(3), True
    M = np.eye(3)
    M[:2] = A
    M[:2, 2] *= k  # translation to full-res pixels (rotation/scale are resolution independent)
    return M, False


class DeliveryTracker:
    def __init__(self, yolo=None, progress_callback: Optional[Callable] = None, max_frames: int = 600):
        self.yolo = yolo
        self.progress_callback = progress_callback
        self.max_frames = max_frames

    # ------------------------------------------------------------------ pass 1
    def _scan(self, video_path: str) -> Optional[Dict[str, Any]]:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None
        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or not np.isfinite(fps) or fps <= 0 or fps > 1000:
            fps = 30.0
        n_meta = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        total = min(n_meta if 0 < n_meta < 10 ** 7 else self.max_frames, self.max_frames)
        names = getattr(self.yolo, "names", {}) if self.yolo is not None else {}
        two_class = len(names) <= 2
        yolo_every = 1 if total <= 900 else 2  # long clips: halve detector cost, colour/motion still every frame
        sample_every = max(1, total // 14)

        times, steps, cuts, dups, cands, stumps, samples = [], [], [], [], [], [], []
        prev_gray = prev_small = None
        kernel = np.ones((3, 3), np.uint8)
        W = H = None
        idx = 0
        while idx < self.max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if W is None:  # true decoded size (rotation metadata already applied by OpenCV)
                H, W = frame.shape[:2]
                diag = float(np.hypot(W, H))
                ps = min(1.0, 1280.0 / W)  # processing scale for colour/motion analysis
                Wp, Hp = int(round(W * ps)), int(round(H * ps))
                max_ball = max(14.0, 0.035 * W)
                max_ball_p = max(10.0, 0.035 * Wp)
                max_area_p = max(60.0, (0.012 * Wp) ** 2 * np.pi * 4)
                band_lo, band_hi = 0.05 * H, 0.95 * H  # broadcast banners / scorebugs live at the edges
            t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0
            if not np.isfinite(t) or (times and t <= times[-1]) or t < 0:
                t = (times[-1] + 1.0 / fps) if times else idx / fps
            times.append(float(t))

            pf = cv2.resize(frame, (Wp, Hp), interpolation=cv2.INTER_AREA) if ps < 1.0 else frame
            gray = cv2.cvtColor(pf, cv2.COLOR_BGR2GRAY)
            small = cv2.resize(gray, (480, int(round(480 * H / W))))
            # repeated frame from frame-rate conversion (e.g. 25 -> 30 fps): same picture, no new information
            # (a static tripod shot where only the ball moves still has a few strongly changed pixels)
            dup = prev_small is not None and int(np.count_nonzero(cv2.absdiff(prev_small, small) > 20)) == 0
            step, cut = (np.eye(3), False) if dup else _camera_step(prev_small, small, W / 480.0)
            steps.append(step)
            cuts.append(cut)
            dups.append(dup)
            if idx % sample_every == 0:
                sw = min(960, W)
                samples.append((idx, cv2.resize(frame, (sw, int(round(H * sw / W))))))

            frame_cands: List[Tuple[float, float, float, str]] = []
            frame_stumps: List[Tuple[float, float, float, float, float]] = []
            if self.yolo is not None and idx % yolo_every == 0:
                try:
                    res = self.yolo(frame, verbose=False, conf=0.12)[0]
                    for box in res.boxes:
                        cls_id = int(box.cls[0])
                        name = str(names.get(cls_id, cls_id)).lower()
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                        bw, bh = x2 - x1, y2 - y1
                        if name in ("stump", "stumps", "wicket"):
                            if conf >= 0.3 and bh > 1.2 * bw:
                                frame_stumps.append(((x1 + x2) / 2, y2, bh, bw, conf))
                        elif name in ("ball", "sports ball") or (cls_id == 0 and two_class):
                            if max(bw, bh) <= max_ball:
                                frame_cands.append(((x1 + x2) / 2, (y1 + y2) / 2, min(1.0, conf + 0.2), "yolo"))
                except Exception as exc:  # detector failure must not kill tracking
                    logger.debug("YOLO failed on frame %d: %s", idx, exc)

            if prev_gray is not None and not cut:
                M = step[:2].copy()
                M[:, 2] *= ps  # same similarity expressed in processing-scale pixels
                warped = cv2.warpAffine(prev_gray, M.astype(np.float32), (Wp, Hp), borderMode=cv2.BORDER_REPLICATE)
                moving = cv2.dilate((cv2.absdiff(gray, warped) > 16).astype(np.uint8), kernel, iterations=2)
                hsv = cv2.cvtColor(pf, cv2.COLOR_BGR2HSV)
                h, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
                # red (Test cricket) and pink (day/night) balls; white ball separately with a lower prior
                red = ((((h <= 8) | (h >= 168)) & (sat >= 90) & (val >= 70)) |
                       ((h >= 148) & (h < 168) & (sat >= 70) & (val >= 90))).astype(np.uint8)
                white = ((sat <= 45) & (val >= 205)).astype(np.uint8)
                for mask, label, conf in ((red, "red", 0.7), (white, "white", 0.35)):
                    m = cv2.morphologyEx(mask & moving, cv2.MORPH_CLOSE, kernel)
                    n, _, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=8)
                    blobs = []
                    for k in range(1, n):
                        area = stats[k, cv2.CC_STAT_AREA]
                        bw, bh = stats[k, cv2.CC_STAT_WIDTH], stats[k, cv2.CC_STAT_HEIGHT]
                        if area < 3 or area > max_area_p or max(bw, bh) > max_ball_p * 1.6:
                            continue
                        if max(bw, bh) / max(1, min(bw, bh)) > 3.0:
                            continue
                        fill = area / float(bw * bh)
                        if fill < 0.4:
                            continue
                        blobs.append((float(cents[k][0]) / ps, float(cents[k][1]) / ps, conf * (0.6 + 0.4 * fill), label))
                    blobs.sort(key=lambda b_: -b_[2])
                    frame_cands.extend(blobs[:6])

            cands.append([] if dup else
                         [c for c in frame_cands if band_lo <= c[1] <= band_hi and 0.01 * W <= c[0] <= 0.99 * W])
            stumps.append(frame_stumps)
            prev_gray, prev_small = gray, small
            idx += 1
            if self.progress_callback and (idx % 5 == 0 or idx == total):
                try:
                    self.progress_callback(idx, max(total, idx), stage="Tracking ball trajectory")
                except Exception:
                    pass
        cap.release()
        if idx < 4:
            return None

        # T[f] maps frame-0 ("stabilised") pixels to frame-f pixels; Tinv[f] the reverse
        T = np.zeros((idx, 3, 3))
        acc = np.eye(3)
        for f in range(idx):
            acc = steps[f] @ acc
            T[f] = acc
        Tinv = np.linalg.inv(T)
        t_capture = _capture_times(times, dups, cuts)
        return {"t_capture": t_capture, "dups": dups,"fps": fps, "W": W, "H": H, "diag": diag, "times": times, "samples": samples,
                "T": T, "Tinv": Tinv, "cuts": cuts, "cum": T[:, :2, 2], "cands": cands, "stumps": stumps, "n": idx}

    def select_delivery_chain(self, scan: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Pick the delivery: search each camera shot that shows stumps (broadcast clips also contain
        close-ups, replays from other angles, crowd shots) and keep the strongest moving-ball track."""
        n, cuts = scan["n"], scan.get("cuts") or [False] * scan["n"]
        bounds = [0] + [i for i in range(1, n) if cuts[i]] + [n]
        shots = [(a, b) for a, b in zip(bounds, bounds[1:]) if b - a >= 8]
        with_stumps = [(a, b) for a, b in shots
                       if sum(1 for f in range(a, b) if scan["stumps"][f]) >= 0.25 * (b - a)]
        search = with_stumps or [(0, n)]
        found = []  # (q, credible, coloured, chain)
        unit = 0.01 * scan["diag"]
        W = scan["W"]
        for a, b in search:
            # pitch corridor: a delivery travels between the two sets of stumps (image columns around them)
            st = self._stump_clusters(scan, a, b - 1)
            corridor = None
            if len(st) == 2:
                corridor = (min(st[0]["x"], st[1]["x"]) - 0.15 * W, max(st[0]["x"], st[1]["x"]) + 0.15 * W)
            for labels in (("yolo",), ("red", "yolo"), ("red", "yolo", "white")):
                view = dict(scan)
                view["cands"] = [list(c) if a <= f < b else [] for f, c in enumerate(scan["cands"])]
                for _ in range(3):  # the three strongest distinct tracks in this shot
                    ch = self._best_chain(view, labels)
                    if len(ch) < 5:
                        break
                    for c in ch:  # remove this track's detections before searching again
                        view["cands"][c["frame"]] = [d for d in view["cands"][c["frame"]]
                                                     if abs(d[0] - c["px"]) > 1.0 or abs(d[1] - c["py"]) > 1.0]
                    tc = scan["t_capture"]
                    if tc[ch[-1]["frame"]] - tc[ch[0]["frame"]] > 2.0:
                        # gap bridging can glue the delivery onto junk before/after it: keep the best <=1.5 s window
                        # (release to batter takes ~0.5-1.2 s)
                        best_w, best_wq = None, -1.0
                        for i0 in range(len(ch)):
                            j = i0
                            while j + 1 < len(ch) and tc[ch[j + 1]["frame"]] - tc[ch[i0]["frame"]] <= 1.5:
                                j += 1
                            win = ch[i0:j + 1]
                            if len(win) < 6:
                                continue
                            mvw = [np.array([b_["sx"] - a_["sx"], b_["sy"] - a_["sy"]]) for a_, b_ in zip(win, win[1:])]
                            dq = sum(min(float(np.hypot(*m)) / unit, 3.0) for m in mvw)
                            mvw = [m for m in mvw if np.hypot(*m) > 0.002 * scan["diag"]]
                            turns = sum(1 for m1, m2 in zip(mvw, mvw[1:])
                                        if float(np.dot(m1, m2) / (np.hypot(*m1) * np.hypot(*m2))) < 0.5)
                            yq = 0.85 + 0.3 * float(np.mean([c.get("label") == "yolo" for c in win]))
                            wq = dq * yq * max(0.05, 1.0 - max(0, turns - 2) / max(1, len(mvw) - 1)) ** 2
                            if wq > best_wq:
                                best_w, best_wq = win, wq
                        if best_w is None:
                            continue
                        ch = best_w
                    # evidence = ground covered (capped per step), weighted by time spent in the pitch corridor
                    q = sum(min(float(np.hypot(b_["sx"] - a_["sx"], b_["sy"] - a_["sy"])) / unit, 3.0)
                            for a_, b_ in zip(ch, ch[1:]))
                    if corridor is not None:
                        inside = float(np.mean([corridor[0] <= c["sx"] <= corridor[1] for c in ch]))
                        q *= 0.2 + 0.8 * inside
                    # smoothness: a ball in flight keeps its direction (one turn at the dip / bounce); junk wanders
                    mv = [np.array([b_["sx"] - a_["sx"], b_["sy"] - a_["sy"]]) for a_, b_ in zip(ch, ch[1:])]
                    mv = [m for m in mv if np.hypot(*m) > 0.002 * scan["diag"]]  # ignore sub-pixel jitter
                    if len(mv) >= 3:
                        cosines = [float(np.dot(m1, m2) / (np.hypot(*m1) * np.hypot(*m2))) for m1, m2 in zip(mv, mv[1:])]
                        sharp = sum(1 for c_ in cosines if c_ < 0.5)  # > 60 degree turns
                        q *= max(0.05, 1.0 - max(0, sharp - 2) / max(1, len(cosines))) ** 2
                    else:
                        sharp = 0
                    coloured = "white" not in labels
                    # how much of the track the trained ball detector itself confirms (colour blobs also fire on
                    # maroon kit trim, logos and adverts; the detector does not)
                    yolo_frac = float(np.mean([c.get("label") == "yolo" for c in ch]))
                    q *= 0.85 + 0.3 * yolo_frac
                    in_corr = corridor is None or float(np.mean([corridor[0] <= c["sx"] <= corridor[1] for c in ch])) >= 0.5
                    span = scan["t_capture"][ch[-1]["frame"]] - scan["t_capture"][ch[0]["frame"]]
                    # a delivery lasts about a second (longer only in slow motion, where the detector sees it well)
                    plausible_time = span <= 4.0  # covers a 4x slow-motion replay of a ~1 s delivery
                    credible = len(ch) >= 6 and sharp <= 3 and in_corr and plausible_time
                    found.append((q, credible, coloured, ch, labels == ("yolo",)))
        # A credible coloured-ball / detector track always beats white blobs (shirts, pads, sightscreens); white
        # candidates only decide when no coloured track is credible (e.g. white-ball footage).
        for pool in ([f_ for f_ in found if f_[2] and f_[1]], [f_ for f_ in found if f_[1]], found):
            if pool:
                return self._extend_chain(scan, max(pool, key=lambda f_: f_[0])[3])
        return []

    @staticmethod
    def _extend_chain(scan: Dict[str, Any], ch: List[Dict[str, Any]], max_gap: int = 8) -> List[Dict[str, Any]]:
        """Track continuation: extend the chosen delivery forwards/backwards through short occlusions (pads, umpire)
        by predicting the next image position from the recent motion (quadratic in time) and accepting only
        coloured / detector candidates inside a tight gate around the prediction."""
        if len(ch) < 4:
            return ch
        Tinv, tc, cuts, diag = scan["Tinv"], scan["t_capture"], scan["cuts"], scan["diag"]
        ch = list(ch)
        for direction in (1, -1):
            misses = 0
            while misses < max_gap:
                ref = ch[-4:] if direction == 1 else ch[:4]
                f_next = (ref[-1]["frame"] if direction == 1 else ref[0]["frame"]) + direction * (misses + 1)
                if f_next < 0 or f_next >= scan["n"] or cuts[max(f_next, (ref[-1] if direction == 1 else ref[0])["frame"])]:
                    break
                t_ref = np.array([tc[c["frame"]] for c in ref])
                deg = 2 if len(ref) >= 4 else 1
                px = np.polyfit(t_ref, [c["sx"] for c in ref], deg)
                py = np.polyfit(t_ref, [c["sy"] for c in ref], deg)
                pred = np.array([np.polyval(px, tc[f_next]), np.polyval(py, tc[f_next])])
                end = ref[-1] if direction == 1 else ref[0]
                step = float(np.hypot(pred[0] - end["sx"], pred[1] - end["sy"]))
                gate = 0.35 * step + 0.004 * diag
                best, best_d = None, gate
                for (x, y, c, lab) in scan["cands"][f_next]:
                    if lab == "white":
                        continue
                    sx_, sy_ = _apply(Tinv[f_next], x, y)
                    d = float(np.hypot(sx_ - pred[0], sy_ - pred[1]))
                    if d < best_d:
                        best, best_d = {"frame": f_next, "sx": sx_, "sy": sy_, "px": x, "py": y, "conf": c, "label": lab}, d
                if best is None:
                    misses += 1
                    continue
                misses = 0
                if direction == 1:
                    ch.append(best)
                else:
                    ch.insert(0, best)
        return ch

    # ------------------------------------------------------------ chain search
    @staticmethod
    def _best_chain(scan: Dict[str, Any], labels: Tuple[str, ...]) -> List[Dict[str, Any]]:
        diag, Tinv, cuts = scan["diag"], scan["Tinv"], scan["cuts"]
        nodes = []  # (frame, sx, sy, conf, px, py)
        frame_nodes: Dict[int, List[int]] = {}
        for f, fc in enumerate(scan["cands"]):
            for (x, y, c, lab) in fc:
                if lab not in labels:
                    continue
                frame_nodes.setdefault(f, []).append(len(nodes))
                sx_, sy_ = _apply(Tinv[f], x, y)
                nodes.append((f, sx_, sy_, c, x, y, lab))
        if len(nodes) < 5:
            return []

        vmin, vmax = 0.0008 * diag, 0.12 * diag  # end-on views: the ball can move ~1 px/frame mid-flight
        unit = 0.01 * diag
        incoming: Dict[int, List[Tuple[float, int, Optional[Tuple[int, int]], np.ndarray]]] = {}
        best_score, best_edge = -1.0, None
        back: Dict[Tuple[int, int], Optional[Tuple[int, int]]] = {}
        for f in sorted(frame_nodes):
            for j in frame_nodes[f]:
                pj = np.array(nodes[j][1:3])
                for gap in (1, 2, 3, 4, 5, 6):  # the ball can vanish behind the umpire / bowler for a few frames
                    if any(cuts[f - g] for g in range(gap) if f - g >= 0):
                        continue  # a camera cut between these frames: different shot, no link
                    for i in frame_nodes.get(f - gap, ()):
                        if gap > 3 and not (nodes[i][6] == "yolo" and nodes[j][6] == "yolo"):
                            continue  # long gaps only between trained-detector hits; colour blobs are too noisy
                        step = pj - np.array(nodes[i][1:3])
                        v = step / gap
                        speed = float(np.hypot(*v))
                        if speed > vmax:
                            continue
                        if speed < vmin:
                            # a near-stationary link (the ball "turning" in an end-on view) is allowed only to
                            # continue an existing track, and earns almost nothing: drifting objects cannot win
                            if not incoming.get(i):
                                continue
                            gain = 0.15 * (0.5 + nodes[j][3])
                        else:
                            gain = (0.15 + min(speed * gap / unit, 3.0)) * (0.5 + nodes[j][3]) - 0.4 * (gap - 1)
                        score, prev = gain, None
                        for (s_in, h, _, v_in) in incoming.get(i, ()):
                            dv = float(np.hypot(*(v - v_in)))
                            tol = 0.9 * float(np.hypot(*v_in)) + 0.006 * diag
                            if dv > tol:
                                continue
                            cand = s_in + gain - 0.5 * dv / tol  # image paths legitimately turn (dip, bounce)
                            if cand > score:
                                score, prev = cand, (h, i)
                        incoming.setdefault(j, []).append((score, i, prev, v))
                        back[(i, j)] = prev
                        if score > best_score:
                            best_score, best_edge = score, (i, j)
                if j in incoming and len(incoming[j]) > 12:
                    incoming[j] = sorted(incoming[j], key=lambda e: -e[0])[:12]
        if best_edge is None:
            return []
        order = [best_edge[1]]
        edge: Optional[Tuple[int, int]] = best_edge
        while edge is not None:
            order.append(edge[0])
            edge = back.get(edge)
        order.reverse()
        return [{"frame": nodes[k][0], "sx": nodes[k][1], "sy": nodes[k][2],
                 "px": nodes[k][4], "py": nodes[k][5], "conf": nodes[k][3], "label": nodes[k][6]} for k in order]

    # ---------------------------------------------------------- stump geometry
    @staticmethod
    def _stump_clusters(scan: Dict[str, Any], f0: int, f1: int) -> List[Dict[str, float]]:
        """Stable stump detections near the delivery, in frame-0-stabilised pixels, strongest first."""
        W, Tinv, cuts = scan["W"], scan["Tinv"], scan["cuts"]
        dets = []
        # only the shot that contains the delivery (stop at camera cuts on either side)
        lo = f0
        while lo > max(0, f0 - 30) and not cuts[lo]:
            lo -= 1
        hi = f1
        while hi < min(scan["n"] - 1, f1 + 30) and not cuts[hi + 1]:
            hi += 1
        for f in range(lo, hi + 1):
            zoom = float(np.sqrt(abs(np.linalg.det(Tinv[f][:2, :2]))))
            for (cx, by, bh, bw, conf) in scan["stumps"][f]:
                bx, byy = _apply(Tinv[f], cx, by)
                dets.append((bx, byy, bh * zoom, conf))
        clusters: List[List[Tuple[float, float, float, float]]] = []
        for d in sorted(dets, key=lambda d: -d[3]):
            for cl in clusters:
                mx = np.median([c[0] for c in cl]); my = np.median([c[1] for c in cl])
                if abs(d[0] - mx) < 0.05 * W and abs(d[1] - my) < 0.06 * W:
                    cl.append(d)
                    break
            else:
                clusters.append([d])
        clusters = [c for c in clusters if len(c) >= 4]
        clusters.sort(key=lambda c: -sum(d[3] for d in c))
        out: List[Dict[str, float]] = []
        for cl in clusters:
            c = {"x": float(np.median([d[0] for d in cl])), "y": float(np.median([d[1] for d in cl])),
                 "h": float(np.median([d[2] for d in cl])), "n": len(cl)}
            if all(abs(c["x"] - o["x"]) > 0.03 * W or abs(c["y"] - o["y"]) > 0.6 * max(c["h"], o["h"]) for o in out):
                out.append(c)
            if len(out) == 2:
                break
        return out

    @classmethod
    def _stump_pair(cls, scan: Dict[str, Any], f0: int, f1: int) -> Optional[Tuple[Dict, Dict]]:
        cl = cls._stump_clusters(scan, f0, f1)
        if len(cl) == 2 and abs(cl[0]["x"] - cl[1]["x"]) > 0.12 * scan["W"]:
            return cl[0], cl[1]
        return None

    @staticmethod
    def _to_plane(px: float, py: float, near: Dict, far: Dict) -> Tuple[float, float]:
        """Pixel -> (lambda along bowler->striker stumps, height m) in the pitch's vertical mid-plane."""
        kb, ks = near["h"] / STUMP_H, far["h"] / STUMP_H
        a = (near["x"] - px) / kb
        b = (far["x"] - px) / ks
        lam = a / (a - b) if abs(a - b) > 1e-9 else 0.5
        depth = (1 - lam) / kb + lam / ks
        if depth <= 1e-6:
            return lam, 0.0
        gy = ((1 - lam) * near["y"] / kb + lam * far["y"] / ks) / depth
        return lam, (gy - py) * depth

    # ---------------------------------------------------------------- physics
    @staticmethod
    def _fit_flight(t: np.ndarray, y: np.ndarray, z: np.ndarray) -> Dict[str, Any]:
        """Gravity-constrained fit. Returns model params in *video* time with time scale s."""
        n = len(t)
        v_video = (y[-1] - y[0]) / max(1e-6, t[-1] - t[0])

        def para(tt, zz, g):
            A = np.stack([np.ones_like(tt), tt], axis=1)
            coef, *_ = np.linalg.lstsq(A, zz + 0.5 * g * tt ** 2, rcond=None)
            res = zz - (coef[0] + coef[1] * tt - 0.5 * g * tt ** 2)
            return coef, float(np.sum(res ** 2))

        def solve(g):
            best = None
            for k in range(2, n - 1):
                c1, e1 = para(t[:k], z[:k], g)
                c2, e2 = para(t[k:], z[k:], g) if n - k >= 2 else (None, 0.0)
                if c2 is None or abs(c2[1] - c1[1]) < 1e-6:
                    continue
                tb = (c1[0] - c2[0]) / (c2[1] - c1[1])
                if not (t[k - 1] - 1e-6 <= tb <= t[k] + 1e-6):
                    continue
                vz_in = c1[1] - g * tb
                vz_out = c2[1] - g * tb
                if vz_in >= 0 or vz_out <= 0:
                    continue
                if best is None or e1 + e2 < best["sse"]:
                    best = {"k": k, "tb": float(tb), "c1": c1, "c2": c2, "sse": e1 + e2}
            c0, e0 = para(t, z, g)
            return best, c0, e0

        # Slow-motion check: free curvature of the whole pre-bounce arc vs. gravity.
        scale = 1.0
        best, c0, e0 = solve(G)
        if abs(v_video) < 12.5:  # < 45 km/h in video time: almost certainly slow motion
            for s_try in (0.5, 0.25, 0.125):
                b2, c02, e02 = solve(G * s_try ** 2)
                err_now = best["sse"] if best else e0
                err_try = b2["sse"] if b2 else e02
                if err_try < err_now and abs(v_video) / s_try < 45.0:
                    scale, best, c0, e0 = s_try, b2, c02, e02
        g_eff = G * scale ** 2

        has_bounce = best is not None and best["sse"] < 0.8 * e0
        out: Dict[str, Any] = {"scale": scale, "g_eff": g_eff, "has_bounce": has_bounce}
        if has_bounce:
            tb = best["tb"]
            zb = best["c1"][0] + best["c1"][1] * tb - 0.5 * g_eff * tb ** 2
            # y: continuous piecewise-linear with the knee at the bounce
            A = np.stack([np.ones_like(t), np.minimum(t, tb) - tb, np.maximum(t - tb, 0.0)], axis=1)
            (yb, v0, v1), *_ = np.linalg.lstsq(A, y, rcond=None)
            if n - best["k"] < 3 or not (0.45 * v0 <= v1 <= 1.02 * v0):
                v1 = float(np.clip(v1, 0.6 * v0, 0.95 * v0))
            out.update({"tb": float(tb), "z_offset": float(zb - BALL_R), "yb": float(yb), "v0": float(v0),
                        "v1": float(v1), "c1": best["c1"], "c2": best["c2"]})
        else:
            A = np.stack([np.ones_like(t), t], axis=1)
            (y0, v0), *_ = np.linalg.lstsq(A, y, rcond=None)
            out.update({"tb": None, "z_offset": 0.0, "y0": float(y0), "v0": float(v0), "c1": c0})
            # The tracked arc may end just before the ball lands (yorker / full length). If the fitted
            # arc reaches the ground short of the stumps, infer the bounce with a typical restitution.
            disc = c0[1] ** 2 + 2 * g_eff * (c0[0] - BALL_R)
            if disc > 0:
                tg = (c0[1] + np.sqrt(disc)) / g_eff
                yg = y0 + v0 * tg
                if tg > t[0] and yg < STUMP_Y - 0.05:
                    vz_out = 0.55 * abs(c0[1] - g_eff * tg)
                    c2_1 = vz_out + g_eff * tg
                    c2 = np.array([BALL_R - c2_1 * tg + 0.5 * g_eff * tg ** 2, c2_1])
                    out.update({"has_bounce": True, "bounce_inferred": True, "tb": float(tg), "yb": float(yg),
                                "v1": float(0.88 * v0), "c2": c2})
        return out

    @staticmethod
    def _model_at(model: Dict[str, Any], t: float) -> Tuple[float, float, float, float]:
        """(y, z, vy, vz) at video time t; velocities in real m/s."""
        g, s = model["g_eff"], model["scale"]
        if model["has_bounce"]:
            tb = model["tb"]
            if t <= tb:
                c = model["c1"]; y = model["yb"] + model["v0"] * (t - tb); vy = model["v0"]
            else:
                c = model["c2"]; y = model["yb"] + model["v1"] * (t - tb); vy = model["v1"]
        else:
            c = model["c1"]; y = model["y0"] + model["v0"] * t; vy = model["v0"]
        z = c[0] + c[1] * t - 0.5 * g * t * t - model["z_offset"]
        vz = c[1] - g * t
        return float(y), float(max(BALL_R, z)), float(vy / s), float(vz / s)

    # -------------------------------------------------------------------- main
    def analyse(self, video_path: str) -> Optional[Dict[str, Any]]:
        scan = self._scan(video_path)
        if scan is None:
            return None
        chain = _trim_chain_junk(self.select_delivery_chain(scan), scan["diag"])
        if len(chain) >= 5:
            net = float(np.hypot(chain[-1]["sx"] - chain[0]["sx"], chain[-1]["sy"] - chain[0]["sy"]))
            span_t = scan["t_capture"][chain[-1]["frame"]] - scan["t_capture"][chain[0]["frame"]]
            if len(chain) < 6 or (net < 0.08 * scan["diag"] and (len(chain) < 8 or span_t < 0.2)):
                chain = []  # too short to be a delivery (noise, flicker, people moving)
        if len(chain) < 5:
            logger.info("Delivery tracker: no consistent moving-ball chain found")
            return {"status": "no_ball", "scan": scan}

        times = scan["t_capture"]
        result: Dict[str, Any] = {"status": "chain", "scan": scan, "chain": chain,
                                  "video_info": {"fps": scan["fps"], "width": scan["W"], "height": scan["H"]}}

        inputs = self.geometry_inputs(scan, chain)
        result["geometry_inputs"] = inputs
        general = None
        try:
            general = self.reconstruct(inputs, corners=getattr(self, "manual_corners", None))
        except Exception as exc:  # never lose the delivery because the general solver failed
            logger.warning("General reconstruction failed: %s", exc)
        if general is not None and ((general.get("drs") or {}).get("release_speed_kmh") or 0.0) > 165.0:
            # faster than any bowler has ever bowled: the tracked "flight" is not a delivery (e.g. the ball after
            # the shot running back across the frame)
            logger.info("General reconstruction rejected: %.0f km/h is not a bowled delivery",
                        general["drs"]["release_speed_kmh"])
            general = None
        line_ok = general is not None and general.get("line_sigma_m") is not None and general["line_sigma_m"] <= 0.08

        def fallback(res):
            if general is not None:
                res.update(general)
            return res

        if line_ok:  # full 3D (line + length + height) measured from this camera
            result.update(general)
            return result

        # Line not observable from this angle: the stump-plane method measures height/length more robustly.
        pair = self._stump_pair(scan, chain[0]["frame"], chain[-1]["frame"])
        if pair is None:
            return fallback(result)
        a, b = pair
        axis_dx, axis_dy = abs(a["x"] - b["x"]), abs(a["y"] - b["y"])
        if axis_dx < 0.8 * axis_dy:  # end-on camera: this geometry is ill-conditioned
            return fallback(result)

        # Orient bowler -> striker using the direction the ball actually travels.
        lam_ab = [self._to_plane(c["sx"], c["sy"], a, b)[0] for c in chain]
        half = max(2, len(chain) // 2)
        near, far = (a, b) if np.median(lam_ab[-half:]) > np.median(lam_ab[:half]) else (b, a)

        samples = []
        for c in chain:
            lam, z = self._to_plane(c["sx"], c["sy"], near, far)
            samples.append({"f": c["frame"], "t": times[c["frame"]], "y": -STUMP_Y + lam * PITCH_L, "z": z,
                            "px": c["px"], "py": c["py"], "conf": c["conf"]})

        # Flight = longest run of sustained forward speed (drops the arm swing and anything after contact).
        vy = [(samples[i + 1]["y"] - samples[i]["y"]) / max(1e-6, samples[i + 1]["t"] - samples[i]["t"])
              for i in range(len(samples) - 1)]
        pos = [v for v in vy if v > 0]
        if len(pos) < 4:
            return fallback(result)
        v_ref = float(np.percentile(pos, 70))
        runs, start = [], None
        for i, v in enumerate(vy + [0.0]):
            good = v > 0.45 * v_ref and v < 2.2 * v_ref
            if good and start is None:
                start = i
            elif not good and start is not None:
                runs.append((start, i)); start = None
        if not runs:
            return fallback(result)
        i0, i1 = max(runs, key=lambda r: samples[r[1]]["y"] - samples[r[0]]["y"])
        flight = [s for s in samples[i0:i1 + 1] if -STUMP_Y - 3.0 <= s["y"] <= STUMP_Y + 2.5 and -0.6 <= s["z"] <= 4.5]
        if len(flight) < 5 or flight[-1]["y"] - flight[0]["y"] < 5.0:
            return fallback(result)

        t = np.array([s["t"] for s in flight]); y = np.array([s["y"] for s in flight]); z = np.array([s["z"] for s in flight])
        t0 = float(t[0])
        model = self._fit_flight(t - t0, y, z)
        scale = model["scale"]
        _, _, vy0, vz0 = self._model_at(model, 0.0)
        if float(np.hypot(vy0, vz0)) * 3.6 > 165.0:
            # Faster than any bowler has ever bowled: the "flight" is not a delivery seen from the side (e.g. the
            # ball deflecting off the batter across the frame after an occluded delivery). Report no 3D result.
            logger.info("Stump-plane flight rejected: %.0f km/h is not a bowled delivery",
                        float(np.hypot(vy0, vz0)) * 3.6)
            return fallback(result)
        peak_z = max(self._model_at(model, float(tv) - t0)[1] for tv in t)
        if len(flight) < 6 or peak_z > 3.2:
            # Too little evidence, or a "delivery" flying above any possible release height: the track is not the
            # ball in flight along the pitch, so report no 3D result rather than an invented one.
            logger.info("Stump-plane flight rejected: %d points, peak height %.1f m", len(flight), peak_z)
            return fallback(result)

        # Emit one fitted point per video frame, keeping the measured pixel for the 2D overlay.
        f_first, f_last = flight[0]["f"], flight[-1]["f"]
        meas = {s["f"]: s for s in flight}
        fr = np.array([s["f"] for s in flight], dtype=float)
        points: List[Dict[str, Any]] = []
        tb_abs = t0 + model["tb"] if model["has_bounce"] else None

        def make(tv: float, frame: Optional[int], phase: str) -> Dict[str, Any]:
            yy, zz, vyy, vzz = self._model_at(model, tv - t0)
            m = meas.get(frame) if frame is not None else None
            p = {"x": 0.0, "y": round(yy, 4), "z": round(zz, 4), "t": round(tv, 4), "phase": phase,
                 "vx": 0.0, "vy": round(vyy, 3), "vz": round(vzz, 3),
                 "speed_kmh": round(float(np.hypot(vyy, vzz)) * 3.6, 1),
                 "confidence": round(float(m["conf"]) if m else 0.6, 3),
                 "is_predicted": m is None}
            if frame is not None and frame < f_first:
                p["frame_idx"] = int(frame)
                p["phase_note"] = "release_backprojection"
            elif frame is not None:
                p["frame_idx"] = int(frame)
                p["pixel_x"] = float(m["px"]) if m else float(np.interp(frame, fr, [s["px"] for s in flight]))
                p["pixel_y"] = float(m["py"]) if m else float(np.interp(frame, fr, [s["py"] for s in flight]))
            return p

        # Back-project the fitted flight to the release (the bowler usually hides the first few metres).
        RELEASE_Y = -STUMP_Y + 1.9
        f_start = f_first
        while f_start > 0 and self._model_at(model, times[f_start - 1] - t0)[0] >= RELEASE_Y:
            f_start -= 1
        bounce_point = None
        for f in range(f_start, f_last + 1):
            tv = times[f]
            if tb_abs is not None and bounce_point is None and tv >= tb_abs:
                bounce_point = make(tb_abs, None, "bounce")
                bounce_point["z"] = BALL_R
                if abs(tv - tb_abs) > 1e-3:
                    points.append(bounce_point)
            phase = "trajectory" if tb_abs is None else ("pre_bounce" if tv < tb_abs else "post_bounce")
            points.append(make(tv, f, phase))
        if tb_abs is not None and bounce_point is None:  # lands after the last tracked frame
            bounce_point = make(tb_abs, None, "bounce")
            bounce_point["z"] = BALL_R
            bounce_point["is_predicted"] = True
        elif bounce_point is not None and "pixel_x" not in bounce_point:
            bounce_point["pixel_x"] = float(np.interp(tb_abs, t, [s["px"] for s in flight]))
            bounce_point["pixel_y"] = float(np.interp(tb_abs, t, [s["py"] for s in flight]))

        drs = self._evaluate(model, points, bounce_point, t0)
        drs["release_speed_px_per_sec"] = round(float(np.hypot(flight[-1]["px"] - flight[0]["px"],
                                                               flight[-1]["py"] - flight[0]["py"]) / max(1e-6, t[-1] - t[0])), 1)
        resid = np.array([self._model_at(model, s["t"] - t0)[1] - (s["z"] - model["z_offset"]) for s in flight])
        result.update({
            "status": "reconstructed", "points": points, "drs": drs,
            "time_scale": scale, "fit_rms_m": round(float(np.sqrt(np.mean(resid ** 2))), 3),
            "measured_points": len(flight), "frames": (f_first, f_last),
            "stumps_px": {"bowler_end": near, "striker_end": far},
        })
        return result

    def _evaluate(self, model: Dict[str, Any], points: List[Dict[str, Any]],
                  bounce_point: Optional[Dict[str, Any]], t0: float) -> Dict[str, Any]:
        scale = model["scale"]
        drs: Dict[str, Any] = {"pre_bounce_points": [], "post_bounce_points": [], "extrapolated_points": [],
                               "bounce_point": None, "impact_point": None, "stump_plane_target": None,
                               "drs_evaluation": None, "release_speed_kmh": None, "bounce_speed_kmh": None,
                               "length_zone": None}
        first = points[0]
        drs["release_speed_kmh"] = round(float(np.hypot(first["vy"], first["vz"])) * 3.6, 1)

        if bounce_point is not None:
            bi = next((i for i, p in enumerate(points) if p["t"] >= bounce_point["t"]), None)
            if bi is None:
                drs["pre_bounce_points"] = points
            else:
                drs["pre_bounce_points"] = points[:bi]
                drs["post_bounce_points"] = points[bi:] if points[bi] is bounce_point else [bounce_point] + points[bi:]
            drs["bounce_point"] = {k: bounce_point[k] for k in ("x", "y", "z", "t", "phase")}
            _, _, vy_b, vz_b = self._model_at(model, bounce_point["t"] - t0 + 1e-4)
            drs["bounce_speed_kmh"] = round(float(np.hypot(vy_b, vz_b)) * 3.6, 1)
            dist = STUMP_Y - bounce_point["y"]
            drs["length_zone"] = ("Yorker" if dist < 2.0 else "Full" if dist < 4.0 else "Good Length" if dist < 7.0
                                  else "Short of Length" if dist < 9.5 else "Bouncer")
        else:
            drs["pre_bounce_points"] = points
            drs["length_zone"] = "Full Toss"

        last = points[-1]
        target_z = None
        if last["y"] >= STUMP_Y:  # tracked through the stump plane: read the height directly
            for p0, p1 in zip(points, points[1:]):
                if p0["y"] < STUMP_Y <= p1["y"]:
                    fr = (STUMP_Y - p0["y"]) / max(1e-9, p1["y"] - p0["y"])
                    target_z = p0["z"] + fr * (p1["z"] - p0["z"])
                    drs["impact_point"] = dict(p0, phase="impact")
                    break
        if target_z is None:
            drs["impact_point"] = dict(last, phase="impact")
            # continue the fitted flight (video-time model) until the stump plane
            tv, dt = last["t"], 0.008 / max(scale, 1e-3)
            extra = [dict(last, phase="extrapolated", is_predicted=True)]
            tb_abs = bounce_point["t"] if bounce_point is not None else None
            for _ in range(600):
                if tb_abs is not None and tv < tb_abs < tv + dt:
                    extra.append(dict(bounce_point, phase="extrapolated", is_predicted=True))
                tv += dt
                yy, zz, vyy, vzz = self._model_at(model, tv - t0)
                extra.append({"x": 0.0, "y": round(yy, 4), "z": round(zz, 4), "t": round(tv, 4),
                              "phase": "extrapolated", "confidence": 0.6, "is_predicted": True,
                              "vx": 0.0, "vy": round(vyy, 3), "vz": round(vzz, 3),
                              "speed_kmh": round(float(np.hypot(vyy, vzz)) * 3.6, 1)})
                landed = zz <= BALL_R and vzz < 0 and (tb_abs is None or tv > tb_abs + 0.02)
                if yy >= STUMP_Y + 0.15 or (landed and yy > last["y"] + 0.3):
                    break
            drs["extrapolated_points"] = extra
            for p0, p1 in zip(extra, extra[1:]):
                if p0["y"] < STUMP_Y <= p1["y"]:
                    fr = (STUMP_Y - p0["y"]) / max(1e-9, p1["y"] - p0["y"])
                    target_z = p0["z"] + fr * (p1["z"] - p0["z"])
                    break
            if target_z is None:
                target_z = extra[-1]["z"] if extra[-1]["y"] >= STUMP_Y - 0.3 else BALL_R

        if target_z <= STUMP_H - BALL_R:
            wickets = "HITTING"
        elif target_z <= STUMP_H + BALL_R:
            wickets = "UMPIRE'S CALL"
        else:
            wickets = "MISSING"
        # Going over the top is certain from height alone; hitting the stumps also needs the line, unseen side-on.
        decision = "NOT OUT (Going Over Stumps)" if wickets == "MISSING" else LINE_NOT_MEASURED
        drs["stump_plane_target"] = {"x": 0.0, "y": STUMP_Y, "z": round(float(target_z), 4),
                                     "hit_stump": "Middle Stump" if wickets != "MISSING" else "Over Stumps"}
        drs["drs_evaluation"] = {
            "decision": decision,
            "pitching": "IN LINE" if bounce_point is not None else "FULL TOSS",
            "impact": "IN LINE",
            "wickets": wickets,
            "hit_stump": drs["stump_plane_target"]["hit_stump"],
            "height_at_stumps_m": round(float(target_z), 3),
            "line_observable": False,
            "note": "Side-on camera: height and length are measured; line (off/leg) is not observable and is assumed on middle.",
        }
        return drs


# =============================================================================== general camera reconstruction

def _flight_window(track: List[Dict[str, Any]]) -> Tuple[int, int]:
    """Drop implausibly fast jumps at either end (arm swing, re-acquisition); everything else is left to the
    physical fit, whose residuals trim pre-release and post-contact points. Image-space reversals are NOT cut:
    seen from behind the bowler the ball's image legitimately turns as it dips and bounces."""
    n = len(track)
    if n < 4:
        return 0, n - 1
    speed = []
    for a_, b_ in zip(track, track[1:]):
        dt = max(1e-6, b_["t"] - a_["t"])
        speed.append(float(np.hypot(b_["sx"] - a_["sx"], b_["sy"] - a_["sy"])) / dt)
    ref = float(np.median(speed))
    i0, i1 = 0, n - 1
    while i0 < i1 - 4 and speed[i0] > 3.0 * ref:
        i0 += 1
    while i1 > i0 + 4 and speed[i1 - 1] > 3.0 * ref:
        i1 -= 1
    return i0, i1


def _drs_from_fit(cam, fit, t_first: float, t_last: float, sigma_x: Optional[float]) -> Dict[str, Any]:
    """Pitching / impact / wickets from a fitted 3D flight (x = off side for a right-hander)."""
    from services.ballistic_fit import state_at
    half_w, r = STUMP_HALF_W, BALL_R
    line_ok = sigma_x is None or sigma_x <= 0.08
    out: Dict[str, Any] = {}
    # impact = the last tracked flight point (the ball's path was interrupted there) unless it reached the stumps
    X_imp, V_imp = state_at(fit, t_last)
    reached = X_imp[1] >= STUMP_Y - 0.05
    # predicted path from impact to the stump plane (real-time integration with bounce physics)
    path = []
    X, V = X_imp.copy(), V_imp.copy()
    tv, dt_real = t_last, 0.004
    bounced_in_prediction = None
    if not reached:
        for _ in range(600):
            X = X + V * dt_real + np.array([0, 0, -0.5 * G * dt_real ** 2])
            V = V + np.array([0, 0, -G * dt_real])
            tv += dt_real / fit["s"]
            if X[2] < r and V[2] < 0:
                X[2] = r
                V = np.array([V[0], 0.9 * V[1], -0.55 * V[2]])
                bounced_in_prediction = (X.copy(), tv)
            path.append((tv, X.copy(), V.copy()))
            if X[1] >= STUMP_Y + 0.15:
                break
    target = None
    if reached:
        # crossing found in the tracked flight itself
        ts_ = np.linspace(t_first, t_last, 300)
        for t0_, t1_ in zip(ts_, ts_[1:]):
            y0_, y1_ = state_at(fit, t0_)[0][1], state_at(fit, t1_)[0][1]
            if y0_ < STUMP_Y <= y1_:
                target = state_at(fit, t1_)[0]
                break
    else:
        for (ta, Xa, _), (tb_, Xb, _) in zip(path, path[1:]):
            if Xa[1] < STUMP_Y <= Xb[1]:
                fr = (STUMP_Y - Xa[1]) / max(1e-9, Xb[1] - Xa[1])
                target = Xa + fr * (Xb - Xa)
                break
    if target is None:
        target = path[-1][1] if path else X_imp

    def line_verdict(x, outside_word):
        if abs(x) <= half_w:
            return "IN LINE"
        if abs(x) <= half_w + r:
            return "UMPIRE'S CALL"
        return outside_word + (" OFF" if x > 0 else " LEG")

    bounce_pt = None
    if fit["bounce"] and fit["tb"] <= t_last + 1e-6:
        bounce_pt = state_at(fit, fit["tb"])[0]
    elif bounced_in_prediction is not None:
        bounce_pt = bounced_in_prediction[0]
    pitching = "FULL TOSS" if bounce_pt is None else line_verdict(bounce_pt[0], "OUTSIDE")
    if pitching == "UMPIRE'S CALL":
        pitching = "IN LINE"  # pitching only fails when wholly outside leg
    impact = line_verdict(X_imp[0], "OUTSIDE") if not reached else "N/A (bowled)"
    tx, tz = float(target[0]), float(target[2])
    if abs(tx) <= half_w and tz <= STUMP_H:
        wickets = "HITTING"
    elif abs(tx) <= half_w + r and tz <= STUMP_H + r:
        wickets = "UMPIRE'S CALL"
    else:
        wickets = "MISSING"
    if not line_ok:  # side-on: line cannot be measured, so only height/length decide
        pitching = "IN LINE" if bounce_pt is not None else "FULL TOSS"
        impact = "IN LINE" if not reached else impact
        wickets = "HITTING" if tz <= STUMP_H else ("UMPIRE'S CALL" if tz <= STUMP_H + r else "MISSING")
    if pitching == "OUTSIDE LEG":
        decision = "NOT OUT (Pitched Outside Leg)"
    elif impact.startswith("OUTSIDE"):
        decision = f"NOT OUT (Impact {impact.title()})"
    elif wickets == "MISSING":
        decision = "NOT OUT (Missing Stumps)" if tz <= STUMP_H + r else "NOT OUT (Going Over)"
    elif wickets == "UMPIRE'S CALL" or impact == "UMPIRE'S CALL":
        decision = "UMPIRE'S CALL"
    else:
        decision = "OUT"
    if not line_ok and (decision == "OUT" or decision == "UMPIRE'S CALL"):
        decision = LINE_NOT_MEASURED
    hit = "Over Stumps" if tz > STUMP_H + r else ("Leg Stump" if tx < -0.04 else "Off Stump" if tx > 0.04 else "Middle Stump")
    if wickets == "MISSING" and tz <= STUMP_H + r:
        hit = "Missing Leg" if tx < 0 else "Missing Off"
    out.update({
        "impact_X": X_imp, "impact_t": t_last, "target": target, "path": path, "bounce_pt": bounce_pt,
        "bounce_t": (fit["tb"] if fit["bounce"] and fit["tb"] <= t_last + 1e-6 else
                     (bounced_in_prediction[1] if bounced_in_prediction else None)),
        "evaluation": {"decision": decision, "pitching": pitching, "impact": impact, "wickets": wickets,
                       "hit_stump": hit, "height_at_stumps_m": round(tz, 3), "line_at_stumps_m": round(tx, 3),
                       "line_observable": bool(line_ok),
                       "note": (None if line_ok else "Camera is side-on: height and length are measured; line (off/leg) "
                                "is not observable from this angle and is assumed on middle.")},
    })
    return out


def _geometry_inputs(self, scan: Dict[str, Any], chain: List[Dict[str, Any]]) -> Dict[str, Any]:
    from services.camera_geometry import detect_pitch_edges, detect_creases
    f0, f1 = chain[0]["frame"], chain[-1]["frame"]
    stumps = self._stump_clusters(scan, f0, f1)
    edges = None
    # pitch strip from sampled frames near the delivery (stabilised into frame-0 pixels), best = most samples
    best = None
    for (f, img) in sorted(scan.get("samples", []), key=lambda x: abs(x[0] - f0)):
        e = detect_pitch_edges(img)
        if e is None:
            continue
        cr = detect_creases(img, e)  # in this sample image's pixels, before stabilisation
        k = scan["W"] / img.shape[1]
        e["creases"] = [{"samples": [list(_apply(scan["Tinv"][f], u * k, v * k)) for u, v in c["samples"]],
                         "length": c["length"] * k} for c in cr]
        good = 0
        for edge in e["edges"]:
            if edge is not None:
                edge["samples"] = [list(_apply(scan["Tinv"][f], u * k, v * k)) for u, v in edge["samples"]]
                good += 1
        score_e = good + 0.5 * min(len(e.get("creases", [])), 4)
        if best is None or score_e > best[0]:
            best = (score_e, e)
        if good == 2 and len(e.get("creases", [])) >= 3:
            break
    if best is not None:
        edges = best[1]
    lo, hi = max(0, f0 - 120), min(scan["n"] - 1, f1 + 60)
    return {
        "W": scan["W"], "H": scan["H"], "fps": scan["fps"],
        "track": [{"f": c["frame"], "t": scan["t_capture"][c["frame"]], "sx": c["sx"], "sy": c["sy"],
                   "px": c["px"], "py": c["py"], "conf": float(c["conf"])} for c in chain],
        "stump_sets": stumps, "edges": edges,
        "frames": {"lo": lo, "hi": hi, "times": scan["t_capture"][lo:hi + 1],
                   "T": scan["T"][lo:hi + 1].tolist()},
    }


def _measure_air_swing(cam, fit, t: np.ndarray, uv: np.ndarray, t_release: float,
                       t_end: float) -> Optional[Dict[str, Any]]:
    """Air swing measured from the tracked pixels (the flight model itself has a straight pre-bounce line).

    Each pre-bounce observation's camera ray is intersected with the plane y = y_model(t), giving the observed
    sideways position x_obs(t). A weighted quadratic x_obs(t) - x_model(t) = a0 + a1*tau + a2*tau^2 measures the
    lateral curvature; the swing is the sideways distance, at the end of the air phase (bounce, or impact for a
    full toss), between the curved path and the straight line the ball was launched on: a2 * T^2 with T the time
    from release. + = towards +x (OFF side for a right-handed batter), - = towards leg (inswing for a RHB).
    """
    from services.ballistic_fit import state_at
    R = cam.R
    C = cam.centre
    tb = fit["tb"] if fit["bounce"] else None
    ts, xs, sig = [], [], []
    for ti, (u, v) in zip(t, uv):
        if tb is not None and ti >= tb - 1e-6:
            break
        X, _ = state_at(fit, float(ti))
        d = R.T @ np.array([(u - cam.cx) / cam.f, (v - cam.cy) / cam.f, 1.0])
        if abs(d[1]) < 1e-6:
            continue
        s = (X[1] - C[1]) / d[1]
        if s <= 0:
            continue
        x_obs = C[0] + s * d[0]
        # metres of sideways movement per pixel at this point: 1.5 px detection noise -> sigma in metres
        du = cam.project(X + np.array([0.05, 0, 0]))[0] - cam.project(X - np.array([0.05, 0, 0]))[0]
        px_per_m = float(np.hypot(*du)) / 0.1
        if px_per_m < 1e-3:
            continue
        ts.append(float(ti)); xs.append(float(x_obs - X[0])); sig.append(1.5 / px_per_m)
    if len(ts) < 6 or ts[-1] - ts[0] < 0.12:
        return None
    ts, xs, sig = np.array(ts), np.array(xs), np.array(sig)
    tm = float(ts.mean())
    A = np.stack([np.ones_like(ts), ts - tm, (ts - tm) ** 2], axis=1)
    w = 1.0 / sig
    coef, *_ = np.linalg.lstsq(A * w[:, None], xs * w, rcond=None)
    res = (A @ coef - xs) / sig
    chi2 = float(np.sum(res ** 2) / max(1, len(ts) - 3))
    try:
        cov = np.linalg.inv((A * w[:, None]).T @ (A * w[:, None])) * max(1.0, chi2)
    except np.linalg.LinAlgError:
        return None
    a2, sa2 = float(coef[2]), float(np.sqrt(max(0.0, cov[2, 2])))
    T = max(0.0, float(t_end) - float(t_release))
    s = fit["s"]
    return {"swing_m": a2 * T * T, "sigma_m": sa2 * T * T, "lateral_accel_mps2": 2.0 * a2 / (s * s),
            "n_obs": int(len(ts)), "measured_window_s": round(float((ts[-1] - ts[0]) * s), 3),
            "air_time_s": round(T * s, 3)}


def _reconstruct(inputs: Dict[str, Any], corners=None) -> Optional[Dict[str, Any]]:
    """Camera solve + physical flight fit from stored geometry inputs (also used after manual calibration)."""
    from services.camera_geometry import solve_camera
    from services.ballistic_fit import choose_reconstruction, fit_flight, state_at, time_at_y, physical_score
    track = inputs["track"]
    if len(track) < 5:
        return None
    W, H = inputs["W"], inputs["H"]
    i0, i1 = _flight_window(track)
    flight = track[i0:i1 + 1]
    if len(flight) < 5:
        return None
    stumps = [dict(s_) for s_ in (inputs.get("stump_sets") or [])]
    edges = inputs.get("edges")
    if corners is not None and len(corners) == 4:
        corners = [[float(u), float(v)] for u, v in corners]
    else:
        corners = None
    if not stumps and corners is None and not (edges and sum(e is not None for e in edges.get("edges", [])) == 2):
        return None
    creases = (edges or {}).get("creases") or None
    cams = solve_camera(W, H, stumps, edges, corners, creases=creases)
    if not cams:
        return None
    t = np.array([p["t"] for p in flight]); uv = np.array([[p["sx"], p["sy"]] for p in flight])
    conf = np.array([p["conf"] for p in flight])
    # Grow the flight from its start, one tracked point at a time, through the best camera. The flight ends where
    # new points stop obeying gravity + bounce physics (two misses in a row = contact with pad / bat / keeper).
    n0 = min(len(flight), 10)
    cam, fit, score = choose_reconstruction(cams, t[:n0], uv[:n0], conf[:n0])
    seed_ok = max(6.0, 0.006 * W)
    if fit is None or fit["rms_px"] > seed_ok:
        # the track probably starts with the ball still in the bowler's hand (moving with the arm, not
        # ballistically): skip forward to the first start whose seed obeys flight physics
        for k in range(1, max(2, int(0.4 * len(flight))) + 1):
            if len(flight) - k < 6:
                break
            n0 = min(len(flight) - k, 10)
            c_k, f_k, s_k = choose_reconstruction(cams, t[k:k + n0], uv[k:k + n0], conf[k:k + n0])
            if f_k is not None and f_k["rms_px"] <= seed_ok:
                flight, t, uv, conf = flight[k:], t[k:], uv[k:], conf[k:]
                cam, fit, score = c_k, f_k, s_k
                break
    if fit is None:
        return None
    end, misses = n0, 0
    while end < len(flight):
        trial = fit_flight(cam, t[:end + 1], uv[:end + 1], conf[:end + 1], quick=True)
        if trial is None:
            break
        res_t = np.array(trial["residuals_px"])
        thr_g = max(4.0, 0.004 * W, 3.0 * float(np.median(res_t[:-1])))
        if res_t[-1] > thr_g:
            misses += 1
            if misses >= 2:
                break
        else:
            misses = 0
        end += 1
    end -= misses
    flight = flight[:end]
    t, uv, conf = t[:end], uv[:end], conf[:end]
    cam, fit, score = choose_reconstruction(cams, t, uv, conf)
    if fit is None:
        return None
    # trim end points the physical flight cannot explain (arm swing before release, deflection after contact),
    # re-choosing the camera each time because outliers also bias the camera choice
    for _ in range(4):
        res = np.array(fit["residuals_px"])
        thr = max(6.0, 0.006 * W, 4.0 * float(np.median(res)))
        if len(flight) <= 6 or (res[0] <= thr and res[-1] <= thr):
            break
        head = 0
        while head < len(res) - 6 and res[head] > thr:
            head += 1
        tail = 0
        while tail < len(res) - 6 - head and res[-1 - tail] > thr:
            tail += 1
        keep = slice(head, len(flight) - tail)
        flight = flight[keep]
        t, uv, conf = t[keep], uv[keep], conf[keep]
        c2, f2, sc2 = choose_reconstruction(cams, t, uv, conf)
        if f2 is None:
            break
        cam, fit, score = c2, f2, sc2
    if fit["rms_px"] > max(8.0, 0.01 * W) or score > 400 or cam.rms_px > max(12.0, 0.015 * W):
        logger.info("General reconstruction rejected (fit %.1fpx, camera %.1fpx, score %.0f)",
                    fit["rms_px"], cam.rms_px, score)
        return None

    fr = inputs["frames"]
    times = fr["times"]; lo = fr["lo"]
    if "T" in fr:
        Tfr = np.array(fr["T"])
    else:  # results stored before zoom-aware stabilisation: translation only
        Tfr = np.array([[[1, 0, c[0]], [0, 1, c[1]], [0, 0, 1]] for c in fr["cum"]], dtype=np.float64)
    meas = {p["f"]: p for p in flight}
    f_first, f_last = flight[0]["f"], flight[-1]["f"]
    t_first, t_last = flight[0]["t"], flight[-1]["t"]
    # Line (off/leg) observability from the camera geometry itself: pixels produced by a 10 cm sideways move of
    # the ball near the batter, against ~1.5 px detection noise. Large from behind the bowler, tiny side-on.
    X_line, _ = state_at(fit, t_last)
    du = cam.project(X_line + np.array([0.05, 0, 0]))[0] - cam.project(X_line - np.array([0.05, 0, 0]))[0]
    px_per_10cm = float(np.hypot(*du))
    fit["sigma_x_m"] = round(0.1 * 1.5 / max(px_per_10cm, 1e-3), 4)
    drs_geo = _drs_from_fit(cam, fit, t_first, t_last, fit.get("sigma_x_m"))

    def pixel_of(X, f):
        uvp = cam.project(X)[0]
        Tf = Tfr[f - lo] if lo <= f <= fr["hi"] else np.eye(3)
        return _apply(Tf, uvp[0], uvp[1])

    def make(tv, f, phase, predicted):
        X, V = state_at(fit, tv)
        m = meas.get(f) if f is not None else None
        p = {"x": round(float(X[0]), 4), "y": round(float(X[1]), 4), "z": round(float(max(BALL_R, X[2])), 4),
             "t": round(float(tv), 4), "phase": phase, "vx": round(float(V[0]), 3), "vy": round(float(V[1]), 3),
             "vz": round(float(V[2]), 3), "speed_kmh": round(float(np.linalg.norm(V)) * 3.6, 1),
             "confidence": round(float(m["conf"]) if m else 0.6, 3), "is_predicted": bool(predicted or m is None)}
        if f is not None:
            p["frame_idx"] = int(f)
            if m is not None:
                p["pixel_x"], p["pixel_y"] = float(m["px"]), float(m["py"])
            else:
                p["pixel_x"], p["pixel_y"] = pixel_of(X, f)
        return p

    # back-project to the release, then every frame of the tracked flight
    f_start = f_first
    while f_start - 1 >= lo and state_at(fit, times[f_start - 1 - lo])[0][1] >= -STUMP_Y + 1.9:
        f_start -= 1
    tb = drs_geo["bounce_t"]
    points: List[Dict[str, Any]] = []
    bounce_point = None
    for f in range(f_start, f_last + 1):
        tv = times[f - lo]
        if fit["bounce"] and tb is not None and bounce_point is None and tb <= t_last + 1e-6 and tv >= tb:
            bounce_point = make(tb, None, "bounce", False)
            bounce_point["z"] = BALL_R
            if abs(tv - tb) > 1e-3:
                points.append(bounce_point)
        phase = "pre_bounce" if (tb is None or tv < tb) else "post_bounce"
        if tb is None and not fit["bounce"]:
            phase = "pre_bounce"
        points.append(make(tv, f, phase, f < f_first))
    # extrapolated path (projected from impact to the stump plane)
    extra = [dict(points[-1], phase="extrapolated", is_predicted=True)]
    for tv, X, V in drs_geo["path"][::3]:
        extra.append({"x": round(float(X[0]), 4), "y": round(float(X[1]), 4), "z": round(float(max(BALL_R, X[2])), 4),
                      "t": round(float(tv), 4), "phase": "extrapolated", "is_predicted": True, "confidence": 0.6,
                      "vx": round(float(V[0]), 3), "vy": round(float(V[1]), 3), "vz": round(float(V[2]), 3),
                      "speed_kmh": round(float(np.linalg.norm(V)) * 3.6, 1)})
    if bounce_point is None and drs_geo["bounce_pt"] is not None:
        Xb = drs_geo["bounce_pt"]
        bounce_point = {"x": round(float(Xb[0]), 4), "y": round(float(Xb[1]), 4), "z": BALL_R,
                        "t": round(float(drs_geo["bounce_t"]), 4), "phase": "bounce", "is_predicted": True}
    ev = drs_geo["evaluation"]
    X0, V0 = state_at(fit, t_first)
    release_kmh = round(float(np.linalg.norm(V0)) * 3.6, 1)
    bounce_kmh = None
    if bounce_point is not None:
        _, Vb = state_at(fit, bounce_point["t"] + 1e-4) if fit["bounce"] else (None, None)
        if Vb is not None:
            bounce_kmh = round(float(np.linalg.norm(Vb)) * 3.6, 1)
    length_zone = "Full Toss"
    if bounce_point is not None:
        d = STUMP_Y - bounce_point["y"]
        length_zone = ("Yorker" if d < 2.0 else "Full" if d < 4.0 else "Good Length" if d < 7.0
                       else "Short of Length" if d < 9.5 else "Bouncer")
    tgt = drs_geo["target"]
    imp = make(t_last, f_last, "impact", False)
    drs = {
        "pre_bounce_points": [p for p in points if p["phase"] == "pre_bounce"],
        "post_bounce_points": [p for p in points if p["phase"] in ("bounce", "post_bounce")],
        "extrapolated_points": extra if len(extra) > 1 else [],
        "bounce_point": bounce_point, "impact_point": imp,
        "stump_plane_target": {"x": round(float(tgt[0]), 4), "y": STUMP_Y, "z": round(float(tgt[2]), 4),
                               "hit_stump": ev["hit_stump"]},
        "drs_evaluation": ev, "release_speed_kmh": release_kmh, "bounce_speed_kmh": bounce_kmh,
        "length_zone": length_zone,
        "release_speed_px_per_sec": round(float(np.hypot(*(uv[-1] - uv[0])) / max(1e-6, t[-1] - t[0])), 1),
    }
    swing = None
    try:
        t_end_air = bounce_point["t"] if bounce_point is not None else t_last
        swing = _measure_air_swing(cam, fit, t, uv, points[0]["t"] if points else t_first, t_end_air)
        if swing is not None:
            swing["line_sigma_m"] = fit.get("sigma_x_m")
    except Exception as exc:  # the swing figure is an extra; never lose the reconstruction over it
        logger.info("Air swing measurement failed: %s", exc)
    drs["swing_measurement"] = swing
    return {"status": "reconstructed", "points": points, "drs": drs, "camera": cam.to_dict(),
            "time_scale": fit["s"], "fit_rms_m": None, "fit_rms_px": round(fit["rms_px"], 2),
            "measured_points": len(flight), "frames": (f_first, f_last), "method": "camera_ballistic_fit",
            "camera_source": cam.source, "line_sigma_m": fit.get("sigma_x_m")}


DeliveryTracker.geometry_inputs = _geometry_inputs
DeliveryTracker.reconstruct = staticmethod(_reconstruct)
