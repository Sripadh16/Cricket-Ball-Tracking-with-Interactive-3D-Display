from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from services.review_service import ReviewService
from services.analysis_jobs import analysis_transaction
from services.video_service import VideoService
from api.auth import get_current_user, get_current_user_optional
from models.user import User
from models.review_session import ReviewSession
from models.trajectory import Trajectory
from pydantic import BaseModel
from typing import List, Optional
import logging
from datetime import timezone

logger = logging.getLogger(__name__)
router = APIRouter()


def _review_date(review):
    value = review.created_at
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()

class DecisionModel(BaseModel):
    type: str
    outcome: str
    timestamp: float
    confidence: Optional[float] = None

class CreateReviewRequest(BaseModel):
    video_id: str
    decisions: List[DecisionModel]
    notes: Optional[str] = None
    analysis_revision: Optional[str] = None

@router.get("/")
async def list_reviews(
    video_id: Optional[str] = None,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """List reviews, optionally filtered by video_id."""
    # Reviews are private: anonymous callers see nothing and users only see their own.
    if not current_user:
        return []
    query = db.query(ReviewSession).filter(ReviewSession.user_id == current_user.id)
    if video_id:
        query = query.filter(ReviewSession.video_id == video_id)
    reviews = query.order_by(ReviewSession.created_at.desc(), ReviewSession.id.desc()).all()

    return [
        {
            "id": r.id,
            "video_id": r.video_id,
            "decisions": r.decisions,
            "notes": r.notes,
            "analysis_revision": r.analysis_revision,
            "created_at": _review_date(r),
        }
        for r in reviews
    ]

@router.post("/")
async def create_review(
    request: CreateReviewRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new review for a video with authenticated ownership verification"""
    with analysis_transaction(db):
        video = VideoService(db).get_video(request.video_id)
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        if video.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")
        if request.analysis_revision is not None:
            trajectory = db.query(Trajectory).filter_by(video_id=video.id).first()
            if trajectory is None or trajectory.revision != request.analysis_revision:
                raise HTTPException(status_code=409, detail="The analysis changed. Reopen the delivery before saving this assessment.")

        review = ReviewService(db).create_review(
            video_id=request.video_id,
            user_id=current_user.id,
            decisions=[decision.model_dump() for decision in request.decisions],
            notes=request.notes,
            analysis_revision=request.analysis_revision,
        )

        logger.info(f"Review created: {review.id} for video: {request.video_id} by user: {current_user.id}")

        return {
            "id": review.id,
            "video_id": review.video_id,
            "created_at": _review_date(review),
        }

@router.get("/{review_id}")
async def get_review(
    review_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a review by ID with ownership check"""
    review_service = ReviewService(db)
    review = review_service.get_review(review_id)

    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    if review.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this review")

    return {
        "id": review.id,
        "video_id": review.video_id,
        "decisions": review.decisions,
        "notes": review.notes,
        "analysis_revision": review.analysis_revision,
        "created_at": _review_date(review),
    }
