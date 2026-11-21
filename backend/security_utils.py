"""
NEXO Cryptographic Security Utilities
Native Windows DPAPI Data Protection & Sensitive Credential Masking (SEC-MED-04)
"""

import sys
import ctypes
import base64
from typing import Optional

if sys.platform == "win32":
    from ctypes import wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ("cbData", wintypes.DWORD),
            ("pbData", ctypes.POINTER(ctypes.c_byte))
        ]

def encrypt_secret(plain_text: Optional[str]) -> str:
    """
    Encrypts a secret using Windows Data Protection API (DPAPI - CryptProtectData).
    Returns a prefixed ciphertext string: 'dpapi:<base64>'.
    On non-Windows platforms (e.g. Linux CI/tests), uses an isolated base64-fallback.
    """
    if not plain_text:
        return ""
    if plain_text.startswith("dpapi:"):
        return plain_text
    if plain_text == "********":
        return plain_text

    data = plain_text.encode("utf-8")

    if sys.platform != "win32":
        return "dpapi:" + base64.b64encode(data).decode("utf-8")

    blob_in = DATA_BLOB(
        len(data),
        ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte))
    )
    blob_out = DATA_BLOB()

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    # CRYPTPROTECT_UI_FORBIDDEN = 0x01
    success = crypt32.CryptProtectData(
        ctypes.byref(blob_in),
        "NEXO_Stored_Secret",
        None,
        None,
        None,
        0x01,
        ctypes.byref(blob_out)
    )
    if not success:
        err = kernel32.GetLastError()
        raise RuntimeError(f"Windows DPAPI CryptProtectData failed with error code {err}")

    try:
        cipher_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        return "dpapi:" + base64.b64encode(cipher_bytes).decode("utf-8")
    finally:
        kernel32.LocalFree(blob_out.pbData)

def decrypt_secret(cipher_text: Optional[str]) -> str:
    """
    Decrypts a DPAPI-encrypted secret string ('dpapi:<base64>').
    If the string does not have the 'dpapi:' prefix, it is returned as-is for backward compatibility.
    """
    if not cipher_text:
        return ""
    if not cipher_text.startswith("dpapi:"):
        return cipher_text

    raw_b64 = cipher_text[len("dpapi:"):]
    try:
        data = base64.b64decode(raw_b64)
    except Exception:
        return cipher_text

    if sys.platform != "win32":
        return data.decode("utf-8", errors="replace")

    blob_in = DATA_BLOB(
        len(data),
        ctypes.cast(ctypes.create_string_buffer(data), ctypes.POINTER(ctypes.c_byte))
    )
    blob_out = DATA_BLOB()

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    # CRYPTPROTECT_UI_FORBIDDEN = 0x01
    success = crypt32.CryptUnprotectData(
        ctypes.byref(blob_in),
        None,
        None,
        None,
        None,
        0x01,
        ctypes.byref(blob_out)
    )
    if not success:
        err = kernel32.GetLastError()
        raise RuntimeError(f"Windows DPAPI CryptUnprotectData failed with error code {err}")

    try:
        plain_bytes = ctypes.string_at(blob_out.pbData, blob_out.cbData)
        return plain_bytes.decode("utf-8", errors="replace")
    finally:
        kernel32.LocalFree(blob_out.pbData)

def mask_secret(secret_val: Optional[str]) -> str:
    """Masks secret values with '********' for audit logs, API responses, and UI display."""
    if not secret_val or secret_val == "********":
        return secret_val or ""
    return "********"
