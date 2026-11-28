from sqlalchemy import Column, Float, ForeignKey, Integer, String

from database import Base


class AnalysisJob(Base):
    __tablename__ = 'analysis_jobs'

    video_id = Column(String, ForeignKey('videos.id'), primary_key=True)
    generation = Column(String, nullable=False)
    state = Column(String(16), nullable=False, index=True)
    queued_at = Column(Float, nullable=False)
    claim_id = Column(String)
    lease_until = Column(Float)
    attempts = Column(Integer, nullable=False, default=0)
    current_frame = Column(Integer, nullable=False, default=0)
    total_frames = Column(Integer, nullable=False, default=0)
    stage = Column(String(80), nullable=False, default='Queued for tracking')


class MediaDeletion(Base):
    __tablename__ = 'media_deletions'

    video_id = Column(String, primary_key=True)
    path = Column(String(500), nullable=False)
    retry_at = Column(Float, nullable=False, default=0)
