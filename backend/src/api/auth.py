from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from database import get_db
from services.auth_service import AuthService
from models.user import User
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from datetime import timedelta
import re
from typing import Optional
import logging
from secrets import token_urlsafe
from uuid import uuid4

logger = logging.getLogger(__name__)
router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token", auto_error=False)

class UserCreate(BaseModel):
    email: str
    name: str
    password: str

class UserLogin(BaseModel):
    email: str
    password: str

class GuestPromotion(BaseModel):
    email: str = Field(max_length=254)
    name: str = Field(max_length=100)
    password: str = Field(min_length=12, max_length=128)

GUEST_SESSION_DAYS = 7


def _is_guest(email: str) -> bool:
    return re.fullmatch(r"guest-[0-9a-f]{32}@cricket\.drs", email) is not None


def _reserved_email(email: str) -> bool:
    return email.strip().lower().endswith("@cricket.drs")

class Token(BaseModel):
    access_token: str
    token_type: str

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """Get current authenticated user (required)"""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    auth_service = AuthService(db)
    return auth_service.get_current_user(token)

async def get_current_user_optional(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> Optional[User]:
    """Get current user if authenticated; returns None if no token provided. Rejects invalid tokens with 401."""
    if not token:
        return None
    # If a token is provided, it MUST be valid. Do not downgrade invalid credentials to anonymous.
    auth_service = AuthService(db)
    return auth_service.get_current_user(token)

@router.post("/register", response_model=Token)
async def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user"""
    auth_service = AuthService(db)
    email = user.email.strip().lower()
    if _reserved_email(email):
        raise HTTPException(status_code=422, detail="Choose an email address outside the reserved workspace domain")

    # Check if user exists
    db_user = db.query(User).filter(func.lower(User.email) == email).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    hashed_password = auth_service.get_password_hash(user.password)
    db_user = User(
        email=email,
        name=user.name,
        hashed_password=hashed_password
    )
    db.add(db_user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered") from exc
    db.refresh(db_user)

    # Create token
    access_token = auth_service.create_access_token(data={"sub": db_user.email})
    logger.info("User registered: %s", db_user.id)
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/login", response_model=Token)
async def login(user: UserLogin, db: Session = Depends(get_db)):
    """Login with email and password"""
    auth_service = AuthService(db)
    db_user = auth_service.authenticate_user(user.email, user.password)
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth_service.create_access_token(data={"sub": db_user.email})
    logger.info("User logged in: %s", db_user.id)
    return {"access_token": access_token, "token_type": "bearer"}

@router.post("/guest", response_model=Token)
async def guest_login(db: Session = Depends(get_db)):
    """Create an isolated workspace for a new guest session."""
    auth_service = AuthService(db)
    guest_email = f"guest-{uuid4().hex}@cricket.drs"
    user = User(
        email=guest_email,
        name="Guest Evaluator",
        hashed_password=auth_service.get_password_hash(token_urlsafe(32)),
    )
    db.add(user)
    db.commit()
    access_token = auth_service.create_access_token({"sub": guest_email}, timedelta(days=GUEST_SESSION_DAYS))
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/promote", response_model=Token)
def promote_guest(
    request: GuestPromotion,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set credentials on the guest's existing workspace."""
    guest_email = current_user.email
    if not _is_guest(guest_email):
        raise HTTPException(status_code=409, detail="This workspace already has an account")
    email = request.email.strip().lower()
    name = request.name.strip()
    if not name or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or _reserved_email(email):
        raise HTTPException(status_code=422, detail="Enter a name and a valid email address")
    if db.query(User.id).filter(func.lower(User.email) == email).first():
        raise HTTPException(status_code=409, detail="That email is already in use")

    service = AuthService(db)
    password_hash = service.get_password_hash(request.password)
    try:
        updated = db.query(User).filter(User.id == current_user.id, User.email == guest_email).update(
            {User.email: email, User.name: name, User.hashed_password: password_hash},
            synchronize_session=False,
        )
        if updated != 1:
            raise HTTPException(status_code=409, detail="This workspace already has an account")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email is already in use") from exc
    return {"access_token": service.create_access_token({"sub": email}), "token_type": "bearer"}

@router.post("/token", response_model=Token)
async def token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """OAuth2 compatible token endpoint"""
    auth_service = AuthService(db)
    db_user = auth_service.authenticate_user(form_data.username, form_data.password)
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth_service.create_access_token(data={"sub": db_user.email})
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user information"""
    return {
        "id": current_user.id,
        "email": current_user.email,
        "name": current_user.name,
        "is_guest": _is_guest(current_user.email),
    }
