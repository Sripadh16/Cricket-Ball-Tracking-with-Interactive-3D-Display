from sqlalchemy.orm import Session
from models.video import Video
import uuid
from typing import Optional
import logging
from datetime import datetime
import math
import cv2

from config import MAX_CLIP_DURATION_S, MAX_CLIP_PIXELS

logger = logging.getLogger(__name__)


def probe_video(file_path: str):
    """Reject unusable source media before creating a video or analysis job."""
    capture = cv2.VideoCapture(file_path)
    try:
        if not capture.isOpened():
            raise ValueError('Cannot decode this clip. Try a short MP4 (H.264) or WebM.')
        width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
        fps = capture.get(cv2.CAP_PROP_FPS)
        frames = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        if width * height > MAX_CLIP_PIXELS:
            raise ValueError('Clip resolution exceeds the 4K pixel limit.')
        # In-browser recordings may omit duration. The tracker still caps how many frames it decodes.
        duration = frames / fps if math.isfinite(frames) and 0 < frames < 10**7 and math.isfinite(fps) and fps > 0 else None
        if duration is not None and duration > MAX_CLIP_DURATION_S:
            raise ValueError(f'Trim the clip to {MAX_CLIP_DURATION_S} seconds or less before uploading.')
        frame_ok, frame = capture.read()
        if not frame_ok or frame is None:
            raise ValueError('Cannot read video frames. Try a short MP4 (H.264) or WebM.')
        height, width = frame.shape[:2]
        if width * height > MAX_CLIP_PIXELS:
            raise ValueError('Clip resolution exceeds the 4K pixel limit.')
        return duration, f'{width}x{height}'
    except cv2.error as exc:
        raise ValueError('Cannot decode this clip. Try MP4 (H.264) or WebM.') from exc
    finally:
        capture.release()

class VideoService:
    def __init__(self, db: Session):
        self.db = db

    def create_video(self, user_id: str, filename: str, file_path: str,
                    duration: Optional[float] = None, resolution: Optional[str] = None,
                    file_size: Optional[int] = None) -> Video:
        logger.info("Creating video record for user %s", user_id)
        video = Video(
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            duration=duration,
            resolution=resolution,
            file_size=file_size
        )
        self.db.add(video)
        self.db.commit()
        self.db.refresh(video)
        logger.info(f"Video created with ID: {video.id}")
        return video

    def get_video(self, video_id: str) -> Optional[Video]:
        logger.debug(f"Retrieving video: {video_id}")
        return self.db.query(Video).filter(Video.id == video_id).first()

    def update_video_status(self, video_id: str, status: str):
        logger.info(f"Updating video {video_id} status to: {status}")
        video = self.get_video(video_id)
        if video:
            video.status = status
            if status == "processing":
                video.processing_started_at = datetime.utcnow()
            elif status == "processed":
                video.processing_completed_at = datetime.utcnow()
            self.db.commit()
            logger.info(f"Video {video_id} status updated successfully")
        else:
            logger.warning(f"Video {video_id} not found for status update")

    def get_user_videos(self, user_id: uuid.UUID):
        return self.db.query(Video).filter(Video.user_id == user_id).all()
    
    def list_videos(self, user_id: Optional[str] = None, limit: int = 100):
        """List all videos, optionally filtered by user_id"""
        query = self.db.query(Video)
        if user_id:
            query = query.filter(Video.user_id == user_id)
        return query.order_by(Video.upload_date.desc()).limit(limit).all()
