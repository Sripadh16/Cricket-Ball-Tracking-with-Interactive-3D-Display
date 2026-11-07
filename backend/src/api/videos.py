from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, BackgroundTasks, Query
from sqlalchemy.orm import Session
from database import get_db, SessionLocal
from services.video_service import VideoService
from services.ball_tracking_service import BallTrackingService
from models.trajectory import Trajectory
from api.auth import get_current_user_optional
from models.user import User
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_VIDEO_EXTENSIONS
from services.sample_generator import DeliveryPhysicsSimulator
from services.ball_physics_engine import BallPhysicsEngine
from typing import Optional
import uuid
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter()



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
        "length_zone": trajectory_data.get("length_zone"),
    }


@router.get("/presets")
async def get_preset_deliveries():
    """Return all available physical preset deliveries and pitch surface profiles for interactive demo"""
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
    """Generate and return full 3D physics trajectory & DRS data with Magnus aerodynamics and pitch restitution"""
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


@router.get("/")
async def list_videos(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional)
):
    """List all videos for the current user (or all if not authenticated)"""
    try:
        video_service = VideoService(db)
        user_id = current_user.id if current_user else None
        videos = video_service.list_videos(user_id=user_id)
        
        return {
            "videos": [
                {
                    "id": video.id,
                    "filename": Path(video.file_path).name if video.file_path else video.filename,  # Use pathlib for cross-platform path handling
                    "original_filename": video.filename,
                    # file_path not returned to clients for security
                    "status": video.status,
                    "created_at": video.upload_date.isoformat() if video.upload_date else None,
                    "processed_at": video.processing_completed_at.isoformat() if video.processing_completed_at else None,
                    "duration": video.duration,
                    "fps": None,  # FPS not stored in Video model
                    "width": None,  # Width/height not stored separately
                    "height": None,
                    "file_size": video.file_size
                }
                for video in videos
            ]
        }
    except Exception as e:
        logger.error(f"Error listing videos: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    sync: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional)
):
    """Upload a video file for ball tracking analysis.
    Supports asynchronous background processing via background_tasks and progress polling.
    """
    # Validate file extension before reading any bytes
    safe_name = Path(file.filename or "upload").name  # strip any path component
    file_ext = Path(safe_name).suffix.lower()
    if file_ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file_ext}'. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        )

    # Stream upload enforcing byte limit so large files are rejected without
    # buffering the whole payload in RAM.
    file_id = str(uuid.uuid4())
    # Use only the sanitized basename in the stored filename to prevent path traversal
    file_path = UPLOAD_DIR / f"{file_id}_{safe_name}"
    CHUNK = 1024 * 1024  # 1 MB chunks

    try:
        file_size = 0
        with open(file_path, "wb") as out:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_SIZE_BYTES:
                    # Clean up partial file before rejecting
                    out.close()
                    file_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB"
                    )
                out.write(chunk)
        logger.info(f"Video uploaded: {file_path} ({file_size:,} bytes)")
    except HTTPException:
        raise
    except Exception as e:
        # Clean up any partial file
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        logger.error(f"Failed to save video file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save video file")

    # Create video record
    video_service = VideoService(db)
    user_id = current_user.id if current_user else "anonymous"

    video = video_service.create_video(
        user_id=user_id,
        filename=file.filename,
        file_path=str(file_path),
        file_size=file_size
    )

    # Start ball tracking (Background task or Synchronous fallback)
    logger.info(f"Initiating ball tracking for video: {video.id} (sync={sync})")
    video_service.update_video_status(video.id, "processing")
    video_progress[video.id] = {
        "progress": 0,
        "current_frame": 0,
        "total_frames": 0,
        "status": "processing",
        "stage": "Queued for tracking"
    }

    if not sync and background_tasks is not None:
        background_tasks.add_task(process_video_background, video.id, str(file_path))
    else:
        # Run synchronous processing
        try:
            process_video_background(video.id, str(file_path))
            video = video_service.get_video(video.id)
        except Exception as e:
            logger.error(f"Synchronous tracking failed for video {video.id}: {e}")
            video_service.update_video_status(video.id, "error")

    return {
        "id": video.id,
        "filename": file_path.name,   # Stored UUID filename for playback URL
        "original_filename": video.filename,
        # file_path not returned to clients for security
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
    current_user: User = Depends(get_current_user_optional)
):
    """Reprocess video - delete existing trajectory and retrack"""
    try:
        video_service = VideoService(db)
        video = video_service.get_video(video_id)
        
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        
        logger.info(f"Reprocessing video: {video_id}")
        
        # 2. Set status to 'processing' (old trajectory still intact)
        video_service.update_video_status(video_id, "processing")
        
        # 3. Run tracking FIRST - before touching existing trajectory
        tracking_service = BallTrackingService()
        trajectory_data = tracking_service.track_ball(video.file_path)
        
        # 4. Tracking succeeded - now safe to replace old trajectory
        db.query(Trajectory).filter(Trajectory.video_id == video_id).delete()
        db.commit()

        # Save new trajectory using consistent helper
        additional_data = _build_additional_data(trajectory_data)

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
        
        # Update video status to processed
        video_service.update_video_status(video_id, "processed")
        
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
        # 5. Tracking failed - restore 'processed' status so old trajectory is still accessible
        video_service.update_video_status(video_id, "processed")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{video_id}/track")
async def track_video(
    video_id: str,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """Start ball tracking analysis on a video"""
    video_service = VideoService(db)
    video = video_service.get_video(video_id)

    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Check if tracking is already in progress
    if video.status == "processing":
        raise HTTPException(status_code=409, detail="Tracking already in progress")

    # Check if already processed
    if video.status == "processed":
        return {
            "video_id": video_id,
            "status": "processed",
            "message": "Video already processed. Retrieve trajectory using /trajectory endpoint"
        }

    # Update status to processing
    video_service.update_video_status(video_id, "processing")
    logger.info(f"Starting ball tracking for video: {video_id}")

    try:
        # Start tracking
        tracking_service = BallTrackingService()
        trajectory_data = tracking_service.track_ball(video.file_path)

        # Save trajectory
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

        # Update video status
        video_service.update_video_status(video_id, "processed")
        logger.info(f"Ball tracking completed for video: {video_id}")

        return {
            "video_id": video_id,
            "status": "processed",
            "ball_detected": trajectory_data["ball_detected"],
            "confidence_score": trajectory_data["confidence_score"],
            "processing_time": trajectory_data.get("processing_time", 0)
        }

    except Exception as e:
        logger.error(f"Ball tracking failed for video {video_id}: {e}")
        video_service.update_video_status(video_id, "failed")
        raise HTTPException(status_code=500, detail=f"Tracking failed: {str(e)}")

@router.get("/{video_id}/trajectory")
async def get_trajectory(
    video_id: str,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """Get trajectory data for a processed video"""
    trajectory = db.query(Trajectory).filter(Trajectory.video_id == video_id).first()

    if not trajectory:
        raise HTTPException(
            status_code=404,
            detail="Trajectory not found. Video may not be processed yet."
        )

    # Parse additional data
    additional_data = {}
    if hasattr(trajectory, 'additional_data') and trajectory.additional_data:
        try:
            additional_data = trajectory.additional_data if isinstance(trajectory.additional_data, dict) else {}
        except Exception as e:
            logger.warning(f"Failed to parse additional_data: {e}")
            additional_data = {}

    # Calculate video duration from timestamps
    timestamps = trajectory.timestamps or []
    video_duration = max(timestamps) if timestamps else 0

    return {
        "video_id": video_id,
        "points": trajectory.points,
        "timestamps": trajectory.timestamps,
        "confidence_score": trajectory.confidence_score,
        "ball_detected": trajectory.ball_detected,
        "video_duration": video_duration,
        # Additional DRS data
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
        "length_zone": additional_data.get("length_zone")
    }

@router.delete("/{video_id}")
async def delete_video(
    video_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional)
):
    """Delete a video and its associated data"""
    try:
        video_service = VideoService(db)
        video = video_service.get_video(video_id)
        
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        
        logger.info(f"Deleting video: {video_id}")
        
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
        raise HTTPException(status_code=500, detail=str(e))
