from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


COLLECTION_NAME = os.getenv("FIRESTORE_ANALYSES_COLLECTION", "revieweros_analyses")


def get_firestore_client():
    try:
        from google.cloud import firestore

        return firestore.Client()
    except Exception as error:
        print(f"[Firestore] Disabled or unavailable: {error}")
        return None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_user_id(user_id: Optional[str]) -> str:
    if not user_id:
        return "demo-user"

    cleaned = user_id.strip().lower()

    if not cleaned:
        return "demo-user"

    allowed = []

    for char in cleaned:
        if char.isalnum() or char in ["@", ".", "-", "_"]:
            allowed.append(char)
        else:
            allowed.append("-")

    return "".join(allowed)[:120]


def build_analysis_summary(
    job_id: str,
    file_name: str,
    result: Dict[str, Any],
    report_path: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    safe_user_id = normalize_user_id(user_id)

    chair = result.get("chair_decision", {}) or {}
    risk = result.get("risk_review", {}) or {}
    integrity = result.get("integrity_review", {}) or {}
    telemetry = result.get("telemetry", {}) or {}

    now = utc_now_iso()

    return {
        "job_id": job_id,
        "user_id": safe_user_id,
        "file_name": file_name,
        "created_at": now,
        "updated_at": now,
        "final_score": chair.get("final_score"),
        "recommendation": chair.get("recommendation"),
        "confidence": chair.get("confidence"),
        "risk_level": risk.get("risk_level"),
        "integrity_score": integrity.get("integrity_score"),
        "ai_generated_likelihood": integrity.get("ai_generated_likelihood"),
        "model": telemetry.get("model"),
        "tokens": telemetry.get("tokens"),
        "cost_usd": telemetry.get("cost_usd"),
        "latency_seconds": telemetry.get("latency_seconds"),
        "provider": telemetry.get("provider"),
        "agent_runtime": telemetry.get("agent_runtime"),
        "trace_id": telemetry.get("trace_id"),
        "telemetry": telemetry,
        "report_path": report_path,
        "result": result,
    }


def save_analysis(
    job_id: str,
    file_name: str,
    result: Dict[str, Any],
    report_path: Optional[str] = None,
    user_id: Optional[str] = None,
) -> bool:
    client = get_firestore_client()

    if client is None:
        return False

    payload = build_analysis_summary(
        job_id=job_id,
        file_name=file_name,
        result=result,
        report_path=report_path,
        user_id=user_id,
    )

    try:
        client.collection(COLLECTION_NAME).document(job_id).set(payload, merge=True)
        return True
    except Exception as error:
        print(f"[Firestore] Failed to save analysis {job_id}: {error}")
        return False


def get_analysis(job_id: str) -> Optional[Dict[str, Any]]:
    client = get_firestore_client()

    if client is None:
        return None

    try:
        snapshot = client.collection(COLLECTION_NAME).document(job_id).get()

        if not snapshot.exists:
            return None

        data = snapshot.to_dict() or {}

        if not data.get("user_id"):
            data["user_id"] = "demo-user"

        return data
    except Exception as error:
        print(f"[Firestore] Failed to get analysis {job_id}: {error}")
        return None


def list_analyses(limit: int = 20, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    client = get_firestore_client()

    if client is None:
        return []

    safe_user_id = normalize_user_id(user_id)

    try:
        collection = client.collection(COLLECTION_NAME)

        try:
            query = (
                collection.where("user_id", "==", safe_user_id)
                .order_by("created_at", direction="DESCENDING")
                .limit(limit)
            )

            docs = list(query.stream())

        except Exception as indexed_error:
            print(
                "[Firestore] User-scoped indexed query failed; "
                f"falling back to local filter: {indexed_error}"
            )

            query = collection.order_by("created_at", direction="DESCENDING").limit(limit * 5)
            docs = [
                doc
                for doc in query.stream()
                if normalize_user_id((doc.to_dict() or {}).get("user_id")) == safe_user_id
            ][:limit]

        analyses: List[Dict[str, Any]] = []

        for doc in docs:
            data = doc.to_dict() or {}

            analyses.append(
                {
                    "job_id": data.get("job_id") or doc.id,
                    "user_id": data.get("user_id") or "demo-user",
                    "file_name": data.get("file_name"),
                    "created_at": data.get("created_at"),
                    "final_score": data.get("final_score"),
                    "recommendation": data.get("recommendation"),
                    "confidence": data.get("confidence"),
                    "risk_level": data.get("risk_level"),
                    "integrity_score": data.get("integrity_score"),
                    "ai_generated_likelihood": data.get("ai_generated_likelihood"),
                    "model": data.get("model"),
                    "tokens": data.get("tokens"),
                    "cost_usd": data.get("cost_usd"),
                    "latency_seconds": data.get("latency_seconds"),
                }
            )

        return analyses
    except Exception as error:
        print(f"[Firestore] Failed to list analyses: {error}")
        return []


def upsert_report_path(job_id: str, report_path: str) -> bool:
    client = get_firestore_client()

    if client is None:
        return False

    try:
        client.collection(COLLECTION_NAME).document(job_id).set(
            {
                "report_path": report_path,
                "updated_at": utc_now_iso(),
            },
            merge=True,
        )
        return True
    except Exception as error:
        print(f"[Firestore] Failed to update report path {job_id}: {error}")
        return False


def migrate_missing_user_id(default_user_id: str = "demo-user", limit: int = 100) -> int:
    """
    Optional helper for old records.
    Not required for normal runtime.
    """
    client = get_firestore_client()

    if client is None:
        return 0

    safe_user_id = normalize_user_id(default_user_id)
    updated = 0

    try:
        docs = client.collection(COLLECTION_NAME).limit(limit).stream()

        for doc in docs:
            data = doc.to_dict() or {}

            if data.get("user_id"):
                continue

            doc.reference.set(
                {
                    "user_id": safe_user_id,
                    "updated_at": utc_now_iso(),
                },
                merge=True,
            )
            updated += 1

        return updated
    except Exception as error:
        print(f"[Firestore] Failed to migrate missing user_id: {error}")
        return updated