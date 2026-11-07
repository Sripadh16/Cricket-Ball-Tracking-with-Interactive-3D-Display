from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from database import get_db
from services.review_service import ReviewService
from services.video_service import VideoService
from api.auth import get_current_user, get_current_user_optional
from models.user import User
from models.review_session import ReviewSession
from pydantic import BaseModel
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

class DecisionModel(BaseModel):
    type: str
    outcome: str
    timestamp: float
    confidence: float

class CreateReviewRequest(BaseModel):
    video_id: str
    decisions: List[DecisionModel]
    notes: Optional[str] = None

@router.get("/")
async def list_reviews(
    video_id: Optional[str] = None,
    current_user: User = Depends(get_current_user_optional),
    db: Session = Depends(get_db)
):
    """List reviews, optionally filtered by video_id."""
    review_service = ReviewService(db)
    if video_id:
        reviews = review_service.get_video_reviews(video_id)
    else:
        user_id = current_user.id if current_user else None
        query = db.query(ReviewSession)
        if user_id:
            query = query.filter(ReviewSession.user_id == user_id)
        reviews = query.all()

    return [
        {
            "id": r.id,
            "video_id": r.video_id,
            "decisions": r.decisions,
            "notes": r.notes,
            "created_at": r.created_at.isoformat() if r.created_at else None
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
    # Verify the video exists and belongs to the authenticated user
    video = VideoService(db).get_video(request.video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    if video.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden: You do not own this video")

    review_service = ReviewService(db)

    try:
        review = review_service.create_review(
            video_id=request.video_id,
            user_id=current_user.id,
            decisions=[(d.model_dump() if hasattr(d, 'model_dump') else d.dict()) for d in request.decisions],
            notes=request.notes
        )

        logger.info(f"Review created: {review.id} for video: {request.video_id} by user: {current_user.id}")

        return {
            "id": review.id,
            "video_id": review.video_id,
            "created_at": review.created_at.isoformat() if review.created_at else None
        }
    except Exception as e:
        logger.error(f"Failed to create review: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create review: {str(e)}")

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
        "created_at": review.created_at.isoformat() if review.created_at else None
    }
