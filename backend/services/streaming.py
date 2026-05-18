import asyncio
import time
from typing import Any, Dict

from services.gemini import (
    scientific_reviewer,
    commercial_reviewer,
    risk_reviewer,
    integrity_reviewer,
    chair_agent,
)


def estimate_tokens(text: str) -> int:
    return max(1, int(len(text) / 4))


def estimate_cost_usd(tokens: int) -> float:
    # Demo estimate for Gemini Flash-like usage.
    # Real pricing can be replaced later with exact model pricing.
    return round((tokens / 1_000_000) * 0.35, 6)


async def run_agent_event(
    websocket,
    agent_key: str,
    agent_label: str,
    fn,
    application_text: str,
    telemetry: Dict[str, Any],
):
    start = time.time()

    await websocket.send_json({
        "type": "agent_started",
        "agent_key": agent_key,
        "agent_label": agent_label,
        "message": f"{agent_label} started."
    })

    try:
        result = await asyncio.to_thread(fn, application_text)
        duration = round(time.time() - start, 2)

        tokens = estimate_tokens(application_text) + estimate_tokens(str(result))
        telemetry["tokens"] += tokens
        telemetry["cost_usd"] += estimate_cost_usd(tokens)

        await websocket.send_json({
            "type": "agent_completed",
            "agent_key": agent_key,
            "agent_label": agent_label,
            "duration_seconds": duration,
            "tokens": tokens,
            "result": result,
            "message": f"{agent_label} completed in {duration}s."
        })

        return result

    except Exception as error:
        duration = round(time.time() - start, 2)

        fallback = {
            "agent": agent_label,
            "score": 0,
            "confidence": 0,
            "error": str(error),
            "justification": f"{agent_label} failed: {str(error)}"
        }

        await websocket.send_json({
            "type": "agent_failed",
            "agent_key": agent_key,
            "agent_label": agent_label,
            "duration_seconds": duration,
            "error": str(error),
            "result": fallback,
            "message": f"{agent_label} failed."
        })

        return fallback


async def run_streaming_review(websocket, application_text: str, file_name: str, job_id: str):
    overall_start = time.time()

    telemetry = {
        "model": "gemini-2.5-flash",
        "tokens": 0,
        "cost_usd": 0.0,
        "active_agents": 4,
        "latency_seconds": 0,
    }

    await websocket.send_json({
        "type": "session_started",
        "job_id": job_id,
        "file_name": file_name,
        "message": "ReviewerOS streaming session started.",
        "telemetry": telemetry
    })

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

    scientific, commercial, risk, integrity = await asyncio.gather(
        scientific_task,
        commercial_task,
        risk_task,
        integrity_task,
    )

    telemetry["active_agents"] = 1

    await websocket.send_json({
        "type": "chair_started",
        "agent_key": "chair_decision",
        "agent_label": "Chair Agent",
        "message": "Chair Agent is synthesizing the final decision.",
        "telemetry": telemetry
    })

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
    except Exception as error:
        chair = {
            "agent": "Chair Agent",
            "final_score": 0,
            "recommendation": "Review Required",
            "summary": "Chair Agent failed to synthesize the final decision.",
            "top_strengths": [],
            "top_weaknesses": [],
            "top_risks": [],
            "integrity_notes": [],
            "final_feedback": str(error),
            "confidence": 0,
            "error": str(error),
        }

    chair_duration = round(time.time() - chair_start, 2)
    chair_tokens = estimate_tokens(application_text[:4000]) + estimate_tokens(str(chair))
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

    await websocket.send_json({
        "type": "chair_completed",
        "agent_key": "chair_decision",
        "agent_label": "Chair Agent",
        "duration_seconds": chair_duration,
        "tokens": chair_tokens,
        "result": chair,
        "message": f"Chair Agent completed in {chair_duration}s.",
        "telemetry": telemetry
    })

    await websocket.send_json({
        "type": "session_completed",
        "job_id": job_id,
        "file_name": file_name,
        "result": result,
        "telemetry": telemetry,
        "message": "ReviewerOS streaming session completed."
    })