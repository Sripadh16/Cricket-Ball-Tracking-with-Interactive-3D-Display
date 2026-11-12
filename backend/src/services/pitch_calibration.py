"""User-corrected pitch plane. Airborne height remains a single-camera estimate."""
import cv2
import numpy as np


def calibrate_pitch(points, corners, width, height):
    src = np.asarray(corners, dtype=np.float32)
    if src.shape != (4, 2) or not np.isfinite(src).all():
        raise ValueError("Supply four finite pitch corners in source pixels.")
    if not width or not height or width <= 0 or height <= 0:
        raise ValueError("Source video dimensions are unavailable.")
    if (src < 0).any() or (src[:, 0] >= width).any() or (src[:, 1] >= height).any():
        raise ValueError("Pitch corners must be inside the source frame.")
    if not cv2.isContourConvex(src) or abs(cv2.contourArea(src)) < 100:
        raise ValueError("Pitch corners must form a non-crossing quadrilateral of at least 100 square pixels.")
    dst = np.array([[-1.525, -10.06], [1.525, -10.06], [1.525, 10.06], [-1.525, 10.06]], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(src, dst)
    result = []
    for point in points:
        pixel = [point.get("pixel_x"), point.get("pixel_y")]
        if any(value is None for value in pixel) or not np.isfinite(pixel).all():
            raise ValueError("This track lacks source pixels; reprocess the video before correcting its pitch.")
        homogeneous = matrix @ np.array([*pixel, 1.0])
        if abs(homogeneous[2]) < 1e-8:
            raise ValueError("A tracked point lies at the projection horizon; choose clearer landmarks.")
        xy = homogeneous[:2] / homogeneous[2]
        result.append({**point, "x": float(xy[0]), "y": float(xy[1])})
    return result, {"corners": src.tolist(), "homography": matrix.tolist(),
                    "status": "manual_pitch_plane", "height_status": "heuristic_unverified"}
