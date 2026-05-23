from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List


DEFAULT_DEMO_CODE = "revieweros-demo-2026"
DEFAULT_JURY_DEMO_CODE = "evalora-demo-2026"

ACCESS_CODE = os.getenv("REVIEWEROS_ACCESS_CODE", DEFAULT_DEMO_CODE)
JURY_ACCESS_CODE = os.getenv("REVIEWEROS_JURY_ACCESS_CODE", DEFAULT_JURY_DEMO_CODE)


def _get_firestore_client():
    try:
        from google.cloud import firestore
    except Exception as exc:
        raise RuntimeError(
            "google-cloud-firestore is not installed or unavailable."
        ) from exc

    return firestore.Client()


def _normalize_user_id(value: str | None) -> str:
    cleaned = (value or "demo-user").strip().lower()

    if not cleaned:
        return "demo-user"

    allowed = []

    for char in cleaned:
        if char.isalnum() or char in ["@", ".", "-", "_"]:
            allowed.append(char)
        else:
            allowed.append("-")

    return "".join(allowed)[:120]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_ref(user_id: str):
    db = _get_firestore_client()
    return db.collection("workspace_users").document(_normalize_user_id(user_id))


def list_workspace_users() -> List[Dict[str, Any]]:
    db = _get_firestore_client()
    items = []

    for snap in db.collection("workspace_users").stream():
        data = snap.to_dict() or {}
        items.append(
            {
                "user_id": snap.id,
                "role": data.get("role") or "demo",
                "disabled": bool(data.get("disabled") or False),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
                "has_access_code": bool(data.get("access_code")),
            }
        )

    return sorted(items, key=lambda item: item["user_id"])


def create_workspace_user(
    user_id: str,
    access_code: str,
    role: str = "demo",
    disabled: bool = False,
) -> Dict[str, Any]:
    cleaned_user_id = _normalize_user_id(user_id)
    cleaned_access_code = (access_code or "").strip()

    if not cleaned_user_id:
        raise ValueError("User ID is required.")

    if not cleaned_access_code:
        raise ValueError("Access code is required.")

    ref = _doc_ref(cleaned_user_id)
    snap = ref.get()
    existing = snap.to_dict() if snap.exists else {}

    now = _now()

    ref.set(
        {
            "user_id": cleaned_user_id,
            "access_code": cleaned_access_code,
            "role": role or "demo",
            "disabled": bool(disabled),
            "created_at": existing.get("created_at") or now,
            "updated_at": now,
        },
        merge=True,
    )

    return {
        "user_id": cleaned_user_id,
        "role": role or "demo",
        "disabled": bool(disabled),
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
        "has_access_code": True,
    }


def delete_workspace_user(user_id: str) -> Dict[str, Any]:
    cleaned_user_id = _normalize_user_id(user_id)
    _doc_ref(cleaned_user_id).delete()

    return {
        "user_id": cleaned_user_id,
        "deleted": True,
    }


def set_workspace_user_disabled(user_id: str, disabled: bool) -> Dict[str, Any]:
    cleaned_user_id = _normalize_user_id(user_id)
    ref = _doc_ref(cleaned_user_id)
    snap = ref.get()

    if not snap.exists:
        raise ValueError(f"Workspace user not found: {cleaned_user_id}")

    ref.set(
        {
            "disabled": bool(disabled),
            "updated_at": _now(),
        },
        merge=True,
    )

    data = ref.get().to_dict() or {}

    return {
        "user_id": cleaned_user_id,
        "role": data.get("role") or "demo",
        "disabled": bool(data.get("disabled") or False),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
        "has_access_code": bool(data.get("access_code")),
    }


def update_workspace_user_access_code(user_id: str, access_code: str) -> Dict[str, Any]:
    cleaned_user_id = _normalize_user_id(user_id)
    cleaned_access_code = (access_code or "").strip()

    if not cleaned_access_code:
        raise ValueError("Access code is required.")

    ref = _doc_ref(cleaned_user_id)
    snap = ref.get()

    if not snap.exists:
        raise ValueError(f"Workspace user not found: {cleaned_user_id}")

    ref.set(
        {
            "access_code": cleaned_access_code,
            "updated_at": _now(),
        },
        merge=True,
    )

    data = ref.get().to_dict() or {}

    return {
        "user_id": cleaned_user_id,
        "role": data.get("role") or "demo",
        "disabled": bool(data.get("disabled") or False),
        "created_at": data.get("created_at"),
        "updated_at": data.get("updated_at"),
        "has_access_code": True,
    }


def verify_workspace_user_access(user_id: str | None, access_code: str | None) -> bool:
    cleaned_user_id = _normalize_user_id(user_id)
    cleaned_access_code = (access_code or "").strip()

    if not cleaned_access_code:
        return False

    ref = _doc_ref(cleaned_user_id)
    snap = ref.get()

    if snap.exists:
        data = snap.to_dict() or {}

        if bool(data.get("disabled") or False):
            return False

        expected = (data.get("access_code") or "").strip()
        return bool(expected) and cleaned_access_code == expected

    # Legacy fallback: eski demo hesaplarını kırmamak için.
    legacy_codes = {
        "hakki": ACCESS_CODE,
        "demo-user": ACCESS_CODE,
        "jury-demo": JURY_ACCESS_CODE,
    }

    expected = (legacy_codes.get(cleaned_user_id) or "").strip()
    return bool(expected) and cleaned_access_code == expected
