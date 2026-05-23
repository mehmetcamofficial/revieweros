import os
from typing import Optional

from fastapi import Header, HTTPException


DEFAULT_DEMO_CODE = "revieweros-demo-2026"
DEFAULT_JURY_DEMO_CODE = "evalora-demo-2026"
DEFAULT_ADMIN_CODE = "change-me-admin"

ACCESS_CODE = os.getenv("REVIEWEROS_ACCESS_CODE", DEFAULT_DEMO_CODE)
JURY_ACCESS_CODE = os.getenv("REVIEWEROS_JURY_ACCESS_CODE", DEFAULT_JURY_DEMO_CODE)
ADMIN_ACCESS_CODE = os.getenv("REVIEWEROS_ADMIN_CODE", DEFAULT_ADMIN_CODE)

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


def verify_access_code(
    access_code: Optional[str],
    user_id: Optional[str] = None,
) -> bool:
    if not access_code:
        return False

    try:
        from services.workspace_user_store import verify_workspace_user_access

        return verify_workspace_user_access(
            user_id=user_id,
            access_code=access_code,
        )
    except Exception:
        if not VALID_ACCESS_CODES:
            return True

        return access_code.strip() in VALID_ACCESS_CODES


def require_demo_auth(
    x_revieweros_user_id: Optional[str] = Header(default=None),
    x_revieweros_access_code: Optional[str] = Header(default=None),
) -> str:
    normalized_user_id = normalize_user_id(x_revieweros_user_id)

    if not verify_access_code(x_revieweros_access_code, normalized_user_id):
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing ReviewerOS access code.",
        )

    return normalized_user_id


def require_admin_auth(
    x_revieweros_access_code: Optional[str] = Header(default=None),
) -> str:
    if not x_revieweros_access_code:
        raise HTTPException(
            status_code=401,
            detail="Missing admin access code.",
        )

    if x_revieweros_access_code.strip() != ADMIN_ACCESS_CODE.strip():
        raise HTTPException(
            status_code=403,
            detail="Invalid admin access code.",
        )

    return "admin"


def optional_user_id(
    x_revieweros_user_id: Optional[str] = Header(default=None),
) -> str:
    return normalize_user_id(x_revieweros_user_id)