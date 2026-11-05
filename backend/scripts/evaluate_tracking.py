#!/usr/bin/env python3
"""
Tracking Evaluation Harness for Cricket Ball Computer Vision Pipeline.

Computes standard detection and tracking metrics:
- Precision: Matched detections within pixel threshold / Total detections
- Recall: Matched detections / Total ground truth positions
- F1 Score: Harmonic mean of precision and recall
- Mean Center Error (RMSE in pixels) on matched detections
- Predicted Frame Fraction: Proportion of reported points filled by extrapolation/prediction
- Maximum consecutive predicted frames (gap length)

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
from typing import List, Dict, Any, Tuple, Optional

# Ensure backend src is on import path
SRC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


def load_ground_truth_csv(csv_path: str) -> Dict[int, Tuple[float, float]]:
    """
    Loads ground truth coordinates from CSV.
    Expected format: frame_idx, x, y [, radius]
    """
    gt = {}
    with open(csv_path, 'r', newline='') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        # Check if first row is header
        start_row = 0
        if header and not header[0].strip().replace('.', '', 1).isdigit():
            pass  # header skipped
        else:
            if header:
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
    Evaluates tracked trajectory against ground truth annotations.
    """
    total_gt = len(ground_truth)
    total_tracked = len(tracked_points)

    if total_gt == 0:
        return {
            "error": "Ground truth is empty",
            "total_gt": 0,
            "total_tracked": total_tracked
        }

    # Extract points by frame_idx if available, or sequential index
    points_by_frame: Dict[int, Dict[str, Any]] = {}
    predicted_count = 0
    measured_count = 0

    for i, pt in enumerate(tracked_points):
        f_idx = pt.get('frame_idx', i)
        points_by_frame[f_idx] = pt
        if pt.get('is_predicted', False):
            predicted_count += 1
        else:
            measured_count += 1

    # Match detections to GT
    true_positives = 0
    errors_px = []
    false_positives = 0

    for f_idx, pt in points_by_frame.items():
        # Get pixel coordinates
        px = pt.get('pixel_x')
        py = pt.get('pixel_y')
        
        # If pixel coords not directly stored, check x, y bounds if in pixel scale
        if px is None or py is None:
            # Fall back to x/y if in pixel range (> 20)
            if pt.get('x', 0) > 20 or pt.get('y', 0) > 20:
                px, py = pt.get('x'), pt.get('y')

        if px is None or py is None:
            continue

        if f_idx in ground_truth:
            gt_x, gt_y = ground_truth[f_idx]
            dist = math.sqrt((px - gt_x)**2 + (py - gt_y)**2)
            if dist <= match_threshold_px:
                true_positives += 1
                errors_px.append(dist)
            else:
                false_positives += 1
        else:
            false_positives += 1

    false_negatives = total_gt - true_positives
    precision = true_positives / max(1, (true_positives + false_positives))
    recall = true_positives / max(1, total_gt)
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    mean_center_error = (sum(errors_px) / len(errors_px)) if errors_px else None
    rmse_error = math.sqrt(sum(e**2 for e in errors_px) / len(errors_px)) if errors_px else None

    # Consecutive predicted frames analysis
    max_consecutive_pred = 0
    curr_consecutive = 0
    for pt in tracked_points:
        if pt.get('is_predicted', False):
            curr_consecutive += 1
            max_consecutive_pred = max(max_consecutive_pred, curr_consecutive)
        else:
            curr_consecutive = 0

    pred_fraction = (predicted_count / total_tracked) if total_tracked > 0 else 0.0

    return {
        "total_gt_frames": total_gt,
        "total_tracked_points": total_tracked,
        "measured_points": measured_count,
        "predicted_points": predicted_count,
        "predicted_fraction": round(pred_fraction, 4),
        "max_consecutive_predicted": max_consecutive_pred,
        "match_threshold_px": match_threshold_px,
        "true_positives": true_positives,
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "mean_center_error_px": round(mean_center_error, 2) if mean_center_error is not None else None,
        "rmse_center_error_px": round(rmse_error, 2) if rmse_error is not None else None,
    }


def format_report(metrics: Dict[str, Any]) -> str:
    """Format evaluation metrics as a readable CLI table."""
    lines = [
        "=" * 60,
        "          CRICKET BALL TRACKING EVALUATION REPORT          ",
        "=" * 60,
        f"  Total Ground Truth Frames:      {metrics.get('total_gt_frames', 0):>6}",
        f"  Total Tracked Points:           {metrics.get('total_tracked_points', 0):>6}",
        f"    - Measured Points (CV):       {metrics.get('measured_points', 0):>6}",
        f"    - Predicted Points (KF gap):  {metrics.get('predicted_points', 0):>6}",
        f"  Predicted Frame Fraction:       {metrics.get('predicted_fraction', 0.0)*100:>5.1f}%",
        f"  Max Consecutive Predictions:    {metrics.get('max_consecutive_predicted', 0):>6}",
        "-" * 60,
        f"  Match Distance Threshold:       {metrics.get('match_threshold_px', 0.0):>5.1f} px",
        f"  True Positives (hits):          {metrics.get('true_positives', 0):>6}",
        f"  False Positives (spurious):     {metrics.get('false_positives', 0):>6}",
        f"  False Negatives (misses):       {metrics.get('false_negatives', 0):>6}",
        "-" * 60,
        f"  Precision:                      {metrics.get('precision', 0.0)*100:>5.1f}%",
        f"  Recall:                         {metrics.get('recall', 0.0)*100:>5.1f}%",
        f"  F1 Score:                       {metrics.get('f1_score', 0.0)*100:>5.1f}%",
    ]
    if metrics.get('mean_center_error_px') is not None:
        lines.append(f"  Mean Center Error:              {metrics.get('mean_center_error_px', 0.0):>5.2f} px")
    if metrics.get('rmse_center_error_px') is not None:
        lines.append(f"  RMSE Center Error:              {metrics.get('rmse_center_error_px', 0.0):>5.2f} px")
    lines.append("=" * 60)
    return "\n".join(lines)


def run_demo():
    """Runs a self-contained demonstration with synthetic tracking and ground truth."""
    print("\nRunning self-contained Tracking Evaluation demonstration...")
    # Generate 50 frames of ground truth delivery trajectory across frame
    gt = {}
    tracked = []
    
    # Simulated camera projection trajectory: ball travels from (640, 300) to (630, 680)
    for frame_idx in range(50):
        t = frame_idx / 30.0
        # True positions
        true_x = 640.0 - 0.2 * frame_idx + 0.05 * (frame_idx ** 1.3)
        true_y = 300.0 + 7.5 * frame_idx + 0.1 * (frame_idx ** 1.4)
        gt[frame_idx] = (round(true_x, 2), round(true_y, 2))

        # Simulated CV tracker:
        # Frames 15-18 have detection dropouts (predicted points)
        # Add small gaussian noise to measured points (1-2 px)
        if 15 <= frame_idx <= 18:
            # Predicted point
            pred_x = true_x + 3.2
            pred_y = true_y - 2.5
            tracked.append({
                'frame_idx': frame_idx,
                'pixel_x': pred_x,
                'pixel_y': pred_y,
                'x': 0.1, 'y': 5.0, 'z': 1.0, 't': t,
                'is_predicted': True,
                'confidence': 0.65
            })
        elif frame_idx == 45:
            # Missed detection entirely
            continue
        else:
            # Measured detection with 1.2 px noise
            noise_x = (0.5 if frame_idx % 2 == 0 else -0.5) * 1.8
            noise_y = (-0.5 if frame_idx % 3 == 0 else 0.5) * 1.5
            tracked.append({
                'frame_idx': frame_idx,
                'pixel_x': true_x + noise_x,
                'pixel_y': true_y + noise_y,
                'x': 0.1, 'y': 5.0, 'z': 1.0, 't': t,
                'is_predicted': False,
                'confidence': 0.88
            })

    metrics = evaluate_trajectory(tracked, gt, match_threshold_px=15.0)
    print(format_report(metrics))
    return metrics


def main():
    parser = argparse.ArgumentParser(description="Evaluate Cricket Ball Tracking Performance")
    parser.add_argument("--demo", action="store_true", help="Run self-contained demonstration")
    parser.add_argument("--ground-truth", type=str, help="Path to ground truth CSV (frame_idx, x, y)")
    parser.add_argument("--tracking-result", type=str, help="Path to tracking result JSON")
    parser.add_argument("--video", type=str, help="Path to video file to track and evaluate")
    parser.add_argument("--threshold-px", type=float, default=15.0, help="Pixel distance match threshold")
    parser.add_argument("--output-json", type=str, help="Optional path to write metrics JSON")

    args = parser.parse_args()

    if args.demo or (not args.ground_truth and not args.tracking_result and not args.video):
        run_demo()
        return

    if not args.ground_truth:
        print("Error: --ground-truth is required when not running in --demo mode.")
        sys.exit(1)

    gt = load_ground_truth_csv(args.ground_truth)

    if args.video:
        print(f"Tracking ball on video: {args.video}...")
        from services.ball_tracking_service import BallTrackingService
        service = BallTrackingService()
        result = service.track_ball(args.video)
        tracked_points = result.get('points', [])
    elif args.tracking_result:
        with open(args.tracking_result, 'r') as f:
            data = json.load(f)
            tracked_points = data.get('points', data if isinstance(data, list) else [])
    else:
        print("Error: Either --tracking-result or --video must be specified.")
        sys.exit(1)

    metrics = evaluate_trajectory(tracked_points, gt, match_threshold_px=args.threshold_px)
    print(format_report(metrics))

    if args.output_json:
        with open(args.output_json, 'w') as f:
            json.dump(metrics, f, indent=2)
        print(f"Metrics written to: {args.output_json}")


if __name__ == '__main__':
    main()
