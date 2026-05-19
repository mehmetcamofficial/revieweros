from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


COLLECTION_NAME = os.getenv("FIRESTORE_ANALYSES_COLLECTION", "revieweros_analyses")


def firestore_enabled() -> bool:
    try:
        from google.cloud import firestore  # noqa: F401

        return True
    except Exception:
        return False


def get_firestore_client():
    try:
        from google.cloud import firestore

        return firestore.Client()
    except Exception as error:
        print(f"[Firestore] Disabled or unavailable: {error}")
        return None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_get(data: Dict[str, Any], path: List[str], fallback: Any = None) -> Any:
    current: Any = data

    for key in path:
        if not isinstance(current, dict):
            return fallback
        current = current.get(key)

    return current if current is not None else fallback


def build_analysis_summary(
    job_id: str,
    file_name: str,
    result: Dict[str, Any],
    report_path: Optional[str] = None,
) -> Dict[str, Any]:
    chair = result.get("chair_decision", {}) or {}
    risk = result.get("risk_review", {}) or {}
    integrity = result.get("integrity_review", {}) or {}
    telemetry = result.get("telemetry", {}) or {}

    return {
        "job_id": job_id,
        "file_name": file_name,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "final_score": chair.get("final_score"),
        "recommendation": chair.get("recommendation"),
        "confidence": chair.get("confidence"),
        "risk_level": risk.get("risk_level"),
        "integrity_score": integrity.get("integrity_score"),
        "ai_generated_likelihood": integrity.get("ai_generated_likelihood"),
        "model": telemetry.get("model"),
        "tokens": telemetry.get("tokens"),
        "latency_seconds": telemetry.get("latency_seconds"),
        "report_path": report_path,
        "result": result,
    }


def save_analysis(
    job_id: str,
    file_name: str,
    result: Dict[str, Any],
    report_path: Optional[str] = None,
) -> bool:
    client = get_firestore_client()

    if client is None:
        return False

    payload = build_analysis_summary(
        job_id=job_id,
        file_name=file_name,
        result=result,
        report_path=report_path,
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

        return snapshot.to_dict()
    except Exception as error:
        print(f"[Firestore] Failed to get analysis {job_id}: {error}")
        return None


def list_analyses(limit: int = 20) -> List[Dict[str, Any]]:
    client = get_firestore_client()

    if client is None:
        return []

    try:
        query = (
            client.collection(COLLECTION_NAME)
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
        )

        docs = query.stream()
        analyses: List[Dict[str, Any]] = []

        for doc in docs:
            data = doc.to_dict() or {}

            analyses.append(
                {
                    "job_id": data.get("job_id") or doc.id,
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