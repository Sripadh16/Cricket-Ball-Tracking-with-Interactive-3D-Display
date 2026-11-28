from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import logging
import time
import uuid

from fastapi import HTTPException
from sqlalchemy import and_, or_, text

from database import SessionLocal
from models.analysis_job import AnalysisJob, MediaDeletion
from models.trajectory import Trajectory
from models.video import Video

logger = logging.getLogger(__name__)
ACTIVE_STATES = ('queued', 'running')
LEASE_SECONDS = 60
WORKER_COUNT = 2
MAX_PENDING_JOBS = 24
MAX_ATTEMPTS = 3


@contextmanager
def analysis_transaction(db):
    """Serialize short queue, publication and video mutation transactions across workers."""
    try:
        if db.get_bind().dialect.name == 'sqlite':
            db.execute(text('BEGIN IMMEDIATE'))
        else:
            db.execute(text('SELECT pg_advisory_xact_lock(38012049)'))
        db.expire_all()
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def enqueue(db, video):
    job = db.get(AnalysisJob, video.id)
    if job and job.state in ACTIVE_STATES:
        raise HTTPException(status_code=409, detail='Video is currently being processed')
    if db.query(AnalysisJob).filter(AnalysisJob.state.in_(ACTIVE_STATES)).count() >= MAX_PENDING_JOBS:
        raise HTTPException(status_code=429, detail='Analysis queue is full. Try again shortly.')
    if not job:
        job = AnalysisJob(video_id=video.id)
        db.add(job)
    job.generation = str(uuid.uuid4())
    job.state = 'queued'
    job.queued_at = time.time()
    job.claim_id = job.lease_until = None
    job.attempts = job.current_frame = job.total_frames = 0
    job.stage = 'Queued for tracking'
    video.status = 'processing'
    video.processing_started_at = datetime.now(timezone.utc)
    return job.generation


@dataclass(frozen=True)
class Claim:
    video_id: str
    file_path: str
    claim_id: str


def _finish(db, job, replacement):
    video = db.get(Video, job.video_id)
    stored = db.query(Trajectory).filter(Trajectory.video_id == job.video_id)
    job.state = 'completed' if replacement is not None else 'failed'
    job.stage = 'Tracking complete' if replacement is not None else 'Tracking failed'
    job.claim_id = job.lease_until = None
    if replacement is not None:
        stored.delete()
        db.add(replacement)
        video.processing_completed_at = datetime.now(timezone.utc)
    video.status = 'processed' if replacement is not None or stored.first() is not None else 'error'


def claim_next():
    with SessionLocal() as db, analysis_transaction(db):
        now = time.time()
        expired = and_(AnalysisJob.state == 'running', AnalysisJob.lease_until <= now)
        for job in db.query(AnalysisJob).filter(expired, AnalysisJob.attempts >= MAX_ATTEMPTS).all():
            _finish(db, job, None)
        active = db.query(AnalysisJob).filter(AnalysisJob.state == 'running', AnalysisJob.lease_until > now).count()
        if active >= WORKER_COUNT:
            return None
        job = db.query(AnalysisJob).filter(or_(AnalysisJob.state == 'queued', expired), AnalysisJob.attempts < MAX_ATTEMPTS).order_by(AnalysisJob.queued_at).first()
        if not job:
            return None
        video = db.get(Video, job.video_id)
        job.state = 'running'
        job.stage = 'Starting analysis'
        job.claim_id = str(uuid.uuid4())
        job.lease_until = now + LEASE_SECONDS
        job.attempts += 1
        job.current_frame = job.total_frames = 0
        return Claim(video.id, video.file_path, job.claim_id)


def renew_claim(claim, **progress):
    # Share the same transaction boundary as claiming and publication, so
    # a late heartbeat cannot revive an expired or replaced lease.
    with SessionLocal() as db, analysis_transaction(db):
        now = time.time()
        updated = db.query(AnalysisJob).filter(
            AnalysisJob.video_id == claim.video_id,
            AnalysisJob.claim_id == claim.claim_id,
            AnalysisJob.state == 'running',
            AnalysisJob.lease_until > now,
        ).update({**progress, 'lease_until': now + LEASE_SECONDS}, synchronize_session=False)
        return updated == 1


def finish_claim(claim, replacement=None):
    with SessionLocal() as db, analysis_transaction(db):
        job = db.get(AnalysisJob, claim.video_id)
        if (job and job.state == 'running' and job.claim_id == claim.claim_id
                and job.lease_until is not None and job.lease_until > time.time()):
            _finish(db, job, replacement)
            return True
        return False


def job_snapshot(video_id):
    with SessionLocal() as db:
        job = db.get(AnalysisJob, video_id)
        return (job.generation, job.state) if job else (None, None)


def drain_media_deletion(video_id=None):
    with SessionLocal() as db, analysis_transaction(db):
        pending = db.query(MediaDeletion).filter(MediaDeletion.retry_at <= time.time())
        deletion = pending.filter_by(video_id=video_id).first() if video_id else pending.order_by(MediaDeletion.retry_at).first()
        if deletion:
            try:
                Path(deletion.path).unlink(missing_ok=True)
            except OSError:
                deletion.retry_at = time.time() + 30
                logger.warning('Will retry deleting video media %s', deletion.video_id)
            else:
                db.delete(deletion)
