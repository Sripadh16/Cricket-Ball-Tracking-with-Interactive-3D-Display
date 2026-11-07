"""
Train YOLOv8 on the Cricket Ball & Stump Dataset.
Supports both local execution (CPU/GPU) and Google Colab (Free T4 GPU).
Automatically copies the resulting best.pt to backend/src/models/best.pt upon completion.
"""
import os
import sys
import shutil
from pathlib import Path
from ultralytics import YOLO
import torch

def main():
    print("=" * 60)
    print(" CRICKET BALL & STUMP YOLOv8 TRAINING PIPELINE")
    print("=" * 60)

    # 1. Detect Hardware
    has_cuda = torch.cuda.is_available()
    device = "0" if has_cuda else "cpu"
    print(f"Hardware detected: {'CUDA GPU (' + torch.cuda.get_device_name(0) + ')' if has_cuda else 'CPU (No GPU found)'}")
    
    if not has_cuda:
        print("\n[NOTE] Training on CPU with 10k images will take several hours.")
        print("For 10x faster training (~15-20 mins), run this on Google Colab with a free T4 GPU!")
        print("Google Colab instructions:")
        print("  1. Upload Cricket Dataset.v5i.yolov8.zip to Google Drive or Colab session")
        print("  2. In a Colab GPU notebook, run:")
        print("       !pip install ultralytics")
        print("       from ultralytics import YOLO")
        print("       model = YOLO('yolov8n.pt')")
        print("       model.train(data='data.yaml', epochs=30, imgsz=640, batch=16, device=0)")
        print("  3. Download best.pt and place it into backend/src/models/best.pt\n")

    # 2. Locate Dataset
    current_dir = Path(__file__).resolve().parent
    workspace_root = current_dir
    for cand in [current_dir, current_dir.parent, current_dir.parent.parent, current_dir.parent.parent.parent]:
        if (cand / "Cricket Dataset.v5i.yolov8" / "data.yaml").exists():
            workspace_root = cand
            break
            
    data_yaml = workspace_root / "Cricket Dataset.v5i.yolov8" / "data.yaml"
    if not data_yaml.exists():
        data_yaml = Path("Cricket Dataset.v5i.yolov8/data.yaml")
        
    if not data_yaml.exists():
        print(f"Error: Could not locate data.yaml at {data_yaml}")
        sys.exit(1)

    print(f"Workspace root: {workspace_root}")
    print(f"Using dataset configuration: {data_yaml}")

    # 3. Load Model
    model = YOLO("yolov8n.pt")
    print("Loaded baseline YOLOv8n architecture.")

    # 4. Training Hyperparameters
    epochs = int(os.environ.get("EPOCHS", 30 if has_cuda else 5))
    batch_size = int(os.environ.get("BATCH_SIZE", 16 if has_cuda else 8))
    img_size = 640

    print(f"Starting training: {epochs} epochs, batch size: {batch_size}, imgsz: {img_size}, device: {device}...")
    
    results = model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=img_size,
        batch=batch_size,
        device=device,
        project=str(workspace_root / "runs" / "detect"),
        name="cricket_yolo",
        exist_ok=True,
        save=True,
        plots=True,
        verbose=True
    )

    print("\nTraining completed successfully!")
    
    # 5. Automatically copy best.pt to backend model weights directory
    target_weights_dir = workspace_root / "Cricket-Ball-Tracking-with-Interactive-3D-Display" / "backend" / "src" / "models"
    target_weights_dir.mkdir(parents=True, exist_ok=True)
    best_weights = workspace_root / "runs" / "detect" / "cricket_yolo" / "weights" / "best.pt"
    
    if best_weights.exists():
        dest = target_weights_dir / "best.pt"
        shutil.copy2(best_weights, dest)
        print(f"✓ Copied best weights to: {dest}")
        print("BallTrackingService will automatically use these weights for real-time DRS tracking!")
    else:
        print(f"Notice: Check training weights at {best_weights}")

if __name__ == "__main__":
    main()