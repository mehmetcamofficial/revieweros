import os
import json
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from google import genai

from services.arize_trace import trace_span

load_dotenv()

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


def clean_json_response(text: str) -> str:
    text = text.strip()

    if text.startswith("```json"):
        text = text.replace("```json", "", 1)
        text = text.replace("```", "")
        return text.strip()

    if text.startswith("```"):
        text = text.replace("```", "")
        return text.strip()

    return text


def call_gemini_json(prompt: str) -> dict:
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config={
            "response_mime_type": "application/json"
        }
    )

    text = clean_json_response(response.text or "")

    try:
        return json.loads(text)
    except Exception:
        return {
            "parse_error": True,
            "raw_response": text
        }


def scientific_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are a scientific grant reviewer.

Evaluate:
- novelty
- methodology
- feasibility
- evidence quality
- research design
- technical validity
- clinical or scientific soundness where relevant

Return valid JSON only.

Schema:
{{
  "agent": "Scientific Reviewer",
  "score": 1,
  "strengths": [],
  "weaknesses": [],
  "risks": [],
  "confidence": 0.0,
  "justification": ""
}}

Application:
{application_text[:12000]}
""")


def commercial_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are a commercialization reviewer.

Evaluate:
- market need
- customer pain
- business model
- scalability
- competitive advantage
- go-to-market realism
- budget realism

Return valid JSON only.

Schema:
{{
  "agent": "Commercial Reviewer",
  "score": 1,
  "strengths": [],
  "weaknesses": [],
  "risks": [],
  "confidence": 0.0,
  "justification": ""
}}

Application:
{application_text[:12000]}
""")


def risk_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are a risk and ethics reviewer.

Detect:
- unrealistic timeline
- unsupported claims
- missing budget logic
- ethics concerns
- team capability gaps
- regulatory risk
- privacy risk
- compliance risk
- patient, user, or stakeholder safety risk

Return valid JSON only.

Schema:
{{
  "agent": "Risk Reviewer",
  "risk_level": "Low",
  "score": 1,
  "major_risks": [],
  "inconsistencies": [],
  "ethics_flags": [],
  "confidence": 0.0,
  "justification": ""
}}

Application:
{application_text[:12000]}
""")


def integrity_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are an integrity and hallucination-risk reviewer.

Detect:
- vague or unsupported claims
- fabricated-looking metrics
- impossible timelines
- excessive buzzwords
- missing evidence
- AI-generated writing patterns
- overclaiming
- internal contradictions

Return valid JSON only.

Schema:
{{
  "agent": "Integrity Reviewer",
  "integrity_score": 1,
  "ai_generated_likelihood": "Low",
  "unsupported_claims": [],
  "red_flags": [],
  "contradictions": [],
  "confidence": 0.0,
  "justification": ""
}}

Application:
{application_text[:12000]}
""")


def chair_agent(
    application_text: str,
    scientific: dict,
    commercial: dict,
    risk: dict,
    integrity: dict
) -> dict:
    return call_gemini_json(f"""
You are the evaluation panel chair.

Combine all reviewer outputs and produce a final decision.

Rules:
- Be concise but specific.
- Do not invent facts not found in the application.
- Use all reviewer reports.
- Penalize high risk, weak evidence, and integrity red flags.
- Return valid JSON only.

Schema:
{{
  "agent": "Chair Agent",
  "final_score": 1,
  "recommendation": "Reject",
  "summary": "",
  "top_strengths": [],
  "top_weaknesses": [],
  "top_risks": [],
  "integrity_notes": [],
  "final_feedback": "",
  "confidence": 0.0
}}

Scientific Review:
{json.dumps(scientific, ensure_ascii=False)}

Commercial Review:
{json.dumps(commercial, ensure_ascii=False)}

Risk Review:
{json.dumps(risk, ensure_ascii=False)}

Integrity Review:
{json.dumps(integrity, ensure_ascii=False)}

Application:
{application_text[:4000]}
""")


def safe_agent_call(agent_name: str, fn):
    try:
        return fn()
    except Exception as error:
        return {
            "agent": agent_name,
            "score": 0,
            "confidence": 0,
            "strengths": [],
            "weaknesses": [],
            "risks": [],
            "error": str(error),
            "justification": f"{agent_name} failed: {str(error)}"
        }


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
                integrity=integrity
            )
        )

    return {
        "job_id": job_id,
        "file_name": file_name,
        "scientific_review": scientific,
        "commercial_review": commercial,
        "risk_review": risk,
        "integrity_review": integrity,
        "chair_decision": chair
    }