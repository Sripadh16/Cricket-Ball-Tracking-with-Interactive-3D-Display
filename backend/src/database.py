import os

from sqlalchemy import URL, create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from config import DATABASE_URL, POSTGRES_HOST

db_url = URL.create(
    'postgresql+psycopg2', username=os.environ['POSTGRES_USER'], password=os.environ['POSTGRES_PASSWORD'],
    host=POSTGRES_HOST, database=os.environ['POSTGRES_DB'],
) if POSTGRES_HOST else DATABASE_URL
engine = create_engine(
    db_url,
    connect_args={"check_same_thread": False} if str(db_url).startswith("sqlite") else {},
    pool_pre_ping=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
