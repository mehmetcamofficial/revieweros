import time
import re
import os
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from statistics import mean, pstdev
from typing import Any, Callable


HISTORY_FILE = "reports/evalora_trace_history.jsonl"


@contextmanager
def trace_span(name: str, metadata: dict | None = None):
    """
    Basit trace span.
    Mevcut sistemle uyumlu kalması için print tabanlıdır.
    """
    start_time = time.time()
    metadata = metadata or {}

    print(f"[TRACE START] {name}")
    print(f"[TRACE METADATA] {metadata}")

    try:
        yield
    finally:
        duration = time.time() - start_time
        print(f"[TRACE END] {name} duration={duration:.2f}s")


PII_PATTERNS = {
    "email": r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    "phone": r"(\+90|0)?\s?5\d{2}[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}",
    "iban": r"\bTR\d{2}\s?(\d{4}\s?){5}\d{2}\b",
    "url": r"https?://[^\s]+",
}


def redact_pii(text: str) -> str:
    """
    Trace/log içine gitmeden önce hassas bilgileri maskeler.
    """
    if not text:
        return ""

    redacted = text

    for label, pattern in PII_PATTERNS.items():
        redacted = re.sub(
            pattern,
            f"[REDACTED_{label.upper()}]",
            redacted,
            flags=re.IGNORECASE,
        )

    return redacted


def run_agent_with_trace(
    agent_name: str,
    document_text: str,
    agent_function: Callable[[str], dict[str, Any]],
    prompt_version: str = "v1.0",
    rubric_version: str = "evalora-rubric-v1",
) -> dict[str, Any]:
    """
    Mevcut Gemini/API agent fonksiyonunu bozmadan trace katmanı ekler.

    Beklenen agent_function çıktısı:
    {
        "score": 8.2,
        "reasoning": "...",
        "model": "gemini-..."
    }
    """

    safe_text = redact_pii(document_text)

    metadata = {
        "agent_name": agent_name,
        "prompt_version": prompt_version,
        "rubric_version": rubric_version,
        "pii_redaction_enabled": True,
        "input_preview": safe_text[:300],
    }

    start_time = time.time()

    with trace_span(f"evalora.agent.{agent_name}", metadata):
        try:
            result = agent_function(safe_text)
            latency_ms = round((time.time() - start_time) * 1000, 2)

            score = float(result.get("score", 0))
            reasoning = result.get("reasoning", "")
            model = result.get("model", "unknown")

            traced_result = {
                "agent_name": agent_name,
                "score": score,
                "reasoning": reasoning,
                "model": model,
                "latency_ms": latency_ms,
                "prompt_version": prompt_version,
                "rubric_version": rubric_version,
                "status": "success",
            }

            print(f"[AGENT RESULT] {json.dumps(traced_result, ensure_ascii=False)}")
            return traced_result

        except Exception as error:
            latency_ms = round((time.time() - start_time) * 1000, 2)

            error_result = {
                "agent_name": agent_name,
                "score": 0,
                "reasoning": "",
                "model": "unknown",
                "latency_ms": latency_ms,
                "prompt_version": prompt_version,
                "rubric_version": rubric_version,
                "status": "error",
                "error": str(error),
            }

            print(f"[AGENT ERROR] {json.dumps(error_result, ensure_ascii=False)}")
            return error_result


def calculate_agent_disagreement(agent_results: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Agent skorları birbirinden çok farklıysa risk sinyali üretir.
    """

    scores = [
        float(agent["score"])
        for agent in agent_results
        if agent.get("status") == "success"
    ]

    if len(scores) < 2:
        return {
            "risk_level": "insufficient_data",
            "score_range": 0,
            "score_std": 0,
            "message": "Not enough successful agent results.",
        }

    score_range = max(scores) - min(scores)
    score_std = pstdev(scores)

    if score_range >= 3 or score_std >= 1.4:
        risk_level = "high"
    elif score_range >= 1.5 or score_std >= 0.8:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "risk_level": risk_level,
        "score_range": round(score_range, 2),
        "score_std": round(score_std, 2),
        "message": f"Agent disagreement risk is {risk_level}.",
    }


def save_trace_history(record: dict[str, Any]) -> None:
    """
    Drift analizi için geçmiş değerlendirmeleri JSONL olarak saklar.
    """

    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)

    with open(HISTORY_FILE, "a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_trace_history() -> list[dict[str, Any]]:
    if not os.path.exists(HISTORY_FILE):
        return []

    records = []

    with open(HISTORY_FILE, "r", encoding="utf-8") as file:
        for line in file:
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    return records


def detect_score_drift(current_average_score: float) -> dict[str, Any]:
    """
    Basit drift kontrolü.
    Son değerlendirmelerin ortalaması ile mevcut skoru karşılaştırır.
    """

    records = load_trace_history()

    if len(records) < 5:
        return {
            "drift_detected": False,
            "drift_level": "insufficient_data",
            "message": "Not enough historical evaluations for drift detection.",
        }

    previous_scores = [
        float(record["average_score"])
        for record in records[-20:]
        if "average_score" in record
    ]

    if not previous_scores:
        return {
            "drift_detected": False,
            "drift_level": "insufficient_data",
            "message": "No previous average scores found.",
        }

    baseline_average = mean(previous_scores)
    difference = abs(current_average_score - baseline_average)

    if difference >= 2:
        drift_level = "high"
        drift_detected = True
    elif difference >= 1:
        drift_level = "medium"
        drift_detected = True
    else:
        drift_level = "low"
        drift_detected = False

    return {
        "drift_detected": drift_detected,
        "drift_level": drift_level,
        "baseline_average": round(baseline_average, 2),
        "current_average": round(current_average_score, 2),
        "difference": round(difference, 2),
    }


def finalize_evalora_trace(
    submission_id: str,
    agent_results: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Tüm agent sonuçlarını birleştirir:
    - average score
    - disagreement
    - drift
    - production signals
    """

    successful_scores = [
        float(agent["score"])
        for agent in agent_results
        if agent.get("status") == "success"
    ]

    average_score = round(mean(successful_scores), 2) if successful_scores else 0

    disagreement = calculate_agent_disagreement(agent_results)
    drift = detect_score_drift(average_score)

    final_result = {
        "submission_id": submission_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "average_score": average_score,
        "agent_results": agent_results,
        "disagreement": disagreement,
        "drift": drift,
        "production_signals": {
            "pii_redaction_enabled": True,
            "agent_disagreement_tracking": True,
            "drift_tracking": True,
            "prompt_versioning": True,
            "rubric_versioning": True,
        },
    }

    save_trace_history(
        {
            "submission_id": submission_id,
            "created_at": final_result["created_at"],
            "average_score": average_score,
            "disagreement_risk": disagreement["risk_level"],
            "disagreement_range": disagreement["score_range"],
            "drift_level": drift["drift_level"],
            "agent_scores": {
                agent["agent_name"]: agent["score"]
                for agent in agent_results
            },
        }
    )

    print(f"[EVALORA FINAL TRACE] {json.dumps(final_result, ensure_ascii=False)}")

    return final_result
