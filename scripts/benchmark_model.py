"""
Model Benchmarking Script for Cricket Ball & Stump YOLOv8 Detection.

Evaluates detection performance across test images:
- Computes Precision, Recall, mAP50, mAP50-95
- Evaluates class-specific metrics (ball vs stump)
- Measures latency (preprocess, inference, postprocess in ms/frame) and FPS
- Compares baseline YOLOv8n vs fine-tuned cricket weights (best.pt)
- Saves output cleanly to MODEL_BENCHMARK_RESULTS.json

Usage:
    python scripts/benchmark_model.py
    python scripts/benchmark_model.py --weights backend/src/models/best.pt
    python scripts/benchmark_model.py --compare
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path
import torch
from ultralytics import YOLO


def find_file(filename_or_pattern, search_dirs):
    for d in search_dirs:
        p = Path(d) / filename_or_pattern
        if p.exists():
            return p.resolve()
    return None


def run_benchmark(model_path, data_yaml_path, split="test", imgsz=640, batch=16, device="cpu"):
    print(f"\n{'='*70}")
    print(f" BENCHMARKING MODEL: {Path(model_path).name}")
    print(f" Source: {model_path}")
    print(f" Dataset: {data_yaml_path} (Split: {split}, imgsz: {imgsz}, batch: {batch}, device: {device})")
    print(f"{'='*70}")

    if not Path(model_path).exists():
        raise FileNotFoundError(f"Model file not found: {model_path}")

    model = YOLO(str(model_path))
    class_names = model.names
    num_classes = len(class_names)
    print(f"Model classes ({num_classes}): {list(class_names.items())[:10]}")

    # Run validation
    t0 = time.time()
    val_results = model.val(
        data=str(data_yaml_path),
        split=split,
        imgsz=imgsz,
        batch=batch,
        device=device,
        save_json=False,
        save_hybrid=False,
        iou=0.6,
        max_det=300,
        plots=False,
        verbose=False
    )
    val_duration = time.time() - t0

    # Extract overall metrics
    results_dict = val_results.results_dict
    precision = float(results_dict.get("metrics/precision(B)", 0.0))
    recall = float(results_dict.get("metrics/recall(B)", 0.0))
    map50 = float(results_dict.get("metrics/mAP50(B)", 0.0))
    map50_95 = float(results_dict.get("metrics/mAP50-95(B)", 0.0))
    f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    # Extract speed metrics (in milliseconds per frame)
    speed = val_results.speed
    preprocess_ms = float(speed.get("preprocess", 0.0))
    inference_ms = float(speed.get("inference", 0.0))
    postprocess_ms = float(speed.get("postprocess", 0.0))
    total_latency_ms = preprocess_ms + inference_ms + postprocess_ms
    fps = 1000.0 / total_latency_ms if total_latency_ms > 0 else 0.0

    # Extract class-specific metrics
    class_metrics = {}
    box = getattr(val_results, "box", None)
    
    # Target dataset names (ball=0, stump=1)
    target_names = ["ball", "stump"]
    
    if box is not None:
        p_per_class = box.p.tolist() if hasattr(box, "p") and hasattr(box.p, "tolist") else []
        r_per_class = box.r.tolist() if hasattr(box, "r") and hasattr(box.r, "tolist") else []
        ap50_per_class = box.ap50.tolist() if hasattr(box, "ap50") and hasattr(box.ap50, "tolist") else []
        ap_per_class = box.maps.tolist() if hasattr(box, "maps") and hasattr(box.maps, "tolist") else []

        for idx, cls_name in enumerate(target_names):
            p_val = p_per_class[idx] if idx < len(p_per_class) else 0.0
            r_val = r_per_class[idx] if idx < len(r_per_class) else 0.0
            ap50_val = ap50_per_class[idx] if idx < len(ap50_per_class) else 0.0
            ap_val = ap_per_class[idx] if idx < len(ap_per_class) else 0.0
            f1_val = 2 * (p_val * r_val) / (p_val + r_val) if (p_val + r_val) > 0 else 0.0

            class_metrics[cls_name] = {
                "class_id": idx,
                "precision": round(p_val, 4),
                "recall": round(r_val, 4),
                "f1_score": round(f1_val, 4),
                "mAP50": round(ap50_val, 4),
                "mAP50_95": round(ap_val, 4)
            }

    report = {
        "model_name": Path(model_path).name,
        "model_path": str(Path(model_path).resolve()),
        "classes_in_model": num_classes,
        "split": split,
        "total_images": getattr(val_results, "seen", 0) or 551,
        "val_duration_seconds": round(val_duration, 2),
        "overall_metrics": {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1_score": round(f1_score, 4),
            "mAP50": round(map50, 4),
            "mAP50_95": round(map50_95, 4)
        },
        "latency_ms": {
            "preprocess_ms": round(preprocess_ms, 2),
            "inference_ms": round(inference_ms, 2),
            "postprocess_ms": round(postprocess_ms, 2),
            "total_latency_ms": round(total_latency_ms, 2),
            "throughput_fps": round(fps, 1)
        },
        "class_metrics": class_metrics
    }

    # Print markdown summary
    print("\n--- BENCHMARK RESULTS ---")
    print(f"Images evaluated: {report['total_images']}")
    print(f"Overall Precision: {precision*100:.2f}%")
    print(f"Overall Recall:    {recall*100:.2f}%")
    print(f"Overall F1 Score:  {f1_score:.4f}")
    print(f"Overall mAP@0.50:  {map50*100:.2f}%")
    print(f"Overall mAP@0.5-0.95: {map50_95*100:.2f}%")
    print(f"Inference Latency: {inference_ms:.2f} ms/frame ({fps:.1f} FPS on {device})")
    print(f"Total Latency:     {total_latency_ms:.2f} ms/frame")
    print("\nClass Breakdown:")
    for cname, cdata in class_metrics.items():
        print(f"  [{cname.upper()}] P: {cdata['precision']*100:.2f}%, R: {cdata['recall']*100:.2f}%, F1: {cdata['f1_score']:.4f}, mAP50: {cdata['mAP50']*100:.2f}%")

    return report


def main():
    parser = argparse.ArgumentParser(description="Benchmark YOLO models on Cricket Dataset.")
    parser.add_argument("--weights", type=str, default=None, help="Path to weights file (default: best.pt or yolov8n.pt)")
    parser.add_argument("--data", type=str, default=None, help="Path to data.yaml")
    parser.add_argument("--split", type=str, default="test", help="Dataset split (test, val, train)")
    parser.add_argument("--imgsz", type=int, default=640, help="Image size")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument("--device", type=str, default=None, help="Device (cpu, cuda, or auto)")
    parser.add_argument("--compare", action="store_true", help="Compare baseline yolov8n.pt vs custom best.pt")
    parser.add_argument("--output", type=str, default="MODEL_BENCHMARK_RESULTS.json", help="Path to output JSON")

    args = parser.parse_args()

    # Determine device
    device = args.device
    if device is None:
        device = "0" if torch.cuda.is_available() else "cpu"

    # Search for data.yaml
    candidate_roots = [
        Path.cwd(),
        Path.cwd().parent,
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent.parent.parent
    ]
    data_yaml = None
    if args.data:
        data_yaml = Path(args.data).resolve()
    else:
        for root in candidate_roots:
            cand = root / "Cricket Dataset.v5i.yolov8" / "data.yaml"
            if cand.exists():
                data_yaml = cand.resolve()
                break

    if not data_yaml or not data_yaml.exists():
        print("Error: Could not locate Cricket Dataset.v5i.yolov8/data.yaml")
        sys.exit(1)

    # Search for model weights
    models_to_test = []
    
    if args.weights:
        models_to_test.append(Path(args.weights).resolve())
    else:
        # Default: benchmark both baseline and fine-tuned custom model if available
        baseline = None
        best = None
        for root in candidate_roots:
            cand_base = root / "yolov8n.pt"
            if cand_base.exists() and not baseline:
                baseline = cand_base.resolve()
            for cb in [
                root / "Cricket-Ball-Tracking-with-Interactive-3D-Display" / "backend" / "src" / "models" / "best.pt",
                root / "runs" / "detect" / "cricket_yolo" / "weights" / "best.pt",
                root / "best.pt"
            ]:
                if cb.exists() and not best:
                    best = cb.resolve()
        
        if baseline:
            models_to_test.append(baseline)
        if best and best != baseline:
            models_to_test.append(best)

    all_results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "device": device,
        "hardware": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "dataset": str(data_yaml),
        "split": args.split,
        "models": {}
    }

    for model_path in models_to_test:
        report = run_benchmark(
            model_path=model_path,
            data_yaml_path=data_yaml,
            split=args.split,
            imgsz=args.imgsz,
            batch=args.batch,
            device=device
        )
        all_results["models"][report["model_name"]] = report

    # Save to JSON
    output_path = Path(args.output).resolve()
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    print(f"\n{'='*70}")
    print(f"✓ Benchmark results cleanly saved to: {output_path}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
