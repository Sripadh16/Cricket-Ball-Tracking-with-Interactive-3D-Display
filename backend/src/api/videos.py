from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Query, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from services.video_service import VideoService, probe_video
from services.ball_tracking_service import BallTrackingService
from services.delivery_tracker import DeliveryTracker
from services.auth_service import AuthService
from models.trajectory import Trajectory
from models.video import Video
from models.analysis_job import AnalysisJob, MediaDeletion
from models.review_session import ReviewSession
from api.auth import get_current_user, get_current_user_optional
from models.user import User
from config import (UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_VIDEO_EXTENSIONS, MAX_PROCESSING_FRAMES,
                    MAX_WORKSPACE_BYTES, MAX_WORKSPACE_CLIPS)
from services.sample_generator import DeliveryPhysicsSimulator
from services.ball_physics_engine import BallPhysicsEngine
from services.pitch_calibration import calibrate_pitch
from services.analysis_jobs import (ACTIVE_STATES, LEASE_SECONDS, analysis_transaction, claim_next,
                                    drain_media_deletion, enqueue, finish_claim, job_snapshot, renew_claim)
from pydantic import BaseModel, Field
from typing import Optional
import uuid
import logging
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter()


def _owned_video(db, video_id, user_id):
    video = VideoService(db).get_video(video_id)
    if video is None:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")
    return video


def _remaining_workspace_bytes(db, user_id):
    clip_count, used = db.query(func.count(Video.id), func.coalesce(func.sum(Video.file_size), 0)).filter(
        Video.user_id == user_id).one()
    if clip_count >= MAX_WORKSPACE_CLIPS or used >= MAX_WORKSPACE_BYTES:
        raise HTTPException(status_code=413, detail="Workspace storage is full. Delete a clip before uploading again.")
    return MAX_WORKSPACE_BYTES - used

# Shared thread pool for CPU-bound OpenCV ball tracking operations
_TRACKING_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tracking_worker")


async def _run_tracking_async(file_path: str, progress_callback=None) -> dict:
    """Run CPU-intensive OpenCV ball tracking in the shared thread pool."""
    loop = asyncio.get_running_loop()
    def _do_track():
        detector = BallTrackingService().yolo_detector
        tracker = DeliveryTracker(yolo=detector, progress_callback=progress_callback, max_frames=MAX_PROCESSING_FRAMES)
        result = tracker.analyse(file_path)
        if result is None:
            raise ValueError("The clip could not be decoded or contains fewer than four frames.")

        scan = result["scan"]
        chain = result.get("chain", [])
        pixel_track = [
            {"t": scan["times"][p["frame"]], "frame_idx": p["frame"], "pixel_x": p["px"],
             "pixel_y": p["py"], "confidence": float(p["conf"])} for p in chain
        ]
        reconstruction = _upload_reconstruction(result)
        points = result.get("points", [])
        return {
            **reconstruction, "points": points, "timestamps": [p["t"] for p in points or pixel_track],
            "geometry_inputs": result.get("geometry_inputs"), "pixel_track": pixel_track,
            "ball_detected": bool(pixel_track),
            "confidence_score": sum(p["confidence"] for p in pixel_track) / len(pixel_track) if pixel_track else 0,
            "tracking_start_s": pixel_track[0]["t"] if pixel_track else None,
            "tracking_end_s": pixel_track[-1]["t"] if pixel_track else None,
            "video_info": {"fps": scan["fps"], "width": scan["W"], "height": scan["H"],
                           "frame_count": scan["frame_count"]},
            "source_duration_s": scan["source_duration_s"], "timing_source": scan["timing_source"],
            "fps_source": scan["fps_source"],
            "debug_info": {"frames_processed": scan["n"], "ball_detections": len(pixel_track),
                           "camera_source": result.get("camera_source"), "fit_rms_px": result.get("fit_rms_px"),
                           "line_sigma_m": result.get("line_sigma_m"),
                           "camera_cut_before_track_end": bool(chain and any(scan["cuts"][1:chain[-1]["frame"] + 1]))},
        }
    return await loop.run_in_executor(_TRACKING_EXECUTOR, _do_track)


def _upload_reconstruction(result: dict, *, manual: bool = False) -> dict:
    """Return measured flight and a gated projection. The tracker cannot verify pad contact."""
    drs = result.get("drs") or {}
    has_fit = result.get("status") == "reconstructed"
    camera_fit = result.get("method") == "camera_ballistic_fit"
    projection = drs.get("wicket_projection") if camera_fit else None
    return {
        "reconstruction_method": "camera_ballistic_fit" if camera_fit else "stump_plane_fit" if has_fit else "2d_track_only",
        "calibration_status": "manual_landmarks" if manual else "auto_camera" if camera_fit else "stump_scaled" if has_fit else "unverified",
        "coordinate_space": "pitch_metric_xyz" if has_fit else "source_pixels",
        "camera": result.get("camera"), "wicket_projection": projection,
        "drs_evaluation": None, "impact_point": None,
        "extrapolated_points": drs.get("extrapolated_points") if projection else None,
        "stump_plane_target": drs.get("stump_plane_target") if projection else None,
        **{key: drs.get(key) for key in ("pre_bounce_points", "post_bounce_points", "bounce_point", "release_speed_kmh",
                                       "bounce_speed_kmh", "release_speed_px_per_sec", "length_zone")},
    }


async def _keep_claim_alive(claim):
    while True:
        await asyncio.sleep(LEASE_SECONDS / 3)
        renew_claim(claim)


async def run_analysis_worker():
    while True:
        try:
            drain_media_deletion()
            claim = claim_next()
            if not claim:
                await asyncio.sleep(1)
                continue
            heartbeat = asyncio.create_task(_keep_claim_alive(claim))
            try:
                def on_progress(current_frame, total_frames, stage="Tracking ball trajectory"):
                    renew_claim(claim, current_frame=current_frame, total_frames=total_frames, stage=stage)

                result = await _run_tracking_async(claim.file_path, on_progress)
                finish_claim(claim, Trajectory(
                    video_id=claim.video_id,
                    points=result.get("points", []),
                    confidence_score=result.get("confidence_score", 0),
                    ball_detected=result.get("ball_detected", False),
                    timestamps=result.get("timestamps", []),
                    additional_data=_build_additional_data(result),
                ))
            except Exception:
                logger.exception("Analysis failed for video %s", claim.video_id)
                finish_claim(claim)
            finally:
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
        except Exception:
            logger.exception("Analysis worker could not access the queue")
            await asyncio.sleep(2)


async def _wait_for_analysis(video_id, generation):
    while True:
        current_generation, state = job_snapshot(video_id)
        if generation != current_generation:
            raise HTTPException(status_code=409, detail="The analysis request changed. Reopen the delivery.")
        if state not in ACTIVE_STATES:
            return state
        await asyncio.sleep(0.2)

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
        "wicket_projection": trajectory_data.get("wicket_projection"),
        "release_speed_kmh": trajectory_data.get("release_speed_kmh"),
        "bounce_speed_kmh": trajectory_data.get("bounce_speed_kmh"),
        "release_speed_px_per_sec": trajectory_data.get("release_speed_px_per_sec"),
        "length_zone": trajectory_data.get("length_zone"),
        "delivery_type": trajectory_data.get("delivery_type"),
        "delivery_name": trajectory_data.get("delivery_name"),
        "air_swing_mm": trajectory_data.get("air_swing_mm"),
        "pitch_deviation_deg": trajectory_data.get("pitch_deviation_deg"),
        "swing_analysis": trajectory_data.get("swing_analysis"),
        "is_no_ball": trajectory_data.get("is_no_ball"),
        "no_ball_reason": trajectory_data.get("no_ball_reason"),
        "is_wide": trajectory_data.get("is_wide"),
        "wide_reason": trajectory_data.get("wide_reason"),
        "speed_loss_pct": trajectory_data.get("speed_loss_pct"),
        "timing_source": trajectory_data.get("timing_source"),
        "fps_source": trajectory_data.get("fps_source"),
        "reconstruction_method": trajectory_data.get("reconstruction_method"),
        "calibration_status": trajectory_data.get("calibration_status"),
        "coordinate_space": trajectory_data.get("coordinate_space"),
        "tracking_start_s": trajectory_data.get("tracking_start_s"),
        "tracking_end_s": trajectory_data.get("tracking_end_s"),
        "source_duration_s": trajectory_data.get("source_duration_s"),
        "pixel_track": trajectory_data.get("pixel_track"),
        "camera": trajectory_data.get("camera"),
        "geometry_inputs": trajectory_data.get("geometry_inputs"),
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
    known = {preset["id"] for preset in DeliveryPhysicsSimulator.get_all_preset_deliveries()}
    if delivery_type not in known:
        raise HTTPException(status_code=404, detail=f"Unknown preset delivery '{delivery_type}'")
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
        # One query for every row's detection flag (the dashboard labels "No ball detected").
        detected = dict(
            db.query(Trajectory.video_id, Trajectory.ball_detected)
            .filter(Trajectory.video_id.in_([video.id for video in videos]))
            .all()
        ) if videos else {}

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
                    "file_size": video.file_size,
                    "ball_detected": detected.get(video.id),
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
    sync: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload a video file for ball tracking analysis with authenticated ownership.
    Streams upload in 1 MB chunks to reject oversized files without buffering in RAM.
    """
    safe_name = Path((file.filename or "upload").replace("\\", "/")).name
    file_ext = Path(safe_name).suffix.lower()
    if file_ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{file_ext}'. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}"
        )

    remaining_bytes = _remaining_workspace_bytes(db, current_user.id)

    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}{file_ext}"
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
                    raise HTTPException(
                        status_code=400,
                        detail=f"File too large. Maximum size: {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB"
                    )
                if file_size > remaining_bytes:
                    raise HTTPException(status_code=413, detail="This clip exceeds the remaining workspace storage.")
                out.write(chunk)
        logger.info("Stored upload %s (%s bytes) for user %s", file_id, file_size, current_user.id)
    except HTTPException:
        file_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass
        logger.error(f"Failed to save video file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save video file")

    try:
        duration, resolution = await asyncio.to_thread(probe_video, str(file_path))
    except ValueError as exc:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        file_path.unlink(missing_ok=True)
        raise

    try:
        with analysis_transaction(db):
            if file_size > _remaining_workspace_bytes(db, current_user.id):
                raise HTTPException(status_code=413, detail="This clip exceeds the remaining workspace storage.")
            video = Video(user_id=current_user.id, filename=safe_name[:255], file_path=str(file_path),
                          file_size=file_size, duration=duration, resolution=resolution)
            db.add(video)
            db.flush()
            generation = enqueue(db, video)
    except Exception:
        file_path.unlink(missing_ok=True)
        raise

    if sync:
        await _wait_for_analysis(video.id, generation)
        db.refresh(video)
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    video = _owned_video(db, video_id, current_user.id)
    job = db.get(AnalysisJob, video_id)
    current = job.current_frame if job else 0
    total = job.total_frames if job else 0
    progress = 100 if video.status == "processed" else min(99, int(current / max(1, total) * 100))
    return {
        "video_id": video_id, "status": video.status, "progress": progress,
        "current_frame": current, "total_frames": total,
        "stage": job.stage if job else video.status.capitalize(),
        "job_state": job.state if job else None,
        "has_previous_result": db.query(Trajectory.id).filter_by(video_id=video_id).first() is not None,
    }


@router.post("/{video_id}/reprocess")
@router.post("/{video_id}/track")
async def track_video(
    video_id: str,
    request: Request,
    sync: bool = True,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reprocess = request.url.path.endswith("/reprocess")
    with analysis_transaction(db):
        video = _owned_video(db, video_id, current_user.id)
        if video.status == "processed" and not reprocess:
            return {"video_id": video_id, "status": video.status,
                    "message": "Video already processed. Retrieve trajectory using /trajectory endpoint"}
        generation = enqueue(db, video)

    if not sync:
        return {"video_id": video_id, "status": "processing"}
    if await _wait_for_analysis(video_id, generation) != 'completed':
        raise HTTPException(status_code=500, detail="Tracking failed. Try reprocessing or upload a clearer clip.")
    result = db.query(Trajectory).filter(Trajectory.video_id == video_id).one()
    if reprocess:
        return {"message": "Video reprocessed successfully", "video_id": video_id,
                "ball_detected": result.ball_detected,
                "points_detected": len((result.additional_data or {}).get("pixel_track") or result.points or [])}
    return {"video_id": video_id, "status": "processed", "ball_detected": result.ball_detected,
            "confidence_score": result.confidence_score, "processing_time": 0}

class PitchCalibrationRequest(BaseModel):
    corners: list[tuple[float, float]] = Field(min_length=4, max_length=4)


@router.put("/{video_id}/calibration")
async def correct_pitch_calibration(video_id: str, payload: PitchCalibrationRequest,
                                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    video = _owned_video(db, video_id, current_user.id)
    if video.status != "processed":
        raise HTTPException(status_code=409, detail="Wait for video processing to complete before correcting landmarks.")
    trajectory = db.query(Trajectory).filter(Trajectory.video_id == video_id).first()
    if not trajectory:
        raise HTTPException(status_code=404, detail="Process this video before correcting landmarks.")
    data = dict(trajectory.additional_data or {})
    trajectory_id = trajectory.id
    previous_calibration = data.get("calibration")
    info = data.get("video_info") or {}
    inputs = data.get("geometry_inputs")
    if inputs:
        if data.get("debug_info", {}).get("camera_cut_before_track_end"):
            raise HTTPException(status_code=422, detail="Use an uncut clip so the first-frame landmarks match the tracked delivery.")
        # Full re-solve: the clicked pitch corners join the stumps/pitch edges in the camera solve,
        # and the ball flight is refitted through the corrected camera.
        corners = [[float(v) for v in pair] for pair in payload.corners]
        try:
            calibrate_pitch([], corners, info.get("width"), info.get("height"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        rebuilt = await asyncio.get_running_loop().run_in_executor(
            _TRACKING_EXECUTOR, lambda: DeliveryTracker.reconstruct(inputs, corners=corners))
        if rebuilt is None:
            raise HTTPException(status_code=422, detail="These landmarks do not give a consistent camera for the tracked ball. Check the corner order and positions.")
        points = rebuilt["points"]
        data.update(_upload_reconstruction(rebuilt, manual=True))
        calibration = {"corners": corners, "status": "manual_landmarks", "camera": rebuilt["camera"]}
        data["calibration"] = calibration
    else:
        try:
            points, calibration = calibrate_pitch(trajectory.points or [], payload.corners, info.get("width"), info.get("height"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        # Old inferred event geometry cannot survive a changed projection.
        for key in ("pre_bounce_points", "post_bounce_points", "extrapolated_points", "bounce_point",
                    "impact_point", "stump_plane_target", "drs_evaluation", "release_speed_kmh", "bounce_speed_kmh", "length_zone"):
            data[key] = None
        data.update(calibration=calibration, calibration_status="manual_pitch_plane",
                    reconstruction_method="manual_plane_heuristic_height")

    with analysis_transaction(db):
        video = _owned_video(db, video_id, current_user.id)
        trajectory = db.query(Trajectory).filter(Trajectory.id == trajectory_id).first()
        if (video.status != "processed" or trajectory is None
                or (trajectory.additional_data or {}).get("calibration") != previous_calibration):
            raise HTTPException(status_code=409, detail="Analysis changed before calibration could be saved. Refresh and try again.")
        trajectory.points = points
        if inputs:
            trajectory.timestamps = [p["t"] for p in points]
        trajectory.additional_data = data
    return calibration


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

    # Detection coverage must never masquerade as the source duration.
    source_duration_s = additional_data.get("source_duration_s")
    if source_duration_s and isinstance(source_duration_s, (int, float)) and source_duration_s > 0:
        video_duration = float(source_duration_s)
    elif video.duration and video.duration > 0:
        video_duration = float(video.duration)
    else:
        video_duration = None  # Browser metadata remains authoritative; tracking length is not source duration.
    tracking_start_s = additional_data.get("tracking_start_s")
    tracking_end_s = additional_data.get("tracking_end_s")
    video_info = additional_data.get("video_info", {})
    method = additional_data.get("reconstruction_method", "legacy_unknown")
    has_fit = method in ("camera_ballistic_fit", "stump_plane_fit")
    projection = additional_data.get("wicket_projection") if has_fit else None

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
            "fps": video_info.get("fps"),
            "frame_count": video_info.get("frame_count"),
            "width": video_info.get("width"),
            "height": video_info.get("height"),
            "duration": video_duration
        },
        # Stumps & Players
        "stumps_position": additional_data.get("stumps_position"),
        "bowler_position": additional_data.get("bowler_position"),
        "batter_position": additional_data.get("batter_position"),
        "lbw_analysis": [],
        "pitch_info": additional_data.get("pitch_info"),
        # Hawk-Eye 3D Segmentation and Physics Telemetry
        "pre_bounce_points": additional_data.get("pre_bounce_points") if has_fit else None,
        "post_bounce_points": additional_data.get("post_bounce_points") if has_fit else None,
        "extrapolated_points": additional_data.get("extrapolated_points") if projection else None,
        "bounce_point": additional_data.get("bounce_point") if has_fit else None,
        "impact_point": None,
        "stump_plane_target": additional_data.get("stump_plane_target") if projection else None,
        "drs_evaluation": None,
        "wicket_projection": projection,
        "release_speed_kmh": additional_data.get("release_speed_kmh") if has_fit else None,
        "bounce_speed_kmh": additional_data.get("bounce_speed_kmh") if has_fit else None,
        "release_speed_px_per_sec": additional_data.get("release_speed_px_per_sec"),
        "length_zone": additional_data.get("length_zone") if has_fit else None,
        "tracking_start_s": tracking_start_s,
        "tracking_end_s": tracking_end_s,
        "timing_source": additional_data.get("timing_source"),
        "coordinate_space": additional_data.get("coordinate_space"),
        "fps_source": additional_data.get("fps_source"),
        "reconstruction_method": method,
        "calibration_status": additional_data.get("calibration_status", "unverified"),
        "calibration": additional_data.get("calibration"),
        "can_refit_camera": bool(additional_data.get("geometry_inputs")) and not additional_data.get("debug_info", {}).get("camera_cut_before_track_end"),
        "pixel_track": additional_data.get("pixel_track"),
        "camera": additional_data.get("camera"),
        "delivery_name": additional_data.get("delivery_name"),
        "delivery_type": additional_data.get("delivery_type"),
        "air_swing_mm": additional_data.get("air_swing_mm"),
        "pitch_deviation_deg": additional_data.get("pitch_deviation_deg"),
        "swing_analysis": additional_data.get("swing_analysis"),
        "is_no_ball": additional_data.get("is_no_ball"),
        "no_ball_reason": additional_data.get("no_ball_reason"),
        "is_wide": additional_data.get("is_wide"),
        "wide_reason": additional_data.get("wide_reason"),
        "speed_loss_pct": additional_data.get("speed_loss_pct"),
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
    points = trajectory.points or additional_data.get("pixel_track") or []

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


@router.post("/{video_id}/playback")
async def issue_playback_ticket(
    video_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    video = VideoService(db).get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")
    ticket = AuthService(db).create_media_ticket(current_user.id, video.id)
    response.headers["Cache-Control"] = "private, no-store"
    return {"stream_url": f"/videos/{video.id}/stream?ticket={ticket}"}


@router.api_route("/{video_id}/stream", methods=["GET", "HEAD"])
async def stream_video(
    video_id: str,
    ticket: Optional[str] = Query(None, max_length=2048),
    current_user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    """Serve private media with standard Range and HEAD responses."""
    if current_user is not None:
        owner_id = current_user.id
    elif ticket:
        owner_id = AuthService(db).media_ticket_owner(ticket, video_id)
    else:
        raise HTTPException(status_code=401, detail="Authentication required for video playback")

    video = VideoService(db).get_video(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.user_id != owner_id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")
    if not video.file_path or not Path(video.file_path).is_file():
        raise HTTPException(status_code=404, detail="Video media file missing on disk")

    return FileResponse(video.file_path, headers={
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    })

@router.delete("/{video_id}")
async def delete_video(
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with analysis_transaction(db):
        video = _owned_video(db, video_id, current_user.id)
        job = db.get(AnalysisJob, video_id)
        if job and job.state in ACTIVE_STATES:
            raise HTTPException(status_code=409, detail="Wait for analysis to complete before deleting this clip.")
        db.query(ReviewSession).filter_by(video_id=video_id).delete()
        db.query(Trajectory).filter_by(video_id=video_id).delete()
        db.query(AnalysisJob).filter_by(video_id=video_id).delete()
        if video.file_path:
            db.add(MediaDeletion(video_id=video_id, path=video.file_path))
        db.delete(video)
    try:
        drain_media_deletion(video_id)
    except Exception:
        logger.exception("Media deletion will be retried for video %s", video_id)
    return {"message": "Video deleted successfully", "video_id": video_id}
