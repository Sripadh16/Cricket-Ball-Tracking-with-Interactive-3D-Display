from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from services.video_service import VideoService
from services.ball_tracking_service import BallTrackingService
from models.trajectory import Trajectory
from api.auth import get_current_user_optional
from models.user import User
from config import UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_VIDEO_EXTENSIONS
from services.sample_generator import DeliveryPhysicsSimulator
import uuid
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get("/presets")
async def get_preset_deliveries():
    """Return all available physical preset deliveries for interactive demo"""
    return {
        "presets": DeliveryPhysicsSimulator.get_all_preset_deliveries()
    }

@router.get("/presets/{delivery_type}")
async def get_preset_delivery_trajectory(delivery_type: str):
    """Generate and return full 3D physics trajectory & DRS data for a preset delivery"""
    try:
        data = DeliveryPhysicsSimulator.generate_delivery(delivery_type=delivery_type)
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
                    "filename": video.file_path.split('/')[-1] if video.file_path else video.filename,  # Extract filename from path (UUID-prefixed)
                    "original_filename": video.filename,
                    "file_path": video.file_path,
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_optional)
):
    """Upload a video file for ball tracking analysis"""
    # Validate file type
    file_ext = file.filename.lower()[file.filename.rfind('.'):] if '.' in file.filename else ''
    if file_ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        )

    # Read and validate file size
    content = await file.read()
    file_size = len(content)

    if file_size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size: {MAX_UPLOAD_SIZE_BYTES / (1024*1024):.0f}MB"
        )

    # Save file with unique ID
    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}_{file.filename}"

    try:
        with open(file_path, "wb") as f:
            f.write(content)
        logger.info(f"Video uploaded: {file_path}")
    except Exception as e:
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

    # Immediately start ball tracking after upload
    logger.info(f"Starting automatic ball tracking for video: {video.id}")
    video_service.update_video_status(video.id, "processing")
    
    try:
        tracking_service = BallTrackingService()
        trajectory_data = tracking_service.track_ball(str(file_path))
        
        # Save trajectory
        additional_data = {
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
            "length_zone": trajectory_data.get("length_zone")
        }

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
        
        # Update video status to processed
        video_service.update_video_status(video.id, "processed")
        logger.info(f"Video processed successfully: {video.id}")
        
    except Exception as e:
        logger.error(f"Error processing video {video.id}: {e}")
        video_service.update_video_status(video.id, "error")

    return {
        "id": video.id,
        "filename": file_path.name,  # Return stored filename with UUID for playback
        "original_filename": video.filename,
        "file_path": video.file_path,
        "status": video.status,
        "upload_date": video.upload_date.isoformat() if video.upload_date else None,
        "file_size": video.file_size
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
        
        # Delete existing trajectory
        db.query(Trajectory).filter(Trajectory.video_id == video_id).delete()
        db.commit()
        
        # Reset video status
        video_service.update_video_status(video_id, "uploaded")
        
        # Start tracking again
        tracking_service = BallTrackingService()
        trajectory_data = tracking_service.track_ball(video.file_path)
        
        # Save new trajectory
        additional_data = {
            "stumps_position": trajectory_data.get("stumps_position"),
            "bowler_position": trajectory_data.get("bowler_position"),
            "batter_position": trajectory_data.get("batter_position"),
            "lbw_analysis": trajectory_data.get("lbw_analysis", []),
            "debug_info": trajectory_data.get("debug_info", {}),
            "pitch_info": trajectory_data.get("pitch_info")
        }

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
        
        # Update video status
        video_service.update_video_status(video_id, "processed")
        
        logger.info(f"Video reprocessed successfully: {video_id}")
        
        return {
            "message": "Video reprocessed successfully",
            "video_id": video_id,
            "ball_detected": trajectory_data.get('ball_detected', False),
            "points_detected": len(trajectory_data.get('ball_trajectory', []))
        }
        
    except Exception as e:
        logger.error(f"Error reprocessing video {video_id}: {e}")
        video_service.update_video_status(video_id, "error")
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
        additional_data = {
            "stumps_position": trajectory_data.get("stumps_position"),
            "bowler_position": trajectory_data.get("bowler_position"),
            "batter_position": trajectory_data.get("batter_position"),
            "lbw_analysis": trajectory_data.get("lbw_analysis", []),
            "debug_info": trajectory_data.get("debug_info", {}),
            "pitch_info": trajectory_data.get("pitch_info")
        }

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
