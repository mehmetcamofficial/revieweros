import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, List

from dotenv import load_dotenv
from google import genai

from services.arize_trace import trace_span

load_dotenv()

GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "revieweros-prod")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "europe-west1")

DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")

MODEL_SCIENTIFIC = os.getenv("MODEL_SCIENTIFIC", DEFAULT_MODEL)
MODEL_COMMERCIAL = os.getenv("MODEL_COMMERCIAL", DEFAULT_MODEL)
MODEL_RISK = os.getenv("MODEL_RISK", DEFAULT_MODEL)
MODEL_INTEGRITY = os.getenv("MODEL_INTEGRITY", DEFAULT_MODEL)
MODEL_CHAIR = os.getenv("MODEL_CHAIR", DEFAULT_MODEL)

client = genai.Client(
    vertexai=True,
    project=GOOGLE_CLOUD_PROJECT,
    location=GOOGLE_CLOUD_LOCATION,
)

SCORING_RUBRIC = """
Score calibration:
- 1-3: Severe failure. Not fundable or not credible in current form.
- 4-5: Weak but potentially recoverable. Significant issues, but the concept may still have merit.
- 6: Average early-stage proposal. Needs revision but has a credible foundation.
- 7: Good proposal. Clear strengths, manageable weaknesses.
- 8-9: Strong proposal. High confidence, strong execution readiness.
- 10: Rare exceptional case.

Do not over-penalize early-stage applications merely because they are incomplete.
Use "Revise" when the core idea is promising but execution details are weak.
Use "Reject" only when feasibility, ethics, team capability, evidence, or risk issues are fundamental.
Use the full scoring range.
"""

CHAIR_DECISION_RUBRIC = """
Decision calibration:
- Reject: severe feasibility, evidence, team, regulatory, ethics, or execution problems.
- Revise: promising concept but substantial improvements are needed before funding or advancement.
- Advance: credible, fundable, and execution-ready with manageable risks.

Do not automatically reject early-stage proposals.
If scores are mixed and the idea is promising, prefer "Revise" over "Reject".
"""


def clean_json_response(text: str) -> str:
    text = (text or "").strip()

    if text.startswith("```json"):
        text = text.replace("```json", "", 1).strip()

    if text.startswith("```"):
        text = text.replace("```", "", 1).strip()

    if text.endswith("```"):
        text = text[:-3].strip()

    return text


def extract_json_object(text: str) -> str:
    cleaned = clean_json_response(text)

    if cleaned.startswith("{") and cleaned.endswith("}"):
        return cleaned

    match = re.search(r"\{[\s\S]*\}", cleaned)
    if match:
        return match.group(0)

    return cleaned


def safe_generate(
    prompt: str,
    model: str = DEFAULT_MODEL,
    retries: int = 3,
    max_output_tokens: int = 1200,
    temperature: float = 0.2,
) -> str:
    last_error = None

    for attempt in range(retries):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "max_output_tokens": max_output_tokens,
                    "temperature": temperature,
                },
            )
            return response.text or ""

        except Exception as error:
            last_error = error
            error_text = str(error)

            if "429" in error_text or "RESOURCE_EXHAUSTED" in error_text:
                wait_time = (attempt + 1) * 8
                print(f"[VERTEX RATE LIMIT] Waiting {wait_time}s before retry...")
                time.sleep(wait_time)
                continue

            if "503" in error_text or "UNAVAILABLE" in error_text:
                wait_time = (attempt + 1) * 5
                print(f"[VERTEX TEMPORARY ERROR] Waiting {wait_time}s before retry...")
                time.sleep(wait_time)
                continue

            raise error

    raise Exception(f"Vertex Gemini generation failed after retries: {last_error}")


def call_gemini_json(
    prompt: str,
    model: str = DEFAULT_MODEL,
    max_output_tokens: int = 1200,
    temperature: float = 0.2,
) -> dict:
    try:
        text = safe_generate(
            prompt=prompt,
            model=model,
            retries=3,
            max_output_tokens=max_output_tokens,
            temperature=temperature,
        )
        cleaned = extract_json_object(text)
        return json.loads(cleaned)

    except Exception as error:
        return {
            "parse_error": True,
            "error": str(error),
            "raw_response": "",
        }


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def clamp(value: Any, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except Exception:
        number = default

    return max(low, min(high, number))


def build_standard_fallback(agent_name: str, error: str) -> dict:
    return {
        "agent": agent_name,
        "score": 4,
        "strengths": [
            "The application contains enough information to support a preliminary assessment."
        ],
        "weaknesses": [
            "The reviewer output could not be fully generated."
        ],
        "risks": [
            "Manual review is recommended before making a final decision."
        ],
        "confidence": 0.35,
        "error": error,
        "justification": (
            f"{agent_name} could not complete a full model-based review. "
            "ReviewerOS generated a conservative fallback assessment to preserve the workflow."
        ),
    }


def build_risk_fallback(error: str) -> dict:
    return {
        "agent": "Risk Reviewer",
        "risk_level": "High",
        "score": 8,
        "major_risks": [
            "Risk reviewer output could not be fully generated.",
            "Manual risk review is recommended."
        ],
        "inconsistencies": [],
        "ethics_flags": [],
        "confidence": 0.35,
        "error": error,
        "justification": (
            "Risk Reviewer could not complete a full model-based review. "
            "ReviewerOS conservatively marked the risk profile as High until manual verification."
        ),
    }


def build_integrity_fallback(error: str) -> dict:
    return {
        "agent": "Integrity Reviewer",
        "integrity_score": 4,
        "ai_generated_likelihood": "Unknown",
        "unsupported_claims": [],
        "red_flags": [
            "Integrity reviewer output could not be fully generated."
        ],
        "contradictions": [],
        "confidence": 0.35,
        "error": error,
        "justification": (
            "Integrity Reviewer could not complete a full model-based review. "
            "Manual verification is recommended for claims, ethics, and data governance."
        ),
    }


def normalize_standard_review(result: dict, agent_name: str) -> dict:
    if not isinstance(result, dict):
        return build_standard_fallback(agent_name, "Reviewer returned a non-dict response.")

    if result.get("parse_error"):
        return build_standard_fallback(agent_name, result.get("error", "Parse error."))

    return {
        "agent": result.get("agent", agent_name),
        "score": clamp(result.get("score"), 1, 10, 5),
        "strengths": safe_list(result.get("strengths")),
        "weaknesses": safe_list(result.get("weaknesses")),
        "risks": safe_list(result.get("risks")),
        "confidence": clamp(result.get("confidence"), 0, 1, 0.7),
        "justification": result.get("justification", "No justification available."),
    }


def normalize_risk_review(result: dict) -> dict:
    if not isinstance(result, dict):
        return build_risk_fallback("Risk reviewer returned a non-dict response.")

    if result.get("parse_error"):
        return build_risk_fallback(result.get("error", "Parse error."))

    risk_score = clamp(result.get("score"), 1, 10, 5)
    risk_level = result.get("risk_level")

    if not risk_level:
        if risk_score >= 7:
            risk_level = "High"
        elif risk_score >= 4:
            risk_level = "Medium"
        else:
            risk_level = "Low"

    return {
        "agent": result.get("agent", "Risk Reviewer"),
        "risk_level": risk_level,
        "score": risk_score,
        "major_risks": safe_list(result.get("major_risks")),
        "inconsistencies": safe_list(result.get("inconsistencies")),
        "ethics_flags": safe_list(result.get("ethics_flags")),
        "confidence": clamp(result.get("confidence"), 0, 1, 0.75),
        "justification": result.get("justification", "No justification available."),
    }


def normalize_integrity_review(result: dict) -> dict:
    if not isinstance(result, dict):
        return build_integrity_fallback("Integrity reviewer returned a non-dict response.")

    if result.get("parse_error"):
        return build_integrity_fallback(result.get("error", "Parse error."))

    return {
        "agent": result.get("agent", "Integrity Reviewer"),
        "integrity_score": clamp(result.get("integrity_score"), 1, 10, 5),
        "ai_generated_likelihood": result.get("ai_generated_likelihood", "Low"),
        "unsupported_claims": safe_list(result.get("unsupported_claims")),
        "red_flags": safe_list(result.get("red_flags")),
        "contradictions": safe_list(result.get("contradictions")),
        "confidence": clamp(result.get("confidence"), 0, 1, 0.7),
        "justification": result.get("justification", "No justification available."),
    }


def scientific_reviewer(application_text: str) -> dict:
    result = call_gemini_json(
        model=MODEL_SCIENTIFIC,
        max_output_tokens=1050,
        temperature=0.15,
        prompt=f"""
You are the Scientific Reviewer in a specialized multi-agent evaluation panel.

Evaluate ONLY scientific and technical quality.

Focus:
- methodology
- novelty
- feasibility
- validation plan
- reproducibility
- research design
- technical soundness
- evidence quality
- clinical or scientific plausibility

Avoid:
- market size language
- pricing language
- go-to-market analysis
- generic business commentary

{SCORING_RUBRIC}

Return valid JSON only.

Schema:
{{
  "agent": "Scientific Reviewer",
  "score": 6,
  "strengths": ["specific scientific strength"],
  "weaknesses": ["specific scientific weakness"],
  "risks": ["specific scientific or technical risk"],
  "confidence": 0.7,
  "justification": "Scientific rationale in 90-140 words."
}}

Application:
{application_text[:9000]}
""",
    )

    return normalize_standard_review(result, "Scientific Reviewer")


def commercial_reviewer(application_text: str) -> dict:
    result = call_gemini_json(
        model=MODEL_COMMERCIAL,
        max_output_tokens=950,
        temperature=0.2,
        prompt=f"""
You are the Commercial Reviewer in a specialized multi-agent evaluation panel.

Evaluate ONLY commercialization readiness.

Focus:
- customer pain
- target users
- market need
- go-to-market realism
- business model
- pricing logic
- scalability
- competitive advantage / moat
- adoption barriers
- sales, procurement, or partnership risk
- budget realism from a business execution view

Avoid:
- deep scientific methodology critique
- academic grant-review language
- repeating the Scientific Reviewer

{SCORING_RUBRIC}

Return valid JSON only.

Schema:
{{
  "agent": "Commercial Reviewer",
  "score": 6,
  "strengths": ["specific commercial strength"],
  "weaknesses": ["specific commercial weakness"],
  "risks": ["specific commercial or market risk"],
  "confidence": 0.7,
  "justification": "Commercial rationale in 90-140 words."
}}

Application:
{application_text[:9000]}
""",
    )

    return normalize_standard_review(result, "Commercial Reviewer")


def risk_reviewer(application_text: str) -> dict:
    result = call_gemini_json(
        model=MODEL_RISK,
        max_output_tokens=950,
        temperature=0.1,
        prompt=f"""
You are the Risk Reviewer in a specialized multi-agent evaluation panel.

Evaluate ONLY risk.

Risk score:
- 1-3: Low risk
- 4-6: Medium risk
- 7-10: High risk

Focus:
- unrealistic timelines
- unsupported claims
- missing budget logic
- regulatory pathway gaps
- team capability gaps
- operational risks
- privacy and compliance risks
- consent / anonymization / safety gaps
- dependencies and implementation risks

Do not repeat the Scientific or Commercial Reviewer.
Be direct, concrete, and risk-focused.

Return valid JSON only.

Schema:
{{
  "agent": "Risk Reviewer",
  "risk_level": "Medium",
  "score": 5,
  "major_risks": ["specific risk"],
  "inconsistencies": ["specific inconsistency"],
  "ethics_flags": ["specific ethics/privacy flag"],
  "confidence": 0.8,
  "justification": "Risk rationale in 90-140 words."
}}

Application:
{application_text[:9000]}
""",
    )

    return normalize_risk_review(result)


def integrity_reviewer(application_text: str) -> dict:
    result = call_gemini_json(
        model=MODEL_INTEGRITY,
        max_output_tokens=850,
        temperature=0.1,
        prompt=f"""
You are the Integrity Reviewer in a specialized multi-agent evaluation panel.

Evaluate ONLY claim integrity, evidence traceability, AI-generated writing risk, ethics, and data governance.

Integrity score:
- 1-3: Low integrity / many unsupported claims or serious gaps
- 4-5: Weak integrity / several missing details
- 6: Acceptable but incomplete
- 7-8: Strong integrity with mostly supported claims
- 9-10: Excellent traceability and evidence discipline

Focus:
- unsupported claims
- vague or inflated metrics
- fabricated-looking claims
- excessive buzzwords
- impossible timelines
- missing evidence
- AI-generated writing patterns
- internal contradictions
- data governance
- consent, anonymization, privacy, and ethical safeguards

Return valid JSON only.

Schema:
{{
  "agent": "Integrity Reviewer",
  "integrity_score": 6,
  "ai_generated_likelihood": "Low",
  "unsupported_claims": ["specific unsupported claim"],
  "red_flags": ["specific integrity red flag"],
  "contradictions": ["specific contradiction"],
  "confidence": 0.7,
  "justification": "Integrity rationale in 90-140 words."
}}

Application:
{application_text[:9000]}
""",
    )

    return normalize_integrity_review(result)


def deterministic_chair_fallback(
    scientific: dict,
    commercial: dict,
    risk: dict,
    integrity: dict,
    error: str = "",
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
        "chair_error": error,
    }


def normalize_chair_result(
    result: dict,
    scientific: dict,
    commercial: dict,
    risk: dict,
    integrity: dict,
) -> dict:
    if not isinstance(result, dict) or result.get("parse_error"):
        return deterministic_chair_fallback(
            scientific=scientific,
            commercial=commercial,
            risk=risk,
            integrity=integrity,
            error=result.get("error", "Chair Agent parse error") if isinstance(result, dict) else "Invalid chair response",
        )

    final_score = clamp(result.get("final_score"), 1, 10, 5)

    return {
        "agent": result.get("agent", "Chair Agent"),
        "final_score": round(final_score, 1),
        "recommendation": result.get("recommendation", "Review Required"),
        "summary": result.get("summary", "No executive summary available."),
        "top_strengths": safe_list(result.get("top_strengths")),
        "top_weaknesses": safe_list(result.get("top_weaknesses")),
        "top_risks": safe_list(result.get("top_risks")),
        "integrity_notes": safe_list(result.get("integrity_notes")),
        "final_feedback": result.get("final_feedback", "No final feedback available."),
        "confidence": clamp(result.get("confidence"), 0, 1, 0.75),
        "synthesis_mode": result.get("synthesis_mode", "ai_synthesis"),
    }


def chair_agent(
    application_text: str,
    scientific: dict,
    commercial: dict,
    risk: dict,
    integrity: dict,
) -> dict:
    result = call_gemini_json(
        model=MODEL_CHAIR,
        max_output_tokens=1400,
        temperature=0.15,
        prompt=f"""
You are the Chair Agent of a multi-agent evaluation panel.

Synthesize the reviewer outputs into a final board-style decision.

Rules:
- Be firm but not unnecessarily negative.
- Preserve nuance.
- Do not invent facts.
- Distinguish clearly between Reject, Revise, and Advance.
- If the core concept is promising but execution details are weak, use "Revise".
- Use "Reject" only when the application has fundamental feasibility, team, ethics, evidence, or execution problems.
- Avoid generic feedback.

{CHAIR_DECISION_RUBRIC}

Final score:
- 1-3: not fundable / severe concerns
- 4-5: weak but recoverable
- 6: revision needed
- 7: good
- 8-9: strong
- 10: exceptional

Return valid JSON only.

Schema:
{{
  "agent": "Chair Agent",
  "final_score": 6,
  "recommendation": "Revise",
  "summary": "Executive summary in 100-160 words.",
  "top_strengths": ["strength"],
  "top_weaknesses": ["weakness"],
  "top_risks": ["risk"],
  "integrity_notes": ["integrity note"],
  "final_feedback": "Final board-style feedback in 120-220 words.",
  "confidence": 0.8,
  "synthesis_mode": "ai_synthesis"
}}

Scientific Review:
{json.dumps(scientific, ensure_ascii=False)}

Commercial Review:
{json.dumps(commercial, ensure_ascii=False)}

Risk Review:
{json.dumps(risk, ensure_ascii=False)}

Integrity Review:
{json.dumps(integrity, ensure_ascii=False)}

Application excerpt:
{application_text[:4000]}
""",
    )

    return normalize_chair_result(result, scientific, commercial, risk, integrity)


def safe_agent_call(agent_name: str, fn):
    try:
        return fn()
    except Exception as error:
        if agent_name == "Risk Reviewer":
            return build_risk_fallback(str(error))

        if agent_name == "Integrity Reviewer":
            return build_integrity_fallback(str(error))

        return build_standard_fallback(agent_name, str(error))


def run_reviewer_panel(application_text: str, file_name: str, job_id: str) -> dict:
    def run_scientific():
        with trace_span("scientific_reviewer", {"job_id": job_id, "file_name": file_name}):
            return scientific_reviewer(application_text)

    def run_commercial():
        with trace_span("commercial_reviewer", {"job_id": job_id, "file_name": file_name}):
            return commercial_reviewer(application_text)

    def run_risk():
        with trace_span("risk_reviewer", {"job_id": job_id, "file_name": file_name}):
            return risk_reviewer(application_text)

    def run_integrity():
        with trace_span("integrity_reviewer", {"job_id": job_id, "file_name": file_name}):
            return integrity_reviewer(application_text)

    with ThreadPoolExecutor(max_workers=4) as executor:
        scientific_future = executor.submit(lambda: safe_agent_call("Scientific Reviewer", run_scientific))
        commercial_future = executor.submit(lambda: safe_agent_call("Commercial Reviewer", run_commercial))
        risk_future = executor.submit(lambda: safe_agent_call("Risk Reviewer", run_risk))
        integrity_future = executor.submit(lambda: safe_agent_call("Integrity Reviewer", run_integrity))

        scientific = scientific_future.result()
        commercial = commercial_future.result()
        risk = risk_future.result()
        integrity = integrity_future.result()

    with trace_span("chair_agent", {"job_id": job_id, "file_name": file_name}):
        chair = safe_agent_call(
            "Chair Agent",
            lambda: chair_agent(
                application_text=application_text,
                scientific=scientific,
                commercial=commercial,
                risk=risk,
                integrity=integrity,
            ),
        )

    return {
        "job_id": job_id,
        "file_name": file_name,
        "scientific_review": scientific,
        "commercial_review": commercial,
        "risk_review": risk,
        "integrity_review": integrity,
        "chair_decision": chair,
    }