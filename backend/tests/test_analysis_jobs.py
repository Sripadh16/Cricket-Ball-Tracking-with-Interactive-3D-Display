from pathlib import Path
import sys
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))

from models.analysis_job import AnalysisJob, MediaDeletion
from models.trajectory import Trajectory
from models.video import Video
from schema import upgrade_database
from services import analysis_jobs as jobs


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    engine = create_engine(f'sqlite:///{tmp_path / "queue.db"}')
    upgrade_database(engine)
    sessions = sessionmaker(bind=engine)
    monkeypatch.setattr(jobs, 'SessionLocal', sessions)
    yield sessions
    engine.dispose()


def test_queue_recovers_expired_claim_and_rejects_stale_publication(sessions):
    with sessions() as db, jobs.analysis_transaction(db):
        video = Video(id='clip', user_id='owner', filename='clip.webm', file_path='clip.webm')
        db.add(video)
        db.flush()
        generation = jobs.enqueue(db, video)

    first = jobs.claim_next()
    assert jobs.claim_next() is None
    with sessions() as db, jobs.analysis_transaction(db):
        with pytest.raises(HTTPException, match='currently being processed'):
            jobs.enqueue(db, db.get(Video, 'clip'))
        db.get(AnalysisJob, 'clip').lease_until = time.time() - 1

    recovered = jobs.claim_next()
    assert recovered.video_id == first.video_id
    assert recovered.claim_id != first.claim_id
    jobs.finish_claim(first, Trajectory(video_id='clip', points=[{'t': 1}]))
    assert jobs.job_snapshot('clip') == (generation, 'running')
    jobs.finish_claim(recovered, Trajectory(video_id='clip', points=[{'t': 2}]))
    assert jobs.job_snapshot('clip') == (generation, 'completed')
    with sessions() as db:
        assert db.query(Trajectory).one().points == [{'t': 2}]
        assert db.get(Video, 'clip').status == 'processed'


def test_media_deletion_can_resume_after_a_locked_file(sessions, tmp_path, monkeypatch):
    media = tmp_path / 'clip.webm'
    media.write_bytes(b'video')
    with sessions.begin() as db:
        db.add(MediaDeletion(video_id='clip', path=str(media)))

    with monkeypatch.context() as patcher:
        def locked(path, **_):
            raise PermissionError(path)
        patcher.setattr(Path, 'unlink', locked)
        jobs.drain_media_deletion('clip')
    with sessions.begin() as db:
        deletion = db.get(MediaDeletion, 'clip')
        assert deletion.retry_at > time.time()
        deletion.retry_at = 0

    jobs.drain_media_deletion('clip')
    jobs.drain_media_deletion('clip')
    assert not media.exists()
    with sessions() as db:
        assert db.get(MediaDeletion, 'clip') is None

def _enqueue_clip(sessions, clip_id):
    with sessions() as db, jobs.analysis_transaction(db):
        video = Video(id=clip_id, user_id='owner', filename=f'{clip_id}.webm', file_path=f'{clip_id}.webm')
        db.add(video)
        db.flush()
        return jobs.enqueue(db, video)


def test_expired_claim_cannot_renew_or_publish_before_recovery(sessions):
    generation = _enqueue_clip(sessions, 'clip')
    old = jobs.claim_next()
    with sessions() as db, jobs.analysis_transaction(db):
        db.get(AnalysisJob, 'clip').lease_until = time.time() - 1

    assert jobs.renew_claim(old, current_frame=5) is False
    assert jobs.finish_claim(old, Trajectory(video_id='clip', points=[{'t': 99}])) is False
    with sessions() as db:
        assert db.query(Trajectory).count() == 0
    recovered = jobs.claim_next()
    assert recovered.claim_id != old.claim_id
    assert jobs.finish_claim(recovered, Trajectory(video_id='clip', points=[{'t': 2}])) is True
    assert jobs.job_snapshot('clip') == (generation, 'completed')


def test_failed_retry_preserves_last_published_result(sessions):
    _enqueue_clip(sessions, 'clip')
    initial = jobs.claim_next()
    jobs.finish_claim(initial, Trajectory(video_id='clip', points=[{'t': 1}]))
    with sessions() as db, jobs.analysis_transaction(db):
        new_generation = jobs.enqueue(db, db.get(Video, 'clip'))
    with sessions() as db:
        assert db.query(Trajectory).one().points == [{'t': 1}]
    retry = jobs.claim_next()
    jobs.finish_claim(retry)
    assert jobs.job_snapshot('clip') == (new_generation, 'failed')
    with sessions() as db:
        assert db.query(Trajectory).one().points == [{'t': 1}]
        assert db.get(Video, 'clip').status == 'processed'


def test_parallel_claims_respect_worker_limit(sessions):
    from concurrent.futures import ThreadPoolExecutor
    for index in range(jobs.WORKER_COUNT + 2):
        _enqueue_clip(sessions, f'clip-{index}')
    with ThreadPoolExecutor(max_workers=jobs.WORKER_COUNT + 2) as pool:
        claims = list(pool.map(lambda _: jobs.claim_next(), range(jobs.WORKER_COUNT + 2)))
    running = [claim for claim in claims if claim is not None]
    assert len(running) == jobs.WORKER_COUNT
    assert len({claim.video_id for claim in running}) == jobs.WORKER_COUNT
    assert jobs.claim_next() is None
    jobs.finish_claim(running[0])
    next_claim = jobs.claim_next()
    assert next_claim is not None
    assert next_claim.video_id not in {claim.video_id for claim in running}
