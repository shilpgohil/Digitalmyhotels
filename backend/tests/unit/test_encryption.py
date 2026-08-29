from app.core.encryption import decrypt_sensitive, encrypt_sensitive


def test_encrypt_decrypt_roundtrip() -> None:
    secret = "hotelname@upi"
    token = encrypt_sensitive(secret)
    assert token != secret
    assert decrypt_sensitive(token) == secret


def test_ciphertext_is_not_stable_plaintext() -> None:
    # Fernet includes a nonce — two encryptions of the same value differ.
    assert encrypt_sensitive("same@upi") != encrypt_sensitive("same@upi")
