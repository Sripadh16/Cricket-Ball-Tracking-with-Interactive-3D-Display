"""Versioned schema upgrades executed before the API accepts traffic."""
import time
import uuid

from sqlalchemy import Column, Integer, MetaData, Table, func, inspect, select, text

from database import Base, engine
from models.analysis_job import AnalysisJob, MediaDeletion
from models.review_session import ReviewSession
from models.trajectory import Trajectory
from models.user import User
from models.video import Video

APP_TABLES = (User.__table__, Video.__table__, Trajectory.__table__, ReviewSession.__table__)
versions = Table('schema_versions', MetaData(), Column('version', Integer, primary_key=True))


def _upgrade_initial_schema(connection):
    inspector = inspect(connection)
    if connection.dialect.name == 'postgresql' and inspector.has_table('users'):
        user_columns = {column['name'] for column in inspector.get_columns('users')}
        if 'username' in user_columns and 'name' not in user_columns:
            # Match the legacy Docker SQL by its identifying columns before applying the upgrade.
            review_columns = {column['name'] for column in inspector.get_columns('review_sessions')}
            if 'decision' not in review_columns or 'decisions' in review_columns:
                raise RuntimeError('Unexpected legacy PostgreSQL schema; back up and inspect it before upgrading')
            for statement in (
                'ALTER TABLE users RENAME COLUMN username TO name',
                'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key',
                'ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now()',
                "UPDATE users SET email = id || '@legacy.invalid' WHERE email IS NULL",
                'ALTER TABLE users ALTER COLUMN email SET NOT NULL',
                "UPDATE users SET is_active = false WHERE email = 'admin@drs.local' AND name = 'admin'",
                'ALTER TABLE trajectories ALTER COLUMN points TYPE json USING points::json',
                'ALTER TABLE trajectories ALTER COLUMN timestamps TYPE json USING timestamps::json',
                'ALTER TABLE trajectories ALTER COLUMN additional_data TYPE json USING additional_data::json',
                'ALTER TABLE trajectories ADD CONSTRAINT uq_trajectories_video UNIQUE (video_id)',
                'ALTER TABLE review_sessions ADD COLUMN decisions json',
                "UPDATE review_sessions SET decisions = json_build_array(json_build_object('type', 'legacy', 'outcome', decision, 'timestamp', NULL)) WHERE decision IS NOT NULL",
                'ALTER TABLE review_sessions ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now()',
                'ALTER TABLE review_sessions ADD CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id)',
            ):
                connection.execute(text(statement))

    Base.metadata.create_all(connection, tables=APP_TABLES)
    inspector = inspect(connection)
    for table in APP_TABLES:
        actual = {column['name'] for column in inspector.get_columns(table.name)}
        missing = set(table.columns.keys()) - actual
        if table is ReviewSession.__table__:
            missing.discard('analysis_revision')  # Added by migration 3.
        if missing:
            raise RuntimeError(f'Schema upgrade could not resolve {table.name} columns: {", ".join(sorted(missing))}')


def _add_durable_analysis(connection):
    jobs = AnalysisJob.__table__
    Base.metadata.create_all(connection, tables=[jobs, MediaDeletion.__table__])
    video_ids = connection.scalars(select(Video.id).where(Video.status == 'processing')).all()
    for video_id in video_ids:
        connection.execute(jobs.insert().values(video_id=video_id, state='queued',
                                                generation=str(uuid.uuid4()), queued_at=time.time()))


def _add_assessment_revision(connection):
    columns = {column['name'] for column in inspect(connection).get_columns('review_sessions')}
    if 'analysis_revision' not in columns:
        connection.execute(text('ALTER TABLE review_sessions ADD COLUMN analysis_revision VARCHAR'))


MIGRATIONS = (_upgrade_initial_schema, _add_durable_analysis, _add_assessment_revision)


def upgrade_database(db_engine=engine):
    with db_engine.begin() as connection:
        if connection.dialect.name == 'postgresql':
            connection.execute(text('SELECT pg_advisory_xact_lock(38012048)'))
        versions.create(connection, checkfirst=True)
        current = connection.scalar(select(func.max(versions.c.version))) or 0
        if current > len(MIGRATIONS):
            raise RuntimeError('Database schema is newer than this application')
        for version, migration in enumerate(MIGRATIONS, start=1):
            if version > current:
                migration(connection)
                connection.execute(versions.insert().values(version=version))


def schema_ready(db_engine=engine):
    with db_engine.connect() as connection:
        return connection.scalar(select(func.max(versions.c.version))) == len(MIGRATIONS)
