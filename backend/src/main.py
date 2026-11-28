from contextlib import asynccontextmanager
from tempfile import TemporaryFile

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from api.videos import router as videos_router
from api.reviews import router as reviews_router
from api.auth import router as auth_router
from schema import schema_ready, upgrade_database
from logging_config import setup_logging
from config import CORS_ORIGINS, HOST, PORT, UPLOAD_DIR

# Setup logging
logger = setup_logging()

@asynccontextmanager
async def lifespan(app):
    upgrade_database()
    with TemporaryFile(dir=UPLOAD_DIR):
        pass
    yield

app = FastAPI(
    title="DRS Ball Tracking API",
    version="1.0.0",
    description="Cricket Decision Review System with Ball Tracking",
    lifespan=lifespan,
)

# Note: Media files are securely streamed via the authenticated /videos/{video_id}/stream
# endpoint to enforce user ownership and prevent unauthenticated public media access.

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(videos_router, prefix="/videos", tags=["videos"])
app.include_router(reviews_router, prefix="/reviews", tags=["reviews"])
app.include_router(auth_router, prefix="/auth", tags=["auth"])

@app.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {
        "message": "DRS Ball Tracking API",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
def health():
    """Report readiness only when the expected schema and storage are available."""
    try:
        ready = schema_ready() and UPLOAD_DIR.is_dir()
    except Exception:
        ready = False
    if not ready:
        raise HTTPException(status_code=503, detail="Application dependencies are unavailable")
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting DRS Ball Tracking API server on {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT)
