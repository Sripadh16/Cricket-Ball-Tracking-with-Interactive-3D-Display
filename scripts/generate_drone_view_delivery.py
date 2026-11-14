#!/usr/bin/env python3
"""
High-Resolution Drone / Aerial View Cricket Delivery Video Generator.
Produces photorealistic single-delivery broadcast clips from an aerial drone perspective,
encoded in standard H.264 (AVC1, yuv420p, +faststart) for seamless HTML5 browser playback,
computer vision ball tracking, and 3D Hawk-Eye reconstruction.
"""
import cv2
import numpy as np
import math
import subprocess
import sys
from pathlib import Path
import imageio_ffmpeg

def generate_drone_view_clip(
    output_path="sample_videos/drone_view_inswinger.mp4",
    width=1280,
    height=720,
    fps=60,
    delivery_style="inswinger"
):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Setup H.264 encoder with yuv420p and faststart for 100% browser compatibility
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg_exe, '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', f'{width}x{height}',
        '-pix_fmt', 'bgr24',
        '-r', str(fps),
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        str(output_path)
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    
    # Perspective pitch dimensions
    pitch_w_top = int(width * 0.16)
    pitch_w_bottom = int(width * 0.26)
    center_x = width // 2
    pitch_top_y = int(height * 0.10)
    pitch_bottom_y = int(height * 0.90)
    pitch_len_px = pitch_bottom_y - pitch_top_y
    
    # Crease lines
    bowling_crease_y = int(pitch_top_y + pitch_len_px * 0.08)
    popping_crease_top_y = int(pitch_top_y + pitch_len_px * 0.13)
    popping_crease_bottom_y = int(pitch_bottom_y - pitch_len_px * 0.12)
    bowling_crease_bottom_y = int(pitch_bottom_y - pitch_len_px * 0.07)
    
    total_frames = 120
    release_frame = 22
    
    # Delivery style configurations
    if delivery_style == "bouncer":
        title_text = "DRS AERIAL DRONE VIEW | SHARP BOUNCER (145 KM/H)"
        bounce_frame = 54
        impact_frame = 104
        start_pos = (center_x + 18, bowling_crease_y + 10, 52)
        bounce_pos = (center_x + 8, int(pitch_top_y + pitch_len_px * 0.42), 0)
        impact_pos = (center_x + 6, popping_crease_bottom_y + 6, 68)
        rebound_h = 75
        drift_x = 2
    elif delivery_style == "legspin":
        title_text = "DRS AERIAL DRONE VIEW | LEG BREAK SPIN (88 KM/H)"
        bounce_frame = 74
        impact_frame = 110
        start_pos = (center_x - 12, bowling_crease_y + 10, 42)
        bounce_pos = (center_x - 16, int(pitch_top_y + pitch_len_px * 0.68), 0)
        impact_pos = (center_x + 10, popping_crease_bottom_y + 6, 26)
        rebound_h = 24
        drift_x = 8
    else:  # inswinger
        title_text = "DRS AERIAL DRONE VIEW | FAST INSWINGER (142 KM/H)"
        bounce_frame = 68
        impact_frame = 104
        start_pos = (center_x + 20, bowling_crease_y + 10, 48)
        bounce_pos = (center_x + 6, int(pitch_top_y + pitch_len_px * 0.60), 0)
        impact_pos = (center_x - 2, popping_crease_bottom_y + 6, 20)
        rebound_h = 28
        drift_x = -5
    
    base_grass = np.full((height, width, 3), (38, 115, 45), dtype=np.uint8)
    stripe_w = 40
    for x in range(0, width, stripe_w * 2):
        cv2.rectangle(base_grass, (x, 0), (x + stripe_w, height), (42, 126, 49), -1)
        
    pitch_poly = np.array([
        [center_x - pitch_w_top // 2, pitch_top_y],
        [center_x + pitch_w_top // 2, pitch_top_y],
        [center_x + pitch_w_bottom // 2, pitch_bottom_y],
        [center_x - pitch_w_bottom // 2, pitch_bottom_y]
    ], np.int32)
    
    wear_poly = np.array([
        [center_x - pitch_w_top // 6, pitch_top_y + 20],
        [center_x + pitch_w_top // 6, pitch_top_y + 20],
        [center_x + pitch_w_bottom // 6, pitch_bottom_y - 20],
        [center_x - pitch_w_bottom // 6, pitch_bottom_y - 20]
    ], np.int32)
    
    def get_pitch_width_at(y):
        ratio = (y - pitch_top_y) / (pitch_bottom_y - pitch_top_y)
        return int(pitch_w_top + ratio * (pitch_w_bottom - pitch_w_top))
    
    dust_particles = []
    
    for f in range(total_frames):
        frame = base_grass.copy()
        
        # 1. Pitch
        cv2.fillPoly(frame, [pitch_poly], (68, 148, 88))
        cv2.fillPoly(frame, [wear_poly], (78, 158, 98))
        
        # 2. Creases
        w_top_pop = get_pitch_width_at(popping_crease_top_y)
        w_top_bowl = get_pitch_width_at(bowling_crease_y)
        cv2.line(frame, (center_x - w_top_pop // 2 + 10, popping_crease_top_y), 
                 (center_x + w_top_pop // 2 - 10, popping_crease_top_y), (245, 245, 245), 3)
        cv2.line(frame, (center_x - w_top_bowl // 2 + 18, bowling_crease_y), 
                 (center_x + w_top_bowl // 2 - 18, bowling_crease_y), (240, 240, 240), 2)
        
        w_bot_pop = get_pitch_width_at(popping_crease_bottom_y)
        w_bot_bowl = get_pitch_width_at(bowling_crease_bottom_y)
        cv2.line(frame, (center_x - w_bot_pop // 2 + 10, popping_crease_bottom_y), 
                 (center_x + w_bot_pop // 2 - 10, popping_crease_bottom_y), (250, 250, 250), 3)
        cv2.line(frame, (center_x - w_bot_bowl // 2 + 18, bowling_crease_bottom_y), 
                 (center_x + w_bot_bowl // 2 - 18, bowling_crease_bottom_y), (240, 240, 240), 2)
        
        for side in [-1, 1]:
            cv2.line(frame, 
                     (center_x + side * (w_bot_bowl // 2 - 18), bowling_crease_bottom_y + 12),
                     (center_x + side * (w_bot_bowl // 2 - 18), popping_crease_bottom_y - 12),
                     (240, 240, 240), 2)
            cv2.line(frame, 
                     (center_x + side * (w_top_bowl // 2 - 18), bowling_crease_y - 12),
                     (center_x + side * (w_top_bowl // 2 - 18), popping_crease_top_y + 12),
                     (240, 240, 240), 2)
        
        # 3. Stumps
        for off in [-7, 0, 7]:
            sx, sy = center_x + off, bowling_crease_bottom_y
            cv2.line(frame, (sx + 2, sy), (sx + 8, sy - 22), (25, 75, 30), 2)
            cv2.line(frame, (sx, sy), (sx, sy - 24), (200, 230, 250), 3)
            cv2.circle(frame, (sx, sy - 24), 2, (220, 245, 255), -1)
        cv2.line(frame, (center_x - 9, bowling_crease_bottom_y - 25), 
                 (center_x + 9, bowling_crease_bottom_y - 25), (230, 245, 255), 2)
        
        for off in [-5, 0, 5]:
            sx, sy = center_x + off, bowling_crease_y
            cv2.line(frame, (sx, sy), (sx, sy - 18), (180, 215, 235), 2)
        cv2.line(frame, (center_x - 7, bowling_crease_y - 19), (center_x + 7, bowling_crease_y - 19), (210, 235, 245), 2)
        
        # 4. Players
        bat_x = center_x + 14
        bat_y = popping_crease_bottom_y - 4
        cv2.ellipse(frame, (bat_x + 6, bat_y + 4), (12, 6), 30, 0, 360, (25, 70, 30), -1)
        cv2.circle(frame, (bat_x, bat_y - 8), 7, (40, 80, 160), -1)
        cv2.ellipse(frame, (bat_x, bat_y), (8, 14), 0, 0, 360, (240, 240, 245), -1)
        cv2.rectangle(frame, (bat_x - 10, bat_y - 4), (bat_x - 6, bat_y + 14), (220, 220, 230), -1)
        cv2.line(frame, (bat_x - 8, bat_y + 6), (bat_x - 16, bat_y + 18), (140, 180, 210), 3)
        
        if f <= release_frame:
            b_ratio = f / release_frame
            bowler_y = int(pitch_top_y - 15 + b_ratio * 25)
            bowler_x = center_x + 22 - int(b_ratio * 4)
            cv2.circle(frame, (bowler_x, bowler_y), 6, (50, 90, 170), -1)
            cv2.line(frame, (bowler_x, bowler_y), (bowler_x, bowler_y + 14), (240, 240, 240), 4)
            
        # 5. Ball
        if f >= release_frame:
            if f <= bounce_frame:
                t = (f - release_frame) / (bounce_frame - release_frame)
                bx = int(start_pos[0] + t * (bounce_pos[0] - start_pos[0]) + drift_x * math.sin(t * math.pi))
                by = int(start_pos[1] + t * (bounce_pos[1] - start_pos[1]))
                bz = start_pos[2] * (1 - t) + 12 * math.sin(t * math.pi) * (1 - t)
            elif f <= impact_frame:
                t = (f - bounce_frame) / (impact_frame - bounce_frame)
                bx = int(bounce_pos[0] + t * (impact_pos[0] - bounce_pos[0]))
                by = int(bounce_pos[1] + t * (impact_pos[1] - bounce_pos[1]))
                bz = rebound_h * math.sin(t * math.pi * 0.7)
                if f == bounce_frame + 1:
                    dust_particles = [(bounce_pos[0] + np.random.randint(-6, 6), 
                                      bounce_pos[1] + np.random.randint(-4, 4), 
                                      np.random.randint(2, 5)) for _ in range(8)]
            else:
                t = (f - impact_frame) / (total_frames - impact_frame)
                bx = int(impact_pos[0] - t * 4)
                by = int(impact_pos[1] + t * 14)
                bz = max(0, impact_pos[2] - t * 15)
                
            if f >= bounce_frame:
                cv2.ellipse(frame, (bounce_pos[0], bounce_pos[1]), (6, 3), 0, 0, 360, (50, 100, 60), -1)
                if dust_particles and f < bounce_frame + 12:
                    for px, py, pr in dust_particles:
                        cv2.circle(frame, (px, py), pr, (140, 190, 150), -1)
                        
            # Shadow
            shadow_dist = int(bz * 0.45)
            shadow_x = bx + shadow_dist // 2 + 2
            shadow_y = by + shadow_dist + 2
            shadow_r = int(5 + (by - pitch_top_y) * 0.007)
            cv2.circle(frame, (shadow_x, shadow_y), shadow_r, (25, 75, 32), -1)
            
            # Red cricket ball with 3D highlight & seam
            ball_r = int(6 + (by - pitch_top_y) * 0.008)
            ball_center = (bx, by)
            cv2.circle(frame, ball_center, ball_r + 1, (20, 20, 180), -1)
            cv2.circle(frame, ball_center, ball_r, (25, 30, 225), -1)
            cv2.circle(frame, (bx - ball_r // 3, by - ball_r // 3), max(1, ball_r // 3), (180, 190, 255), -1)
            cv2.line(frame, (bx - ball_r // 2, by), (bx + ball_r // 2, by), (240, 240, 255), 1)
            
        cv2.putText(frame, title_text, (30, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (235, 245, 255), 2, cv2.LINE_AA)
        proc.stdin.write(frame.tobytes())
        
    proc.stdin.close()
    proc.wait()
    print(f"Generated H.264 video: {output_path} ({delivery_style})")
    return output_path

if __name__ == "__main__":
    generate_drone_view_clip("sample_videos/drone_view_inswinger.mp4", delivery_style="inswinger")
    generate_drone_view_clip("sample_videos/drone_view_bouncer.mp4", delivery_style="bouncer")
    generate_drone_view_clip("sample_videos/drone_view_legspin.mp4", delivery_style="legspin")
    # Also update sample_delivery.mp4 with H.264
    generate_drone_view_clip("sample_delivery.mp4", delivery_style="inswinger")
