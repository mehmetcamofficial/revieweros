import asyncio
import os
import time
from typing import Any, Dict

from services.gemini import (
    scientific_reviewer,
    commercial_reviewer,
    risk_reviewer,
    integrity_reviewer,
    chair_agent,
)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")


def estimate_tokens(text: Any) -> int:
    return max(1, int(len(str(text)) / 4))


def estimate_cost_usd(tokens: int) -> float:
    return round((tokens / 1_000_000) * 0.35, 6)


async def safe_send(websocket, payload: dict):
    try:
        await websocket.send_json(payload)
    except Exception as error:
        print("[WEBSOCKET SEND ERROR]", str(error))


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def safe_list(value):
    return value if isinstance(value, list) else []


def build_agent_fallback(agent_key: str, agent_label: str, error: str) -> dict:
    if agent_key == "risk_review":
        return {
            "agent": agent_label,
            "risk_level": "High",
            "score": 8,
            "major_risks": [
                "Reviewer execution failed or quota was exhausted.",
                "Manual risk review is recommended."
            ],
            "inconsistencies": [],
            "ethics_flags": [],
            "confidence": 0.35,
            "error": error,
            "justification": (
                f"{agent_label} could not complete because the AI provider returned an error. "
                "ReviewerOS preserved the workflow and conservatively marked the risk level as High."
            ),
        }

    if agent_key == "integrity_review":
        return {
            "agent": agent_label,
            "integrity_score": 4,
            "ai_generated_likelihood": "Unknown",
            "unsupported_claims": [],
            "red_flags": [
                "Integrity reviewer failed or quota was exhausted."
            ],
            "contradictions": [],
            "confidence": 0.35,
            "error": error,
            "justification": (
                f"{agent_label} could not complete because the AI provider returned an error. "
                "Manual integrity review is recommended."
            ),
        }

    return {
        "agent": agent_label,
        "score": 4,
        "strengths": [
            "The proposal contains enough information to support a preliminary assessment."
        ],
        "weaknesses": [
            "Reviewer failed or quota was exhausted."
        ],
        "risks": [
            "Manual review is recommended."
        ],
        "confidence": 0.35,
        "error": error,
        "justification": (
            f"{agent_label} could not complete because the AI provider returned an error. "
            "ReviewerOS continued the workflow using a conservative fallback result."
        ),
    }


async def run_agent_event(
    websocket,
    agent_key: str,
    agent_label: str,
    fn,
    application_text: str,
    telemetry: Dict[str, Any],
):
    start = time.time()

    await safe_send(
        websocket,
        {
            "type": "agent_started",
            "agent_key": agent_key,
            "agent_label": agent_label,
            "message": f"{agent_label} started.",
            "telemetry": telemetry,
        },
    )

    try:
        result = await asyncio.to_thread(fn, application_text)

        if not isinstance(result, dict):
            raise ValueError(f"{agent_label} returned a non-dict response.")

        if result.get("parse_error"):
            raise ValueError(result.get("error", f"{agent_label} parse error."))

        duration = round(time.time() - start, 2)
        tokens = estimate_tokens(application_text[:9000]) + estimate_tokens(result)

        telemetry["tokens"] += tokens
        telemetry["cost_usd"] += estimate_cost_usd(tokens)

        await safe_send(
            websocket,
            {
                "type": "agent_completed",
                "agent_key": agent_key,
                "agent_label": agent_label,
                "duration_seconds": duration,
                "tokens": tokens,
                "result": result,
                "message": f"{agent_label} completed in {duration}s.",
                "telemetry": telemetry,
            },
        )

        return result

    except Exception as error:
        duration = round(time.time() - start, 2)
        error_text = str(error)

        fallback = build_agent_fallback(
            agent_key=agent_key,
            agent_label=agent_label,
            error=error_text,
        )

        tokens = estimate_tokens(application_text[:2000]) + estimate_tokens(fallback)
        telemetry["tokens"] += tokens
        telemetry["cost_usd"] += estimate_cost_usd(tokens)

        await safe_send(
            websocket,
            {
                "type": "agent_failed",
                "agent_key": agent_key,
                "agent_label": agent_label,
                "duration_seconds": duration,
                "tokens": tokens,
                "error": error_text,
                "result": fallback,
                "message": f"{agent_label} failed, fallback result generated.",
                "telemetry": telemetry,
            },
        )

        return fallback


def safe_chair_fallback(
    error: Exception,
    scientific: dict,
    commercial: dict,
    risk: dict,
    integrity: dict,
) -> dict:
    scientific_score = safe_float(scientific.get("score", 4))
    commercial_score = safe_float(commercial.get("score", 4))
    risk_score = safe_float(risk.get("score", 8))
    integrity_score = safe_float(integrity.get("integrity_score", 4))

    risk_level = str(risk.get("risk_level", "High")).lower()

    final_score = round(
        (scientific_score * 0.35)
        + (commercial_score * 0.25)
        + ((10 - risk_score) * 0.25)
        + (integrity_score * 0.15),
        1,
    )

    if "high" in risk_level and final_score < 5.5:
        recommendation = "Reject"
    elif final_score < 6.5:
        recommendation = "Revise"
    else:
        recommendation = "Advance"

    top_strengths = safe_list(scientific.get("strengths"))[:2] + safe_list(commercial.get("strengths"))[:2]
    top_weaknesses = safe_list(scientific.get("weaknesses"))[:2] + safe_list(commercial.get("weaknesses"))[:2]
    top_risks = safe_list(risk.get("major_risks"))[:5] + safe_list(risk.get("risks"))[:3]
    integrity_notes = safe_list(integrity.get("unsupported_claims"))[:3] + safe_list(integrity.get("red_flags"))[:3]

    return {
        "agent": "Chair Agent",
        "final_score": final_score,
        "recommendation": recommendation,
        "summary": (
            "ReviewerOS completed the multi-agent evaluation. The proposal has identifiable strengths, "
            "but the panel found execution, evidence, risk, or integrity issues that affect readiness."
        ),
        "top_strengths": top_strengths or ["The proposal has a potentially relevant concept."],
        "top_weaknesses": top_weaknesses or ["The proposal needs stronger execution detail."],
        "top_risks": top_risks or ["Manual risk review is recommended."],
        "integrity_notes": integrity_notes or ["Manual integrity verification is recommended."],
        "final_feedback": (
            "The application should be revised before funding or advancement. Priority improvements include "
            "a realistic execution plan, stronger validation evidence, clearer budget logic, stronger team capability, "
            "and more complete ethical and data governance detail."
        ),
        "confidence": 0.7,
        "synthesis_mode": "deterministic_fallback",
        "chair_error": str(error),
    }


async def run_streaming_review(websocket, application_text: str, file_name: str, job_id: str):
    overall_start = time.time()

    telemetry = {
        "model": GEMINI_MODEL,
        "tokens": 0,
        "cost_usd": 0.0,
        "active_agents": 0,
        "latency_seconds": 0,
    }

    await safe_send(
        websocket,
        {
            "type": "session_started",
            "job_id": job_id,
            "file_name": file_name,
            "message": "ReviewerOS streaming session started.",
            "telemetry": telemetry,
        },
    )

    # Limited concurrency:
    # Wave 1: Scientific + Commercial
    telemetry["active_agents"] = 2
    scientific_task = run_agent_event(
        websocket,
        "scientific_review",
        "Scientific Reviewer",
        scientific_reviewer,
        application_text,
        telemetry,
    )

    commercial_task = run_agent_event(
        websocket,
        "commercial_review",
        "Commercial Reviewer",
        commercial_reviewer,
        application_text,
        telemetry,
    )

    scientific, commercial = await asyncio.gather(scientific_task, commercial_task)

    await asyncio.sleep(1.5)

    # Wave 2: Risk + Integrity
    telemetry["active_agents"] = 2
    risk_task = run_agent_event(
        websocket,
        "risk_review",
        "Risk Reviewer",
        risk_reviewer,
        application_text,
        telemetry,
    )

    integrity_task = run_agent_event(
        websocket,
        "integrity_review",
        "Integrity Reviewer",
        integrity_reviewer,
        application_text,
        telemetry,
    )

    risk, integrity = await asyncio.gather(risk_task, integrity_task)

    await asyncio.sleep(0.5)

    telemetry["active_agents"] = 1

    await safe_send(
        websocket,
        {
            "type": "chair_started",
            "agent_key": "chair_decision",
            "agent_label": "Chair Agent",
            "message": "Chair Agent is synthesizing the final decision.",
            "telemetry": telemetry,
        },
    )

    chair_start = time.time()

    try:
        chair = await asyncio.to_thread(
            chair_agent,
            application_text,
            scientific,
            commercial,
            risk,
            integrity,
        )

        if not isinstance(chair, dict):
            raise ValueError("Chair Agent returned a non-dict response.")

        if chair.get("parse_error"):
            raise ValueError(chair.get("error", "Chair Agent parse error."))

    except Exception as error:
        print("[CHAIR ERROR]", str(error))
        chair = safe_chair_fallback(
            error=error,
            scientific=scientific,
            commercial=commercial,
            risk=risk,
            integrity=integrity,
        )

    chair_duration = round(time.time() - chair_start, 2)
    chair_tokens = estimate_tokens(application_text[:4000]) + estimate_tokens(chair)

    telemetry["tokens"] += chair_tokens
    telemetry["cost_usd"] += estimate_cost_usd(chair_tokens)
    telemetry["active_agents"] = 0
    telemetry["latency_seconds"] = round(time.time() - overall_start, 2)
    telemetry["cost_usd"] = round(telemetry["cost_usd"], 6)

    result = {
        "job_id": job_id,
        "file_name": file_name,
        "scientific_review": scientific,
        "commercial_review": commercial,
        "risk_review": risk,
        "integrity_review": integrity,
        "chair_decision": chair,
        "telemetry": telemetry,
    }

    await safe_send(
        websocket,
        {
            "type": "chair_completed",
            "agent_key": "chair_decision",
            "agent_label": "Chair Agent",
            "duration_seconds": chair_duration,
            "tokens": chair_tokens,
            "result": chair,
            "message": f"Chair Agent completed in {chair_duration}s.",
            "telemetry": telemetry,
        },
    )

    await safe_send(
        websocket,
        {
            "type": "session_completed",
            "job_id": job_id,
            "file_name": file_name,
            "result": result,
            "telemetry": telemetry,
            "message": "ReviewerOS streaming session completed.",
        },
    )