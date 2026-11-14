import cv2
import numpy as np
import os
from pathlib import Path

def create_sample_cricket_video(output_path="sample_delivery.mp4", width=640, height=360, fps=30, duration_sec=3.0):
    total_frames = int(fps * duration_sec)
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    # Coordinates setup
    pitch_x1, pitch_x2 = int(width * 0.3), int(width * 0.7)
    stump_x = width // 2
    stump_y = int(height * 0.82)
    
    # Ball delivery arc parameters
    start_x, start_y = width // 2 + 10, int(height * 0.25)
    bounce_x, bounce_y = width // 2 - 5, int(height * 0.65)
    end_x, end_y = width // 2, stump_y - 10
    
    bounce_frame = int(total_frames * 0.55)
    
    for f in range(total_frames):
        # Green turf background
        frame = np.full((height, width, 3), (40, 130, 50), dtype=np.uint8)
        
        # Pitch rectangle (light turf/clay)
        cv2.rectangle(frame, (pitch_x1, 0), (pitch_x2, height), (70, 160, 90), -1)
        
        # Bowling crease and popping crease
        cv2.line(frame, (pitch_x1, int(height * 0.2)), (pitch_x2, int(height * 0.2)), (240, 240, 240), 2)
        cv2.line(frame, (pitch_x1, int(height * 0.8)), (pitch_x2, int(height * 0.8)), (240, 240, 240), 2)
        
        # Stumps at batsman end (3 wooden vertical lines)
        for offset in [-6, 0, 6]:
            cv2.line(frame, (stump_x + offset, stump_y - 30), (stump_x + offset, stump_y), (180, 210, 230), 2)
        # Bails
        cv2.line(frame, (stump_x - 8, stump_y - 30), (stump_x + 8, stump_y - 30), (200, 220, 240), 2)
        
        # Ball position interpolation
        if f <= bounce_frame:
            t = f / bounce_frame
            # Parabolic descent
            ball_x = int(start_x + t * (bounce_x - start_x))
            ball_y = int(start_y + (t ** 1.3) * (bounce_y - start_y))
            ball_r = int(5 + t * 4)  # perspective scaling
        else:
            t = (f - bounce_frame) / (total_frames - bounce_frame)
            # Rebound
            ball_x = int(bounce_x + t * (end_x - bounce_x))
            # Arc after bounce
            ball_y = int(bounce_y - 20 * np.sin(t * np.pi * 0.6) + t * (end_y - bounce_y))
            ball_r = int(9 + t * 3)
            
        # Draw red cricket ball (with shadow & highlight)
        cv2.circle(frame, (ball_x + 2, ball_y + 4), ball_r, (30, 90, 40), -1) # shadow
        cv2.circle(frame, (ball_x, ball_y), ball_r, (30, 30, 210), -1)       # red ball
        cv2.circle(frame, (ball_x - ball_r // 3, ball_y - ball_r // 3), max(1, ball_r // 3), (120, 120, 255), -1) # highlight
        
        out.write(frame)
        
    out.release()
    print(f"Generated {output_path} ({total_frames} frames, {width}x{height})")

if __name__ == "__main__":
    create_sample_cricket_video("sample_delivery.mp4")

