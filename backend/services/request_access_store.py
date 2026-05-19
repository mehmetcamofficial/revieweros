from __future__ import annotations

from datetime import datetime, timezone
import os
import smtplib
from email.message import EmailMessage
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



def _send_access_request_email(payload: Dict[str, Any]) -> None:
    notify_to = os.getenv("REQUEST_ACCESS_NOTIFY_EMAIL", "").strip()
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").strip()
    smtp_from = os.getenv("SMTP_FROM", smtp_user).strip()

    # Email ayarı yoksa sistemi bozma; sadece Firestore kaydı yeterli olsun.
    if not notify_to or not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        return

    subject = f"New Evalora Access Request — {payload.get('organization', 'Unknown organization')}"

    body = f"""New Evalora access request received.

Request ID: {payload.get('request_id')}
Status: {payload.get('status')}
Created At: {payload.get('created_at')}

Email: {payload.get('email')}
Organization: {payload.get('organization')}
Use Case:
{payload.get('use_case')}

Expected Monthly Volume: {payload.get('expected_volume') or '-'}
Source: {payload.get('source') or '-'}
"""

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = smtp_from
    message["To"] = notify_to
    message.set_content(body)

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(message)


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

    try:
        _send_access_request_email(payload)
    except Exception as exc:
        # Email bildirimi başarısız olsa bile form kaydını bozma.
        print(f"Access request email notification failed: {exc}")

    return payload
