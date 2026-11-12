"""Swept sphere against the rendered wicket cylinders, in pitch coordinates."""
import math

STUMP_RADIUS = 0.019
STUMP_SPACING = (0.2286 - 2 * STUMP_RADIUS) / 2
STUMP_HEIGHT = 0.711
STUMP_Y = 10.06
BALL_RADIUS = 0.036


def first_wicket_contact(points):
    # Distance to each finite cylinder includes the rounded sphere contact at corners.
    def distance(point, x, bail):
        if bail:
            radial = math.hypot(point[1] - STUMP_Y, point[2] - (STUMP_HEIGHT + 0.012))
            axial = max(0, abs(point[0] - x) - STUMP_SPACING / 2)
            radius = 0.006
        else:
            radial = math.hypot(point[0] - x, point[1] - STUMP_Y)
            axial = max(0, -point[2], point[2] - STUMP_HEIGHT)
            radius = STUMP_RADIUS
        return max(0, radial - radius) ** 2 + axial ** 2

    bodies = [("Leg Stump", -STUMP_SPACING, False), ("Middle Stump", 0, False),
              ("Off Stump", STUMP_SPACING, False), ("Left Bail", -STUMP_SPACING / 2, True),
              ("Right Bail", STUMP_SPACING / 2, True)]
    for a, b in zip(points, points[1:]):
        if max(a["y"], b["y"]) < STUMP_Y - 0.1:
            continue
        origin = [a[key] for key in ("x", "y", "z")]
        delta = [b[key] - a[key] for key in ("x", "y", "z")]
        at = lambda fraction: [value + fraction * change for value, change in zip(origin, delta)]
        hits = []
        for name, x, bail in bodies:
            lo, hi = 0.0, 1.0
            for _ in range(36):
                left, right = (2 * lo + hi) / 3, (lo + 2 * hi) / 3
                if distance(at(left), x, bail) <= distance(at(right), x, bail):
                    hi = right
                else:
                    lo = left
            minimum = (lo + hi) / 2
            if distance(at(minimum), x, bail) > BALL_RADIUS ** 2:
                continue
            lo, hi = 0.0, minimum
            for _ in range(36):
                mid = (lo + hi) / 2
                if distance(at(mid), x, bail) <= BALL_RADIUS ** 2:
                    hi = mid
                else:
                    lo = mid
            position = at(hi)
            hits.append({"type": "bowled", "time": a["t"] + hi * (b["t"] - a["t"]),
                         "hit_stump": name, **dict(zip(("x", "y", "z"), position)), "is_out": True})
        if hits:
            return min(hits, key=lambda hit: hit["time"])
    return None
