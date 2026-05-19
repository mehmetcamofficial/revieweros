from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict
from google.cloud.firestore_v1 import transactional


DEFAULT_MONTHLY_LIMIT = 25


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
    doc_ref = (
        db.collection("workspace_quotas")
        .document(cleaned_user_id)
        .collection("months")
        .document(month_key)
    )

    snap = doc_ref.get()

    if snap.exists:
        data = snap.to_dict() or {}
    else:
        data = {}

    limit = int(data.get("limit") or default_limit)
    used = int(data.get("used") or 0)

    return {
        "user_id": cleaned_user_id,
        "month": month_key,
        "limit": limit,
        "used": used,
        "remaining": max(0, limit - used),
        "allowed": used < limit,
    }


def assert_workspace_quota_available(user_id: str, default_limit: int = DEFAULT_MONTHLY_LIMIT) -> Dict[str, Any]:
    quota = get_workspace_quota(user_id=user_id, default_limit=default_limit)

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
    doc_ref = (
        db.collection("workspace_quotas")
        .document(cleaned_user_id)
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
