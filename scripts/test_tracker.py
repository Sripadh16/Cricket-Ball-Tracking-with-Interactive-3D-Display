import sys
import os
sys.path.insert(0, os.path.abspath("Cricket-Ball-Tracking-with-Interactive-3D-Display/backend/src"))
from services.ball_tracking_service import BallTrackingService
import cv2
import glob

service = BallTrackingService()
print(f"BallTrackingService loaded. YOLO available: {service.yolo_detector is not None}")

test_imgs = glob.glob("Cricket Dataset.v5i.yolov8/test/images/*.jpg")[:5]
for img_p in test_imgs:
    frame = cv2.imread(img_p)
    ball = service._detect_ball_comprehensive(frame)
    stump = service._detect_stumps(frame)
    b_info = f"{ball['method']} (conf={ball['confidence']:.2f}, pos=({ball['x']:.1f}, {ball['y']:.1f}))" if ball else "None"
    s_info = f"{stump['method']} (pos=({stump['pixel_position'][0]:.1f}, {stump['pixel_position'][1]:.1f}))" if stump else "None"
    print(f"Image: {os.path.basename(img_p)}")
    print(f"  Ball:   {b_info}")
    print(f"  Stumps: {s_info}")

