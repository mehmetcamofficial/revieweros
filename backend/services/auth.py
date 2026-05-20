import os
from typing import Optional

from fastapi import Header, HTTPException


DEFAULT_DEMO_CODE = "revieweros-demo-2026"
DEFAULT_JURY_DEMO_CODE = "evalora-demo-2026"

ACCESS_CODE = os.getenv("REVIEWEROS_ACCESS_CODE", DEFAULT_DEMO_CODE)
JURY_ACCESS_CODE = os.getenv("REVIEWEROS_JURY_ACCESS_CODE", DEFAULT_JURY_DEMO_CODE)

VALID_ACCESS_CODES = {
    code.strip()
    for code in [
        ACCESS_CODE,
        JURY_ACCESS_CODE,
    ]
    if code and code.strip()
}


def normalize_user_id(value: Optional[str]) -> str:
    if not value:
        return "demo-user"

    cleaned = value.strip().lower()

    if not cleaned:
        return "demo-user"

    allowed = []

    for char in cleaned:
        if char.isalnum() or char in ["@", ".", "-", "_"]:
            allowed.append(char)
        else:
            allowed.append("-")

    return "".join(allowed)[:120]


def verify_access_code(access_code: Optional[str]) -> bool:
    if not VALID_ACCESS_CODES:
        return True

    if not access_code:
        return False

    return access_code.strip() in VALID_ACCESS_CODES


def require_demo_auth(
    x_revieweros_user_id: Optional[str] = Header(default=None),
    x_revieweros_access_code: Optional[str] = Header(default=None),
) -> str:
    if not verify_access_code(x_revieweros_access_code):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing ReviewerOS access code.",
        )

    return normalize_user_id(x_revieweros_user_id)


def optional_user_id(
    x_revieweros_user_id: Optional[str] = Header(default=None),
) -> str:
    return normalize_user_id(x_revieweros_user_id)