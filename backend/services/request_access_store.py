from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4


def _get_firestore_client():
    try:
        from google.cloud import firestore
    except Exception as exc:
        raise RuntimeError(
            "google-cloud-firestore is not installed or unavailable."
        ) from exc

    return firestore.Client()


def create_access_request(
    *,
    email: str,
    organization: str,
    use_case: str,
    expected_volume: Optional[str] = None,
    source: str = "web",
) -> Dict[str, Any]:
    cleaned_email = (email or "").strip().lower()
    cleaned_organization = (organization or "").strip()
    cleaned_use_case = (use_case or "").strip()
    cleaned_expected_volume = (expected_volume or "").strip() or None

    if not cleaned_email or "@" not in cleaned_email:
        raise ValueError("A valid email address is required.")

    if not cleaned_organization:
        raise ValueError("Organization is required.")

    if not cleaned_use_case:
        raise ValueError("Use case is required.")

    request_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    payload = {
        "request_id": request_id,
        "email": cleaned_email,
        "organization": cleaned_organization,
        "use_case": cleaned_use_case,
        "expected_volume": cleaned_expected_volume,
        "source": source,
        "status": "new",
        "created_at": now,
        "updated_at": now,
    }

    db = _get_firestore_client()
    db.collection("access_requests").document(request_id).set(payload)

    return payload
