from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import get_settings
from app.core.errors import AppError


def _make_fernet(raw_key: str) -> Fernet:
    key = raw_key.encode("utf-8")
    # Accept raw Fernet keys or derive a stable key from any secret string (dev).
    try:
        return Fernet(key)
    except Exception:
        # Key is not a valid Fernet key (dev secret string) — derive one via SHA-256.
        derived = base64.urlsafe_b64encode(hashlib.sha256(key).digest())
        return Fernet(derived)


def _fernet() -> MultiFernet:
    """Current key first (used for NEW encryptions); previous key second so
    data encrypted before a key rotation stays readable. Rotating the key
    without setting UPI_ENCRYPTION_KEY_PREVIOUS bricks existing guest-ID and
    UPI ciphertexts permanently — that is why this exists."""
    settings = get_settings()
    keys = [_make_fernet(settings.upi_encryption_key)]
    if settings.upi_encryption_key_previous:
        keys.append(_make_fernet(settings.upi_encryption_key_previous))
    return MultiFernet(keys)


def encrypt_sensitive(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_sensitive(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise AppError(
            "encryption_error", "Unable to decrypt sensitive value", status_code=500
        ) from exc
