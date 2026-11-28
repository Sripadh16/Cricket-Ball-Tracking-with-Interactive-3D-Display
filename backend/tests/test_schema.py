import os
from pathlib import Path
import sys
import uuid

import pytest
from sqlalchemy import create_engine, inspect, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))

from database import Base
from models.user import User
from models.review_session import ReviewSession
from schema import upgrade_database, versions


def test_upgrade_preserves_current_sqlite_data(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "existing.db"}')
    with engine.begin() as connection:
        Base.metadata.create_all(connection)
        connection.execute(User.__table__.insert().values(email='reviewer@example.com', name='Reviewer', hashed_password='fixture'))

    upgrade_database(engine)
    upgrade_database(engine)
    with engine.connect() as connection:
        assert connection.scalar(select(User.email)) == 'reviewer@example.com'
        assert connection.scalars(select(versions.c.version).order_by(versions.c.version)).all()
    engine.dispose()


def test_upgrade_legacy_postgresql_schema():
    url = os.getenv('CREASE_TEST_POSTGRES_URL')
    if not url:
        pytest.skip('PostgreSQL upgrade test requires an isolated test database')
    schema_name = f'crease_test_{uuid.uuid4().hex}'
    admin = create_engine(url)
    engine = create_engine(url, connect_args={'options': f'-csearch_path={schema_name},public'})
    legacy_sql = Path(__file__).resolve().parents[2] / 'docker' / 'init.sql'
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA {schema_name}'))
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(legacy_sql.read_text(encoding='utf-8'))
            connection.execute(text("INSERT INTO videos (id, user_id, filename, file_path) SELECT 'clip', id, 'clip.mp4', '/app/uploads/clip.mp4' FROM users WHERE username = 'admin'"))
            connection.execute(text("INSERT INTO review_sessions (video_id, user_id, decision) SELECT id, user_id, 'Out' FROM videos WHERE id = 'clip'"))
        upgrade_database(engine)
        upgrade_database(engine)
        with engine.connect() as connection:
            assert connection.scalar(select(User.is_active).where(User.email == 'admin@drs.local')) is False
            assert connection.scalar(select(ReviewSession.decisions))[0]['outcome'] == 'Out'
            assert any(constraint['column_names'] == ['video_id'] for constraint in inspect(connection).get_unique_constraints('trajectories'))
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA {schema_name} CASCADE'))
        admin.dispose()
