from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from services.video_service import VideoService
from services.ball_tracking_service import BallTrackingService
from services.auth_service import AuthService
from models.trajectory import Trajectory
from api.auth import get_current_user, get_current_user_optional
from models.user import User
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_VIDEO_EXTENSIONS
from services.sample_generator import DeliveryPhysicsSimulator
from services.ball_physics_engine import BallPhysicsEngine
from typing import Optional
import uuid
import logging
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)
router = APIRouter()

# Shared thread pool for CPU-bound OpenCV ball tracking operations
_TRACKING_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tracking_worker")


async def _run_tracking_async(file_path: str) -> dict:
    """Run CPU-intensive OpenCV ball tracking in the shared thread pool."""
    loop = asyncio.get_running_loop()
    def _do_track():
        service = BallTrackingService()
        return service.track_ball(str(file_path))
    return await loop.run_in_executor(_TRACKING_EXECUTOR, _do_track)



# In-memory progress tracking: video_id -> { progress, current_frame, total_frames, status, stage }
video_progress = {}


def process_video_background(video_id: str, file_path: str):
    """Background worker to run BallTrackingService without holding HTTP request open."""
    db = SessionLocal()
    video_service = VideoService(db)
    try:
        def on_progress(frame_idx, total_frames, stage="Tracking ball trajectory"):
            pct = int((frame_idx / max(1, total_frames)) * 100)
            video_progress[video_id] = {
                "progress": pct,
                "current_frame": frame_idx,
                "total_frames": total_frames,
                "status": "processing",
                "stage": stage
            }

        tracking_service = BallTrackingService(progress_callback=on_progress)
        trajectory_data = tracking_service.track_ball(str(file_path))

        additional_data = _build_additional_data(trajectory_data)

        # Clear existing trajectory for this video if any
        db.query(Trajectory).filter(Trajectory.video_id == video_id).delete()
        trajectory = Trajectory(
            video_id=video_id,
            points=trajectory_data.get("points", []),
            confidence_score=trajectory_data.get("confidence_score", 0),
            ball_detected=trajectory_data.get("ball_detected", False),
            timestamps=trajectory_data.get("timestamps", []),
            additional_data=additional_data
        )
        db.add(trajectory)
        db.commit()

        video_service.update_video_status(video_id, "processed")
        video_progress[video_id] = {
            "progress": 100,
            "current_frame": len(trajectory_data.get("points", [])),
            "total_frames": len(trajectory_data.get("points", [])),
            "status": "processed",
            "stage": "Tracking Complete"
        }
        logger.info(f"Video {video_id} background tracking completed successfully.")
    except Exception as e:
        logger.error(f"Error processing video {video_id} in background: {e}")
        try:
            video_service.update_video_status(video_id, "error")
        except Exception:
            pass
        video_progress[video_id] = {
            "progress": 100,
            "status": "error",
            "error": str(e),
            "stage": "Failed"
        }
    finally:
        db.close()

def _build_additional_data(trajectory_data: dict) -> dict:
    """Extract all DRS/analytics fields from tracking result for consistent storage."""
    return {
        "stumps_position": trajectory_data.get("stumps_position"),
        "bowler_position": trajectory_data.get("bowler_position"),
        "batter_position": trajectory_data.get("batter_position"),
        "lbw_analysis": trajectory_data.get("lbw_analysis", []),
        "debug_info": trajectory_data.get("debug_info", {}),
        "video_info": trajectory_data.get("video_info", {}),
        "pitch_info": trajectory_data.get("pitch_info"),
        "pre_bounce_points": trajectory_data.get("pre_bounce_points"),
        "post_bounce_points": trajectory_data.get("post_bounce_points"),
        "extrapolated_points": trajectory_data.get("extrapolated_points"),
        "bounce_point": trajectory_data.get("bounce_point"),
        "impact_point": trajectory_data.get("impact_point"),
        "stump_plane_target": trajectory_data.get("stump_plane_target"),
        "drs_evaluation": trajectory_data.get("drs_evaluation"),
        "release_speed_kmh": trajectory_data.get("release_speed_kmh"),
        "bounce_speed_kmh": trajectory_data.get("bounce_speed_kmh"),
        "release_speed_px_per_sec": trajectory_data.get("release_speed_px_per_sec"),
        "length_zone": trajectory_data.get("length_zone"),
    }


# ── Public Synthetic Presets (No authentication required) ───────────────────

@router.get("/presets")
async def get_preset_deliveries():
    """Return all available physical preset deliveries and pitch surface profiles for interactive demo (public)"""
    return {
        "presets": DeliveryPhysicsSimulator.get_all_preset_deliveries(),
        "pitch_types": BallPhysicsEngine.get_available_pitch_types()
    }


@router.get("/presets/{delivery_type}")
async def get_preset_delivery_trajectory(
    delivery_type: str,
    pitch_type: str = Query("standard_hard", description="Pitch surface type: standard_hard, green_seamer, dry_dusty, damp_clay"),
    rpm: Optional[float] = Query(None, description="Custom spin RPM (e.g. 800 - 3000)")
):
    """Generate and return full 3D physics trajectory & DRS data with Magnus aerodynamics and pitch restitution (public)"""
    try:
        data = DeliveryPhysicsSimulator.generate_delivery(
            delivery_type=delivery_type,
            pitch_type=pitch_type,
            rpm=rpm
        )
        return data
    except Exception as e:
        logger.error(f"Error generating preset delivery: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Private Video Operations (Authentication & Ownership Enforced) ──────────

@router.get("/")
async def list_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all videos belonging strictly to the authenticated user"""
    try:
        video_service = VideoService(db)
        videos = video_service.list_videos(user_id=current_user.id)

        return {
            "videos": [
                {
                    "id": video.id,
                    "filename": Path(video.file_path).name if video.file_path else video.filename,
                    "original_filename": video.filename,
                    "stream_url": f"/videos/{video.id}/stream",
                    "status": video.status,
                    "created_at": video.upload_date.isoformat() if video.upload_date else None,
                    "processed_at": video.processing_completed_at.isoformat() if video.processing_completed_at else None,
                    "duration": video.duration,
                    "file_size": video.file_size
                }
                for video in videos
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing videos for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    sync: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload a video file for ball tracking analysis with authenticated ownership.
    Streams upload in 1 MB chunks to reject oversized files without buffering in RAM.
    """
    safe_name = Path(file.filename or "upload").name
    file_ext = Path(safe_name).suffix.lower()
    if file_ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file_ext}'. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        )

    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}_{safe_name}"
    CHUNK = 1024 * 1024

    try:
        file_size = 0
        with open(file_path, "wb") as out:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_SIZE_BYTES:
                    out.close()
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB"
                    )
                out.write(chunk)
        logger.info(f"Video uploaded: {file_path} ({file_size:,} bytes) by user {current_user.id}")
    except HTTPException:
        raise
    except Exception as e:
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        logger.error(f"Failed to save video file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save video file")

    # Create video record bound to authenticated user
    video_service = VideoService(db)
    video = video_service.create_video(
        user_id=current_user.id,
        filename=file.filename,
        file_path=str(file_path),
        file_size=file_size
    )

    # Offload tracking to shared thread pool
    logger.info(f"Starting automatic ball tracking for video: {video.id} (sync={sync})")
    video_service.update_video_status(video.id, "processing")
    video_progress[video.id] = {
        "progress": 0,
        "current_frame": 0,
        "total_frames": 0,
        "status": "processing",
        "stage": "Queued for tracking"
    }

    try:
        trajectory_data = await _run_tracking_async(str(file_path))

        additional_data = _build_additional_data(trajectory_data)
        trajectory = Trajectory(
            video_id=video.id,
            points=trajectory_data.get("points", []),
            confidence_score=trajectory_data.get("confidence_score", 0),
            ball_detected=trajectory_data.get("ball_detected", False),
            timestamps=trajectory_data.get("timestamps", []),
            additional_data=additional_data
        )
        db.add(trajectory)
        db.commit()

        video_service.update_video_status(video.id, "processed")
        video_progress[video.id] = {
            "progress": 100,
            "current_frame": len(trajectory_data.get("points", [])),
            "total_frames": len(trajectory_data.get("points", [])),
            "status": "processed",
            "stage": "Tracking Complete"
        }
        logger.info(f"Video processed successfully: {video.id}")

    except Exception as e:
        logger.error(f"Error processing video {video.id}: {e}")
        db.rollback()
        video_service.update_video_status(video.id, "error")
        video_progress[video.id] = {
            "progress": 100,
            "status": "error",
            "error": str(e),
            "stage": "Failed"
        }

    return {
        "id": video.id,
        "filename": file_path.name,
        "original_filename": video.filename,
        "stream_url": f"/videos/{video.id}/stream",
        "status": video.status,
        "upload_date": video.upload_date.isoformat() if video.upload_date else None,
        "file_size": video.file_size
    }

@router.get("/{video_id}/progress")
async def get_video_progress(
    video_id: str,
    db: Session = Depends(get_db)
):
    """Retrieve real-time processing progress for an uploaded video."""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    prog = video_progress.get(video_id, {
        "progress": 100 if video.status == "processed" else 0,
        "current_frame": 0,
        "total_frames": 0,
        "status": video.status,
        "stage": video.status.capitalize()
    })
    return {
        "video_id": video_id,
        "status": video.status,
        "progress": prog.get("progress", 0),
        "current_frame": prog.get("current_frame", 0),
        "total_frames": prog.get("total_frames", 0),
        "stage": prog.get("stage", video.status)
    }



@router.post("/{video_id}/reprocess")
async def reprocess_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Reprocess video with concurrency guard and atomic transactional replacement."""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    # Concurrency guard: reject duplicate processing jobs for the same video
    if video.status == "processing":
        raise HTTPException(status_code=409, detail="Video is currently being processed")

    logger.info(f"Reprocessing video: {video_id} for user: {current_user.id}")

    # Set status to processing
    video_service.update_video_status(video_id, "processing")

    try:
        # Run tracking in shared thread pool FIRST
        trajectory_data = await _run_tracking_async(video.file_path)

        # Build replacement trajectory in-memory before modifying database
        additional_data = _build_additional_data(trajectory_data)
        new_trajectory = Trajectory(
            video_id=video_id,
            points=trajectory_data.get("points", []),
            confidence_score=trajectory_data.get("confidence_score", 0),
            ball_detected=trajectory_data.get("ball_detected", False),
            timestamps=trajectory_data.get("timestamps", []),
            additional_data=additional_data
        )

        # Single atomic transaction: delete old trajectory, insert new trajectory, update status
        try:
            db.query(Trajectory).filter(Trajectory.video_id == video_id).delete()
            db.add(new_trajectory)
            video.status = "processed"
            video.processing_completed_at = datetime.utcnow()
            db.commit()
        except Exception as db_err:
            db.rollback()
            raise db_err

        logger.info(f"Video reprocessed successfully: {video_id}")
        return {
            "message": "Video reprocessed successfully",
            "video_id": video_id,
            "ball_detected": trajectory_data.get('ball_detected', False),
            "points_detected": len(trajectory_data.get('points', []))
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error reprocessing video {video_id}: {e}")
        db.rollback()
        # Restore status based on whether an old trajectory still exists
        still_has_traj = db.query(Trajectory).filter(Trajectory.video_id == video_id).first() is not None
        video_service.update_video_status(video_id, "processed" if still_has_traj else "failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{video_id}/track")
async def track_video(
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start ball tracking analysis on a video with concurrency protection."""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    if video.status == "processing":
        raise HTTPException(status_code=409, detail="Tracking already in progress")

    if video.status == "processed":
        return {
            "video_id": video_id,
            "status": "processed",
            "message": "Video already processed. Retrieve trajectory using /trajectory endpoint"
        }

    video_service.update_video_status(video_id, "processing")
    logger.info(f"Starting ball tracking for video: {video_id}")

    try:
        trajectory_data = await _run_tracking_async(video.file_path)

        additional_data = _build_additional_data(trajectory_data)
        trajectory = Trajectory(
            video_id=video_id,
            points=trajectory_data["points"],
            timestamps=trajectory_data["timestamps"],
            confidence_score=trajectory_data["confidence_score"],
            ball_detected=trajectory_data["ball_detected"],
            additional_data=additional_data
        )
        db.add(trajectory)
        db.commit()

        video_service.update_video_status(video_id, "processed")
        logger.info(f"Ball tracking completed for video: {video_id}")

        return {
            "video_id": video_id,
            "status": "processed",
            "ball_detected": trajectory_data["ball_detected"],
            "confidence_score": trajectory_data["confidence_score"],
            "processing_time": trajectory_data.get("processing_time", 0)
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Ball tracking failed for video {video_id}: {e}")
        db.rollback()
        video_service.update_video_status(video_id, "failed")
        raise HTTPException(status_code=500, detail=f"Tracking failed: {str(e)}")


@router.get("/{video_id}/trajectory")
async def get_trajectory(
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get trajectory data for a processed video, returning debug_info and video metadata."""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    trajectory = db.query(Trajectory).filter(Trajectory.video_id == video_id).first()
    if not trajectory:
        raise HTTPException(
            status_code=404,
            detail="Trajectory not found. Video may not be processed yet."
        )

    additional_data = {}
    if hasattr(trajectory, 'additional_data') and trajectory.additional_data:
        try:
            additional_data = trajectory.additional_data if isinstance(trajectory.additional_data, dict) else {}
        except Exception as e:
            logger.warning(f"Failed to parse additional_data: {e}")
            additional_data = {}

    timestamps = trajectory.timestamps or []
    video_duration = max(timestamps) if timestamps else (video.duration or 0)
    video_info = additional_data.get("video_info", {})

    return {
        "video_id": video_id,
        "points": trajectory.points,
        "timestamps": trajectory.timestamps,
        "confidence_score": trajectory.confidence_score,
        "ball_detected": trajectory.ball_detected,
        "video_duration": video_duration,
        # CV Observable Diagnostics & Metadata
        "debug_info": additional_data.get("debug_info", {}),
        "video_info": {
            "fps": video_info.get("fps", 30.0),
            "frame_count": video_info.get("frame_count"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "duration": video_duration
        },
        # Stumps & Players
        "stumps_position": additional_data.get("stumps_position"),
        "bowler_position": additional_data.get("bowler_position"),
        "batter_position": additional_data.get("batter_position"),
        "lbw_analysis": additional_data.get("lbw_analysis", []),
        "pitch_info": additional_data.get("pitch_info"),
        # Hawk-Eye 3D Segmentation and Physics Telemetry
        "pre_bounce_points": additional_data.get("pre_bounce_points"),
        "post_bounce_points": additional_data.get("post_bounce_points"),
        "extrapolated_points": additional_data.get("extrapolated_points"),
        "bounce_point": additional_data.get("bounce_point"),
        "impact_point": additional_data.get("impact_point"),
        "stump_plane_target": additional_data.get("stump_plane_target"),
        "drs_evaluation": additional_data.get("drs_evaluation"),
        "release_speed_kmh": additional_data.get("release_speed_kmh"),
        "bounce_speed_kmh": additional_data.get("bounce_speed_kmh"),
        "release_speed_px_per_sec": additional_data.get("release_speed_px_per_sec"),
        "length_zone": additional_data.get("length_zone")
    }


@router.get("/{video_id}/diagnostics")
async def get_video_diagnostics(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve detailed computer vision pipeline diagnostics, Kalman gap analysis, and landmark metrics."""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    trajectory = db.query(Trajectory).filter(Trajectory.video_id == video_id).first()
    if not trajectory:
        raise HTTPException(status_code=404, detail="Trajectory not found")

    additional_data = trajectory.additional_data if isinstance(trajectory.additional_data, dict) else {}
    debug_info = additional_data.get("debug_info", {})
    video_info = additional_data.get("video_info", {})
    points = trajectory.points or []

    measured = [p for p in points if not p.get("is_predicted", False)]
    predicted = [p for p in points if p.get("is_predicted", False)]
    confidences = [p.get("confidence", 0.0) for p in measured if p.get("confidence") is not None]
    avg_conf = (sum(confidences) / len(confidences)) if confidences else (trajectory.confidence_score or 0.0)

    return {
        "video_id": video_id,
        "filename": video.filename,
        "frames_processed": debug_info.get("frames_processed", len(points)),
        "measured_points": len(measured),
        "predicted_points": len(predicted),
        "total_trajectory_points": len(points),
        "measured_ratio": round(len(measured) / max(1, len(points)), 3),
        "average_confidence": round(float(avg_conf), 3),
        "pitch_detected": debug_info.get("pitch_detected", False),
        "stumps_detected": debug_info.get("stumps_detected", False),
        "video_resolution": f"{video_info.get('width', 1280)}x{video_info.get('height', 720)}",
        "video_fps": video_info.get("fps", 30.0),
        "stumps_landmark": additional_data.get("stumps_position"),
        "pitch_landmarks": additional_data.get("pitch_info"),
        "length_zone": additional_data.get("length_zone"),
        "release_speed_kmh": additional_data.get("release_speed_kmh"),
        "release_speed_px_per_sec": additional_data.get("release_speed_px_per_sec")
    }


@router.get("/{video_id}/stream")
async def stream_video(
    video_id: str,
    token: Optional[str] = Query(None, description="Auth token for HTML5 video tag requests"),
    current_user_opt: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """Stream video media file with authenticated ownership verification.
    Accepts Authorization header OR ?token= query parameter (for HTML5 video player).
    """
    user = current_user_opt
    if not user and token:
        try:
            auth_service = AuthService(db)
            user = auth_service.get_current_user(token)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token for video streaming",
                headers={"WWW-Authenticate": "Bearer"}
            )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for video playback",
            headers={"WWW-Authenticate": "Bearer"}
        )

    video_service = VideoService(db)
    video = video_service.get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    if video.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    if not video.file_path or not os.path.exists(video.file_path):
        raise HTTPException(status_code=404, detail="Video media file missing on disk")

    return FileResponse(
        video.file_path,
        media_type="video/mp4",
        filename=Path(video.file_path).name
    )


@router.delete("/{video_id}")
async def delete_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a video and its associated trajectory with ownership verification"""
    try:
        video_service = VideoService(db)
        video = video_service.get_video(video_id)

        if not video:
            raise HTTPException(status_code=404, detail="Video not found")

        if video.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

        logger.info(f"Deleting video: {video_id} by user: {current_user.id}")

        # Delete trajectory data
        db.query(Trajectory).filter(Trajectory.video_id == video_id).delete()
        db.commit()

        # Delete video file from filesystem
        if video.file_path and os.path.exists(video.file_path):
            try:
                os.remove(video.file_path)
                logger.info(f"Deleted video file: {video.file_path}")
            except Exception as e:
                logger.error(f"Failed to delete video file {video.file_path}: {e}")

        # Delete video record from database
        db.delete(video)
        db.commit()

        logger.info(f"Video deleted successfully: {video_id}")
        return {
            "message": "Video deleted successfully",
            "video_id": video_id
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting video {video_id}: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
