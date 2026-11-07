from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import secrets
import logging
from fastapi import HTTPException
from models.user import User
from sqlalchemy.orm import Session
from config import JWT_SECRET_KEY, JWT_ALGORITHM, JWT_ACCESS_TOKEN_EXPIRE_MINUTES

logger = logging.getLogger(__name__)

try:
    import jwt
    from jwt.exceptions import PyJWTError as JWTError
except ImportError:
    from jose import JWTError, jwt

class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """Verify a password against its hash (PBKDF2-HMAC-SHA256 with salt)"""
        try:
            if not hashed_password or '$' not in hashed_password:
                return False
            salt, key_hex = hashed_password.split('$', 1)
            new_key = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt.encode('utf-8'), 100000)
            return secrets.compare_digest(new_key.hex(), key_hex)
        except Exception as e:
            logger.warning(f"Password verification error: {e}")
            return False

    def get_password_hash(self, password: str) -> str:
        """Hash a password using PBKDF2-HMAC-SHA256 with random 16-byte salt"""
        salt = secrets.token_hex(16)
        key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return f"{salt}${key.hex()}"

    def authenticate_user(self, email: str, password: str) -> Optional[User]:
        """Authenticate a user with email and password"""
        user = self.db.query(User).filter(User.email == email).first()
        if not user:
            logger.warning(f"Authentication failed: user not found - {email}")
            return None
        if not self.verify_password(password, user.hashed_password):
            logger.warning(f"Authentication failed: invalid password - {email}")
            return None
        return user

    def create_access_token(self, data: dict, expires_delta: Optional[timedelta] = None) -> str:
        """Create a JWT access token"""
        to_encode = data.copy()
        now = datetime.now(timezone.utc)
        if expires_delta:
            expire = now + expires_delta
        else:
            expire = now + timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
        return encoded_jwt

    def get_current_user(self, token: str) -> User:
        """Get the current user from a JWT token"""
        credentials_exception = HTTPException(
            status_code=401,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
            email: str = payload.get("sub")
            if email is None:
                raise credentials_exception
        except JWTError as e:
            logger.warning(f"JWT decode failed: {e}")
            raise credentials_exception

        user = self.db.query(User).filter(User.email == email).first()
        if user is None:
            logger.warning(f"User not found for email: {email}")
            raise credentials_exception
        return user
