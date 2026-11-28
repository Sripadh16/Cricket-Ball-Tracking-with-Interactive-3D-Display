#!/usr/bin/env python3
"""
Tracking & Detector Evaluation Harness for Cricket Ball Computer Vision Pipeline.

Separates:
1. Measured Detector Accuracy: Evaluates ONLY measured computer vision detections
   against annotated ground truth frames (Detector Precision, Recall, F1, RMSE).
2. Tracking Continuity & Gap Filling: Evaluates the combined tracker output
   (Combined Recall, Predicted Frame Fraction, Max Consecutive Predictions).

Usage:
    python evaluate_tracking.py --demo
    python evaluate_tracking.py --ground-truth gt.csv --tracking-result track.json
    python evaluate_tracking.py --video clip.mp4 --ground-truth gt.csv
"""

import os
import sys
import json
import csv
import argparse
import math
import hashlib
import platform
import time
from pathlib import Path
from statistics import median
from typing import List, Dict, Any, Tuple, Optional

# Ensure backend src is on import path
SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


def parse_tracking_data(data: Any) -> List[Dict[str, Any]]:
    """Safely extracts a list of points from either a top-level list or a dictionary."""
    if isinstance(data, list):
        return data
    elif isinstance(data, dict):
        if isinstance(data.get("pixel_track"), list):
            return data["pixel_track"]
        elif "points" in data and isinstance(data["points"], list):
            return data["points"]
        elif "ball_trajectory" in data and isinstance(data["ball_trajectory"], list):
            return data["ball_trajectory"]
        else:
            raise ValueError("JSON dictionary must contain a 'points' or 'ball_trajectory' list")
    else:
        raise ValueError(f"Unexpected JSON data type: {type(data).__name__}. Expected dict or list.")


def load_ground_truth_csv(csv_path: str) -> Dict[int, Tuple[float, float]]:
    """
    Loads ground truth coordinates from CSV.
    Expected format: frame_idx, x, y [, radius]
    """
    gt = {}
    with open(csv_path, 'r', newline='') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        # Check if first row is header or numeric
        if header and not header[0].strip().replace('.', '', 1).isdigit():
            pass  # header row skipped
        else:
            if header and len(header) >= 3:
                gt[int(float(header[0]))] = (float(header[1]), float(header[2]))

        for row in reader:
            if not row or len(row) < 3:
                continue
            frame_idx = int(float(row[0]))
            cx = float(row[1])
            cy = float(row[2])
            gt[frame_idx] = (cx, cy)
    return gt


def evaluate_trajectory(
    tracked_points: List[Dict[str, Any]],
    ground_truth: Dict[int, Tuple[float, float]],
    match_threshold_px: float = 15.0
) -> Dict[str, Any]:
    """
    Evaluates tracking data against ground truth annotations.
    Strictly separates measured detector accuracy from combined tracking continuity.
    """
    total_gt = len(ground_truth)
    total_tracked = len(tracked_points)

    if total_gt == 0:
        return {
            "error": "Ground truth is empty",
            "total_gt": 0,
            "total_tracked": total_tracked
        }

    # Extract points by frame_idx
    points_by_frame: Dict[int, Dict[str, Any]] = {}
    predicted_points: List[Dict[str, Any]] = []
    measured_points: List[Dict[str, Any]] = []

    for i, pt in enumerate(tracked_points):
        f_idx = pt.get('frame_idx', i)
        points_by_frame[f_idx] = pt
        if pt.get('is_predicted', False):
            predicted_points.append(pt)
        else:
            measured_points.append(pt)

    # ── 1. Measured CV Detector Evaluation (Measured Points Only) ───────────
    detector_tp = 0
    detector_fp = 0
    detector_errors_px = []

    for pt in measured_points:
        f_idx = pt.get('frame_idx')
        px = pt.get('pixel_x', pt.get('x'))
        py = pt.get('pixel_y', pt.get('y'))

        if px is None or py is None:
            continue

        if f_idx in ground_truth:
            gt_x, gt_y = ground_truth[f_idx]
            dist = math.sqrt((px - gt_x)**2 + (py - gt_y)**2)
            if dist <= match_threshold_px:
                detector_tp += 1
                detector_errors_px.append(dist)
            else:
                detector_fp += 1
        else:
            # Detection occurred on a frame outside annotated GT set
            detector_fp += 1

    detector_fn = total_gt - detector_tp
    det_precision = detector_tp / max(1, (detector_tp + detector_fp))
    det_recall = detector_tp / max(1, total_gt)
    det_f1 = (2 * det_precision * det_recall / (det_precision + det_recall)) if (det_precision + det_recall) > 0 else 0.0
    det_rmse = math.sqrt(sum(e**2 for e in detector_errors_px) / len(detector_errors_px)) if detector_errors_px else None
    det_mean_err = (sum(detector_errors_px) / len(detector_errors_px)) if detector_errors_px else None

    # ── 2. Combined Pipeline Evaluation (Measured + Predicted) ───────────────
    combined_tp = 0
    combined_fp = 0
    combined_errors_px = []

    for f_idx, pt in points_by_frame.items():
        px = pt.get('pixel_x', pt.get('x'))
        py = pt.get('pixel_y', pt.get('y'))
        if px is None or py is None:
            continue

        if f_idx in ground_truth:
            gt_x, gt_y = ground_truth[f_idx]
            dist = math.sqrt((px - gt_x)**2 + (py - gt_y)**2)
            if dist <= match_threshold_px:
                combined_tp += 1
                combined_errors_px.append(dist)
            else:
                combined_fp += 1
        else:
            combined_fp += 1

    comb_precision = combined_tp / max(1, (combined_tp + combined_fp))
    comb_recall = combined_tp / max(1, total_gt)
    comb_f1 = (2 * comb_precision * comb_recall / (comb_precision + comb_recall)) if (comb_precision + comb_recall) > 0 else 0.0
    comb_rmse = math.sqrt(sum(e**2 for e in combined_errors_px) / len(combined_errors_px)) if combined_errors_px else None

    # Gap length analysis
    max_consecutive_pred = 0
    curr_consecutive = 0
    for pt in tracked_points:
        if pt.get('is_predicted', False):
            curr_consecutive += 1
            max_consecutive_pred = max(max_consecutive_pred, curr_consecutive)
        else:
            curr_consecutive = 0

    pred_fraction = (len(predicted_points) / total_tracked) if total_tracked > 0 else 0.0

    return {
        "match_threshold_px": match_threshold_px,
        "total_gt_frames": total_gt,
        "total_tracked_points": total_tracked,
        "measured_points": len(measured_points),
        "predicted_points": len(predicted_points),
        "predicted_fraction": round(pred_fraction, 4),
        "max_consecutive_predicted": max_consecutive_pred,
        # CV Detector Only Metrics
        "detector_tp": detector_tp,
        "detector_fp": detector_fp,
        "detector_fn": detector_fn,
        "detector_precision": round(det_precision, 4),
        "detector_recall": round(det_recall, 4),
        "detector_f1": round(det_f1, 4),
        "detector_mean_error_px": round(det_mean_err, 2) if det_mean_err is not None else None,
        "detector_rmse_px": round(det_rmse, 2) if det_rmse is not None else None,
        # Combined Tracking Metrics
        "combined_tp": combined_tp,
        "combined_fp": combined_fp,
        "combined_precision": round(comb_precision, 4),
        "combined_recall": round(comb_recall, 4),
        "combined_f1": round(comb_f1, 4),
        "combined_rmse_px": round(comb_rmse, 2) if comb_rmse is not None else None,
    }


def format_report(metrics: Dict[str, Any]) -> str:
    """Format evaluation metrics as a transparent two-section CLI table."""
    lines = [
        "=" * 65,
        "       CRICKET BALL TRACKING & DETECTOR EVALUATION REPORT        ",
        "=" * 65,
        f"  Total Ground Truth Frames:        {metrics.get('total_gt_frames', 0):>6}",
        f"  Total Tracked Output Points:      {metrics.get('total_tracked_points', 0):>6}",
        f"    - Measured Points (CV Output):  {metrics.get('measured_points', 0):>6}",
        f"    - Predicted Points (KF Gaps):   {metrics.get('predicted_points', 0):>6}",
        f"  Match Distance Threshold:         {metrics.get('match_threshold_px', 0.0):>5.1f} px",
        "-" * 65,
        "  SECTION 1: RAW CV DETECTOR PERFORMANCE (Measured Points ONLY)",
        "-" * 65,
        f"    Detector True Positives:        {metrics.get('detector_tp', 0):>6}",
        f"    Detector False Positives:       {metrics.get('detector_fp', 0):>6}",
        f"    Detector False Negatives:       {metrics.get('detector_fn', 0):>6}",
        f"    Detector Precision:             {metrics.get('detector_precision', 0.0)*100:>5.1f}%",
        f"    Detector Recall:                {metrics.get('detector_recall', 0.0)*100:>5.1f}%",
        f"    Detector F1 Score:              {metrics.get('detector_f1', 0.0)*100:>5.1f}%",
    ]
    if metrics.get('detector_mean_error_px') is not None:
        lines.append(f"    Detector Mean Centre Error:     {metrics.get('detector_mean_error_px', 0.0):>5.2f} px")
    if metrics.get('detector_rmse_px') is not None:
        lines.append(f"    Detector RMSE Error:            {metrics.get('detector_rmse_px', 0.0):>5.2f} px")

    lines.extend([
        "-" * 65,
        "  SECTION 2: TRACKING CONTINUITY & GAP FILLING (Combined Pipeline)",
        "-" * 65,
        f"    Predicted Frame Fraction:       {metrics.get('predicted_fraction', 0.0)*100:>5.1f}%",
        f"    Max Consecutive Predicted:      {metrics.get('max_consecutive_predicted', 0):>6} frames",
        f"    Combined Track Recall:          {metrics.get('combined_recall', 0.0)*100:>5.1f}%",
        f"    Combined Track Precision:       {metrics.get('combined_precision', 0.0)*100:>5.1f}%",
        f"    Combined Track F1 Score:        {metrics.get('combined_f1', 0.0)*100:>5.1f}%",
    ])
    if metrics.get('combined_rmse_px') is not None:
        lines.append(f"    Combined Track RMSE Error:      {metrics.get('combined_rmse_px', 0.0):>5.2f} px")

    lines.append("=" * 65)
    return "\n".join(lines)


def format_markdown_report(metrics: Dict[str, Any]) -> str:
    def error_px(key):
        value = metrics.get(key)
        return "Unavailable" if value is None else f"{value:.2f} px"
    """Format evaluation metrics as a structured GitHub Flavored Markdown report."""
    lines = [
        "# Cricket Ball Tracking & Computer Vision Evaluation Report",
        "",
        f"- **Total Ground Truth Frames**: {metrics.get('total_gt_frames', 0)}",
        f"- **Total Tracked Output Points**: {metrics.get('total_tracked_points', 0)}",
        f"  - **Measured Points (CV Detections)**: {metrics.get('measured_points', 0)}",
        f"  - **Predicted Points (Kalman Gaps)**: {metrics.get('predicted_points', 0)}",
        f"- **Match Threshold**: {metrics.get('match_threshold_px', 0.0):.1f} px",
        "",
        "## Section 1: Raw CV Detector Performance (Measured Points Only)",
        "",
        "| Metric | Value |",
        "| :--- | :--- |",
        f"| True Positives (TP) | {metrics.get('detector_tp', 0)} |",
        f"| False Positives (FP) | {metrics.get('detector_fp', 0)} |",
        f"| False Negatives (FN) | {metrics.get('detector_fn', 0)} |",
        f"| Detector Precision | {metrics.get('detector_precision', 0.0)*100:.1f}% |",
        f"| Detector Recall | {metrics.get('detector_recall', 0.0)*100:.1f}% |",
        f"| Detector F1 Score | {metrics.get('detector_f1', 0.0)*100:.1f}% |",
        f"| Mean Centre Error | {error_px('detector_mean_error_px')} |",
        f"| RMSE Error | {error_px('detector_rmse_px')} |",
        "",
        "## Section 2: Tracking Continuity & Gap Filling (Combined Pipeline)",
        "",
        "| Metric | Value |",
        "| :--- | :--- |",
        f"| Predicted Frame Fraction | {metrics.get('predicted_fraction', 0.0)*100:.1f}% |",
        f"| Max Consecutive Predictions | {metrics.get('max_consecutive_predicted', 0)} frames |",
        f"| Combined Track Precision | {metrics.get('combined_precision', 0.0)*100:.1f}% |",
        f"| Combined Track Recall | {metrics.get('combined_recall', 0.0)*100:.1f}% |",
        f"| Combined Track F1 Score | {metrics.get('combined_f1', 0.0)*100:.1f}% |",
        f"| Combined Track RMSE | {error_px('combined_rmse_px')} |",
        ""
    ]
    return "\n".join(lines)


def run_demo():
    """Runs a demonstration using synthetic delivery ground truth with detection dropouts."""
    print("\nRunning synthetic delivery harness demonstration...")
    print("NOTE: This demo illustrates metric computation and gap accounting on synthetic data.\n")
    gt = {}
    tracked = []

    for frame_idx in range(50):
        t = frame_idx / 30.0
        true_x = 640.0 - 0.2 * frame_idx + 0.05 * (frame_idx ** 1.3)
        true_y = 300.0 + 7.5 * frame_idx + 0.1 * (frame_idx ** 1.4)
        gt[frame_idx] = (round(true_x, 2), round(true_y, 2))

        # Frames 15-18 simulate detection loss (Kalman predictions)
        if 15 <= frame_idx <= 18:
            tracked.append({
                'frame_idx': frame_idx,
                'pixel_x': true_x + 3.2,
                'pixel_y': true_y - 2.5,
                'is_predicted': True,
                'confidence': 0.65,
                't': t
            })
        elif frame_idx == 45:
            # Frame 45: true miss (no detection and gap cap exceeded)
            continue
        else:
            # Measured detection with 1.2 px noise
            noise_x = (0.5 if frame_idx % 2 == 0 else -0.5) * 1.8
            noise_y = (-0.5 if frame_idx % 3 == 0 else 0.5) * 1.5
            tracked.append({
                'frame_idx': frame_idx,
                'pixel_x': true_x + noise_x,
                'pixel_y': true_y + noise_y,
                'is_predicted': False,
                'confidence': 0.88,
                't': t
            })

    metrics = evaluate_trajectory(tracked, gt, match_threshold_px=15.0)
    print(format_report(metrics))
    return metrics


async def benchmark_upload(video, count):
    from api.videos import _run_tracking_async
    from config import MAX_PROCESSING_FRAMES

    runs = []
    for _ in range(count):
        start = time.perf_counter()
        result = await _run_tracking_async(video)
        elapsed = time.perf_counter() - start
        runs.append({
            "wall_seconds": round(elapsed, 3),
            "decoded_frames": result["debug_info"]["frames_processed"],
            "selected_ball_frames": len(result["pixel_track"]),
            "reconstruction_method": result.get("reconstruction_method"),
        })
    with Path(video).open('rb') as clip:
        clip_hash = hashlib.file_digest(clip, 'sha256').hexdigest()
    return result, {
        "pipeline": "upload analysis (decode through reconstruction)",
        "clip_sha256": clip_hash,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu": platform.processor(),
        "max_processing_frames": MAX_PROCESSING_FRAMES,
        "video_info": result["video_info"],
        "runs": runs,
        "median_wall_seconds": median(run["wall_seconds"] for run in runs),
    }


def main():
    parser = argparse.ArgumentParser(description="Evaluate Cricket Ball Tracking & Detector Performance")
    parser.add_argument("--demo", action="store_true", help="Run synthetic demonstration")
    parser.add_argument("--ground-truth", type=str, help="Path to ground truth CSV (frame_idx, x, y)")
    parser.add_argument("--tracking-result", type=str, help="Path to tracking result JSON (dict or list)")
    parser.add_argument("--video", type=str, help="Path to video file to track and evaluate")
    parser.add_argument("--threshold-px", type=float, default=15.0, help="Pixel distance match threshold")
    parser.add_argument("--annotated-frames-only", action="store_true",
                        help="Score only the frames in a sparse positive-label CSV. Other frames remain unscored.")
    parser.add_argument("--output-json", type=str, help="Optional path to write metrics JSON")
    parser.add_argument("--output-markdown", type=str, help="Optional path to write markdown report")
    parser.add_argument("--benchmark-runs", type=int, help="Time the active upload pipeline on --video for this many runs")

    args = parser.parse_args()
    if args.benchmark_runs is not None and (args.benchmark_runs < 1 or not args.video or args.demo):
        parser.error("--benchmark-runs needs a positive count and --video")
    if args.benchmark_runs and not args.ground_truth and args.output_markdown:
        parser.error("--output-markdown requires ground truth; use --output-json for timings")

    if args.demo or (not args.ground_truth and not args.tracking_result and not args.video):
        metrics = run_demo()
        if args.output_json:
            with open(args.output_json, 'w') as f:
                json.dump(metrics, f, indent=2)
            print(f"Metrics written to: {args.output_json}")
        if args.output_markdown:
            with open(args.output_markdown, 'w') as f:
                f.write(format_markdown_report(metrics))
            print(f"Markdown report written to: {args.output_markdown}")
        return

    if not args.ground_truth and not args.benchmark_runs:
        parser.error("--ground-truth is required to score tracking accuracy")

    benchmark = None
    if args.video:
        print(f"Tracking ball on video: {args.video}...")
        import asyncio
        result, benchmark = asyncio.run(benchmark_upload(args.video, args.benchmark_runs or 1))
        tracked_points = parse_tracking_data(result)
    elif args.tracking_result:
        with open(args.tracking_result, 'r') as f:
            raw_data = json.load(f)
            tracked_points = parse_tracking_data(raw_data)
    else:
        print("Error: Either --tracking-result or --video must be specified.")
        sys.exit(1)

    metrics = {}
    if args.ground_truth:
        gt = load_ground_truth_csv(args.ground_truth)
        if not gt:
            parser.error("ground truth CSV contains no labeled positions")
        if args.annotated_frames_only:
            print("Scoring annotated frames only. These results do not measure false positives on unlabelled frames.")
            tracked_points = [p for p in tracked_points if p.get('frame_idx') in gt]
        metrics = evaluate_trajectory(tracked_points, gt, match_threshold_px=args.threshold_px)
        metrics["scope"] = "annotated_frames_only" if args.annotated_frames_only else "full_clip"
        print(format_report(metrics))
    if benchmark:
        metrics["benchmark"] = benchmark
        print(json.dumps(benchmark, indent=2))

    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(metrics, f, indent=2)
        print(f"Metrics written to: {args.output_json}")

    if args.output_markdown:
        with open(args.output_markdown, 'w') as f:
            f.write(format_markdown_report(metrics))
        print(f"Markdown report written to: {args.output_markdown}")


if __name__ == '__main__':
    main()
