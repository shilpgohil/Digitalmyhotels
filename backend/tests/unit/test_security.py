import pytest

from app.core.errors import UnauthorizedError
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_and_verify(self) -> None:
        hashed = hash_password("s3curePassword!")
        assert hashed != "s3curePassword!"
        assert verify_password("s3curePassword!", hashed)
        assert not verify_password("wrong", hashed)

    def test_hashes_are_salted(self) -> None:
        assert hash_password("same") != hash_password("same")


class TestAccessTokens:
    def test_roundtrip(self) -> None:
        token = create_access_token(subject="user-123", claims={"hotel_id": "h-1"})
        payload = decode_access_token(token)
        assert payload["sub"] == "user-123"
        assert payload["hotel_id"] == "h-1"
        assert payload["type"] == "access"

    def test_garbage_token_rejected(self) -> None:
        with pytest.raises(UnauthorizedError):
            decode_access_token("not.a.token")

    def test_expired_token_rejected(self) -> None:
        token = create_access_token(subject="user-123", expires_minutes=-1)
        with pytest.raises(UnauthorizedError):
            decode_access_token(token)


class TestRefreshTokens:
    def test_generated_tokens_are_unique_and_hashed(self) -> None:
        t1, t2 = generate_refresh_token(), generate_refresh_token()
        assert t1 != t2
        assert hash_token(t1) != t1
        assert hash_token(t1) == hash_token(t1)
