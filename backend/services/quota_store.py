from __future__ import annotations

import os

from datetime import datetime, timezone
from typing import Any, Dict
from google.cloud.firestore_v1 import transactional


DEFAULT_MONTHLY_LIMIT = 25
JURY_DEMO_LIMIT = 10

EMERGENCY_DEMO_DISABLED = (
    os.getenv("REVIEWEROS_DEMO_DISABLED", "false").lower() == "true"
)


def _get_firestore_client():
    try:
        from google.cloud import firestore
    except Exception as exc:
        raise RuntimeError(
            "google-cloud-firestore is not installed or unavailable."
        ) from exc

    return firestore.Client()


def _current_month_key() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def get_workspace_quota(user_id: str, default_limit: int = DEFAULT_MONTHLY_LIMIT) -> Dict[str, Any]:
    cleaned_user_id = (user_id or "demo").strip() or "demo"
    month_key = _current_month_key()

    db = _get_firestore_client()
    workspace_ref = db.collection("workspace_quotas").document(cleaned_user_id)

    workspace_ref.set(
        {
            "user_id": cleaned_user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )

    doc_ref = (
        workspace_ref
        .collection("months")
        .document(month_key)
    )

    snap = doc_ref.get()

    if snap.exists:
        data = snap.to_dict() or {}
    else:
        data = {}

    limit = int(data.get("limit") or default_limit)

    # Admin-configured Firestore limit is authoritative.
    used = int(data.get("used") or 0)

    return {
        "user_id": cleaned_user_id,
        "month": month_key,
        "limit": limit,
        "used": used,
        "remaining": max(0, limit - used),
        "allowed": used < limit and not bool(data.get("disabled") or False),
        "disabled": bool(data.get("disabled") or False),
    }


def assert_workspace_quota_available(user_id: str, default_limit: int = DEFAULT_MONTHLY_LIMIT) -> Dict[str, Any]:
    if EMERGENCY_DEMO_DISABLED or get_demo_control().get("demo_disabled"):
        raise RuntimeError("ReviewerOS demo access is temporarily disabled.")

    quota = get_workspace_quota(user_id=user_id, default_limit=default_limit)

    if quota.get("disabled"):
        raise RuntimeError(f"Workspace {quota['user_id']} is disabled.")

    if not quota["allowed"]:
        raise RuntimeError(
            f"Workspace quota exceeded for {quota['user_id']}: "
            f"{quota['used']}/{quota['limit']} analyses used in {quota['month']}."
        )

    return quota


def increment_workspace_quota(user_id: str, default_limit: int = DEFAULT_MONTHLY_LIMIT) -> Dict[str, Any]:
    cleaned_user_id = (user_id or "demo").strip() or "demo"
    month_key = _current_month_key()

    db = _get_firestore_client()
    workspace_ref = db.collection("workspace_quotas").document(cleaned_user_id)

    workspace_ref.set(
        {
            "user_id": cleaned_user_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )

    doc_ref = (
        workspace_ref
        .collection("months")
        .document(month_key)
    )

    transaction = db.transaction()

    @transactional
    def _increment(transaction, ref):
        snap = ref.get(transaction=transaction)

        if snap.exists:
            data = snap.to_dict() or {}
        else:
            data = {}

        limit = int(data.get("limit") or default_limit)
        used = int(data.get("used") or 0)

        if used >= limit:
            raise RuntimeError(
                f"Workspace quota exceeded for {cleaned_user_id}: "
                f"{used}/{limit} analyses used in {month_key}."
            )

        next_used = used + 1
        now = datetime.now(timezone.utc).isoformat()

        transaction.set(
            ref,
            {
                "user_id": cleaned_user_id,
                "month": month_key,
                "limit": limit,
                "used": next_used,
                "updated_at": now,
                "created_at": data.get("created_at") or now,
            },
            merge=True,
        )

        return {
            "user_id": cleaned_user_id,
            "month": month_key,
            "limit": limit,
            "used": next_used,
            "remaining": max(0, limit - next_used),
            "allowed": next_used < limit,
        }

    return _increment(transaction, doc_ref)


def set_workspace_limit(user_id: str, limit: int):
    cleaned_user_id = (user_id or "demo").strip() or "demo"
    month_key = _current_month_key()

    db = _get_firestore_client()

    doc_ref = (
        db.collection("workspace_quotas")
        .document(cleaned_user_id)
        .collection("months")
        .document(month_key)
    )

    existing = doc_ref.get()

    data = existing.to_dict() if existing.exists else {}

    doc_ref.set(
        {
            "user_id": cleaned_user_id,
            "month": month_key,
            "limit": int(limit),
            "used": int(data.get("used") or 0),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )

    return get_workspace_quota(cleaned_user_id)


def reset_workspace_usage(user_id: str):
    cleaned_user_id = (user_id or "demo").strip() or "demo"
    month_key = _current_month_key()

    db = _get_firestore_client()

    doc_ref = (
        db.collection("workspace_quotas")
        .document(cleaned_user_id)
        .collection("months")
        .document(month_key)
    )

    snap = doc_ref.get()

    if not snap.exists:
        return get_workspace_quota(cleaned_user_id)

    data = snap.to_dict() or {}

    doc_ref.set(
        {
            "used": 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "limit": int(data.get("limit") or DEFAULT_MONTHLY_LIMIT),
        },
        merge=True,
    )

    return get_workspace_quota(cleaned_user_id)


def list_workspace_quotas():
    month_key = _current_month_key()
    db = _get_firestore_client()
    items = []

    for workspace_ref in db.collection("workspace_quotas").stream():
        user_id = workspace_ref.id
        month_ref = (
            db.collection("workspace_quotas")
            .document(user_id)
            .collection("months")
            .document(month_key)
        )
        snap = month_ref.get()
        data = snap.to_dict() if snap.exists else {}

        limit = int(data.get("limit") or DEFAULT_MONTHLY_LIMIT)
        used = int(data.get("used") or 0)

        items.append(
            {
                "user_id": user_id,
                "month": month_key,
                "limit": limit,
                "used": used,
                "remaining": max(0, limit - used),
                "allowed": used < limit and not bool(data.get("disabled") or False),
        "disabled": bool(data.get("disabled") or False),
                "disabled": bool(data.get("disabled") or False),
                "updated_at": data.get("updated_at"),
            }
        )

    return sorted(items, key=lambda item: item["user_id"])


def set_workspace_disabled(user_id: str, disabled: bool):
    cleaned_user_id = (user_id or "demo").strip() or "demo"
    month_key = _current_month_key()
    db = _get_firestore_client()

    doc_ref = (
        db.collection("workspace_quotas")
        .document(cleaned_user_id)
        .collection("months")
        .document(month_key)
    )

    snap = doc_ref.get()
    data = snap.to_dict() if snap.exists else {}

    doc_ref.set(
        {
            "user_id": cleaned_user_id,
            "month": month_key,
            "limit": int(data.get("limit") or DEFAULT_MONTHLY_LIMIT),
            "used": int(data.get("used") or 0),
            "disabled": bool(disabled),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )

    return get_workspace_quota(cleaned_user_id)


def get_demo_control():
    db = _get_firestore_client()
    ref = db.collection("revieweros_admin").document("demo_control")
    snap = ref.get()
    data = snap.to_dict() if snap.exists else {}

    return {
        "demo_disabled": bool(data.get("demo_disabled") or False),
        "updated_at": data.get("updated_at"),
    }


def set_demo_control(demo_disabled: bool):
    db = _get_firestore_client()
    ref = db.collection("revieweros_admin").document("demo_control")

    payload = {
        "demo_disabled": bool(demo_disabled),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    ref.set(payload, merge=True)
    return payload
