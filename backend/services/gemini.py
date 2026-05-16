import os
import json
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
        contents=prompt
    )

    text = clean_json_response(response.text)

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
{application_text[:30000]}
""")


def commercial_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are a commercialization reviewer.
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
{application_text[:30000]}
""")


def risk_reviewer(application_text: str) -> dict:
    return call_gemini_json(f"""
You are a risk and ethics reviewer.
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
{application_text[:30000]}
""")


def chair_agent(application_text: str, scientific: dict, commercial: dict, risk: dict) -> dict:
    return call_gemini_json(f"""
You are the evaluation panel chair.
Combine all reviewer outputs and produce a final decision.
Return valid JSON only.

Schema:
{{
  "agent": "Chair Agent",
  "final_score": 1,
  "recommendation": "Reject",
  "summary": "",
  "top_strengths": [],
  "top_weaknesses": [],
  "top_risks": [],
  "final_feedback": "",
  "confidence": 0.0
}}

Scientific Review:
{json.dumps(scientific, ensure_ascii=False)}

Commercial Review:
{json.dumps(commercial, ensure_ascii=False)}

Risk Review:
{json.dumps(risk, ensure_ascii=False)}

Application:
{application_text[:15000]}
""")


def run_reviewer_panel(application_text: str, file_name: str, job_id: str) -> dict:
    with trace_span("scientific_reviewer", {"job_id": job_id, "file_name": file_name}):
        scientific = scientific_reviewer(application_text)

    with trace_span("commercial_reviewer", {"job_id": job_id, "file_name": file_name}):
        commercial = commercial_reviewer(application_text)

    with trace_span("risk_reviewer", {"job_id": job_id, "file_name": file_name}):
        risk = risk_reviewer(application_text)

    with trace_span("chair_agent", {"job_id": job_id, "file_name": file_name}):
        chair = chair_agent(application_text, scientific, commercial, risk)

    return {
        "job_id": job_id,
        "file_name": file_name,
        "scientific_review": scientific,
        "commercial_review": commercial,
        "risk_review": risk,
        "chair_decision": chair
    }