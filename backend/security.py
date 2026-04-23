"""
Shemford Futuristic School — Field-Level Encryption
Uses Fernet (AES-128-CBC + HMAC-SHA256) for symmetric encryption of PII fields.

Key management:
- Set FIELD_ENCRYPTION_KEY in .env (generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
- If key is absent, encryption is a no-op (dev mode) — NEVER skip in production

Migration safety:
- Encrypted values are prefixed with "enc:" so we can detect plaintext during the migration window
- decrypt_field() returns the raw value if it is not prefixed (backward compat read)
- After migration is complete, all values will have the "enc:" prefix
"""
import os
import logging
from typing import Optional
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_ENCRYPTION_KEY = os.environ.get("FIELD_ENCRYPTION_KEY", "")
_fernet: Optional[Fernet] = None
_ENC_PREFIX = "enc:"


def _get_fernet() -> Optional[Fernet]:
    global _fernet, _ENCRYPTION_KEY
    if _fernet is not None:
        return _fernet
    key = os.environ.get("FIELD_ENCRYPTION_KEY", _ENCRYPTION_KEY)
    if not key:
        logger.warning("FIELD_ENCRYPTION_KEY not set — PII field encryption is DISABLED")
        return None
    try:
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
        return _fernet
    except Exception as e:
        logger.error("Invalid FIELD_ENCRYPTION_KEY: %s", e)
        return None


def encrypt_field(value: Optional[str]) -> Optional[str]:
    """
    Encrypt a string field. Returns "enc:<base64>" or None.
    If key is not configured, returns plaintext unchanged (dev mode).
    """
    if value is None:
        return None
    f = _get_fernet()
    if f is None:
        return value  # dev mode — no encryption
    ciphertext = f.encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{_ENC_PREFIX}{ciphertext}"


def decrypt_field(value: Optional[str]) -> Optional[str]:
    """
    Decrypt a field encrypted with encrypt_field().
    - "enc:<base64>" → decrypted plaintext
    - plaintext (no prefix) → returned as-is (migration window / dev mode)
    - None → None
    Raises ValueError on tampered/corrupt ciphertext.
    """
    if value is None:
        return None
    if not value.startswith(_ENC_PREFIX):
        # Plaintext value: either dev mode or not-yet-migrated row
        return value
    f = _get_fernet()
    if f is None:
        # Key disappeared — cannot decrypt, return sentinel to surface the problem
        logger.error("FIELD_ENCRYPTION_KEY required to decrypt PII field but is not set")
        return "[ENCRYPTED]"
    try:
        return f.decrypt(value[len(_ENC_PREFIX):].encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.error("Decryption failed — value may be corrupt or key may be wrong")
        raise ValueError("Failed to decrypt PII field — possible key mismatch")


# ── Convenience helpers for employee bank details ─────────────────────────────

_BANK_FIELDS = ("bank_account_number", "bank_ifsc", "bank_name", "bank_account_holder")

# Public alias — import this in other modules instead of the private name
BANK_FIELDS: tuple = _BANK_FIELDS


def encrypt_bank_fields(doc: dict) -> dict:
    """
    Encrypt all bank fields in a document dict (in-place mutation + return).
    Sets _bank_fields_encrypted=True as a migration-state flag.
    """
    for field in _BANK_FIELDS:
        if field in doc and doc[field] is not None:
            doc[field] = encrypt_field(str(doc[field]))
    doc["_bank_fields_encrypted"] = True
    return doc


def decrypt_bank_fields(doc: dict) -> dict:
    """
    Decrypt all bank fields in a document dict (returns a copy — does NOT mutate DB).
    Safe to call on already-plaintext documents.
    """
    result = dict(doc)
    for field in _BANK_FIELDS:
        if field in result and result[field] is not None:
            try:
                result[field] = decrypt_field(str(result[field]))
            except ValueError:
                result[field] = "[DECRYPTION ERROR]"
    return result


def is_encrypted(value: Optional[str]) -> bool:
    """Check whether a value has already been encrypted."""
    return isinstance(value, str) and value.startswith(_ENC_PREFIX)


def strip_pii_for_audit(doc: dict) -> dict:
    """
    Redact PII / bank fields before writing to audit logs or structured logging.
    Returns a shallow copy — never mutates the original document.
    """
    result = dict(doc)
    for field in _BANK_FIELDS:
        if field in result:
            result[field] = "[REDACTED]"
    return result
