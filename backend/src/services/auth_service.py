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
MEDIA_AUDIENCE = 'crease-lab-media'
MEDIA_TICKET_MINUTES = 30

try:
    import bcrypt
except ImportError:
    bcrypt = None

def _prepare_password(plain: str) -> bytes:
    """SHA-256 pre-hash so bcrypt never sees a password over 72 bytes."""
    return hashlib.sha256(plain.encode('utf-8')).hexdigest().encode('ascii')

try:
    import jwt
    from jwt.exceptions import PyJWTError as JWTError
except ImportError:
    from jose import JWTError, jwt

class AuthService:
    def __init__(self, db: Session):
        self.db = db

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """
        Verify a password against its hash.
        Supports both current scheme (SHA-256 hex -> bcrypt) and legacy direct bcrypt,
        with PBKDF2-HMAC-SHA256 fallback.
        """
        if not plain_password or not hashed_password:
            return False

        if bcrypt is not None and hashed_password.startswith(('$2a$', '$2b$', '$2y$')):
            # 1. Try prehashed format (current scheme: sha256 hex -> bcrypt)
            try:
                if bcrypt.checkpw(_prepare_password(plain_password), hashed_password.encode('utf-8')):
                    return True
            except Exception:
                pass

            # 2. Try legacy direct bcrypt format (plain <= 72 bytes)
            try:
                plain_bytes = plain_password.encode('utf-8')
                if len(plain_bytes) <= 72:
                    if bcrypt.checkpw(plain_bytes, hashed_password.encode('utf-8')):
                        return True
            except Exception:
                pass

        # 3. Try PBKDF2-HMAC-SHA256 (salt$hash format)
        try:
            if '$' in hashed_password and not hashed_password.startswith('$2'):
                salt, key_hex = hashed_password.split('$', 1)
                new_key = hashlib.pbkdf2_hmac('sha256', plain_password.encode('utf-8'), salt.encode('utf-8'), 100000)
                if secrets.compare_digest(new_key.hex(), key_hex):
                    return True
        except Exception:
            pass

        return False

    def get_password_hash(self, password: str) -> str:
        """Hash a password using SHA-256 pre-hash + bcrypt"""
        if bcrypt is not None:
            return bcrypt.hashpw(_prepare_password(password), bcrypt.gensalt()).decode('utf-8')
        salt = secrets.token_hex(16)
        key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt.encode('utf-8'), 100000)
        return f"{salt}${key.hex()}"

    def authenticate_user(self, email: str, password: str) -> Optional[User]:
        """Authenticate a user with email and password, transparently upgrading legacy hashes"""
        if email.strip().lower() == "guest@cricket.drs":
            return None  # The retired shared account had a public password.
        user = self.db.query(User).filter(User.email == email).first()
        if not user or not user.is_active:
            logger.warning("Authentication failed: unknown or inactive user")
            return None
        if not self.verify_password(password, user.hashed_password):
            logger.warning("Authentication failed: invalid password for user %s", user.id)
            return None

        # Transparently upgrade legacy direct-bcrypt or PBKDF2 hashes to the pre-hashed scheme
        try:
            if bcrypt is not None:
                is_prehashed = False
                try:
                    is_prehashed = bcrypt.checkpw(_prepare_password(password), user.hashed_password.encode('utf-8'))
                except Exception:
                    pass
                if not is_prehashed:
                    user.hashed_password = self.get_password_hash(password)
                    self.db.commit()
                    logger.info("Upgraded legacy password hash for user %s", user.id)
        except Exception as e:
            logger.debug(f"Legacy hash upgrade check skipped: {e}")

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

    def create_media_ticket(self, user_id: str, video_id: str) -> str:
        return self.create_access_token(
            {'sub': user_id, 'video_id': video_id, 'aud': MEDIA_AUDIENCE},
            expires_delta=timedelta(minutes=MEDIA_TICKET_MINUTES),
        )

    def media_ticket_owner(self, ticket: str, video_id: str) -> str:
        try:
            claims = jwt.decode(ticket, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM], audience=MEDIA_AUDIENCE,
                                options={'require': ['exp', 'sub', 'video_id']})
            if claims['video_id'] == video_id:
                return claims['sub']
        except JWTError:
            pass
        raise HTTPException(status_code=401, detail='Invalid or expired playback ticket')

    def get_current_user(self, token: str) -> User:
        """Get the current user from a JWT token"""
        credentials_exception = HTTPException(
            status_code=401,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM], options={'require': ['exp', 'sub']})
            email: str = payload.get("sub")
            if email is None:
                raise credentials_exception
        except JWTError as e:
            logger.warning(f"JWT decode failed: {e}")
            raise credentials_exception

        user = self.db.query(User).filter(User.email == email).first()
        if user is None or not user.is_active:
            logger.warning("Session validation failed: unknown or inactive user")
            raise credentials_exception
        return user
