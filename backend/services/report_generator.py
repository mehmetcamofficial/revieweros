import os
import json


def format_list(items):
    if not items:
        return "- None"

    return "\n".join([f"- {item}" for item in items])


def generate_markdown_report(job_id: str, result: dict, output_dir: str) -> str:
    os.makedirs(output_dir, exist_ok=True)

    chair = result.get("chair_decision", {})
    scientific = result.get("scientific_review", {})
    commercial = result.get("commercial_review", {})
    risk = result.get("risk_review", {})

    content = f"""
# ReviewerOS Evaluation Report

## Application

File: {result.get("file_name")}

Job ID: {job_id}

---

## Final Decision

Final Score: {chair.get("final_score")}

Recommendation: {chair.get("recommendation")}

Confidence: {chair.get("confidence")}

---

## Executive Summary

{chair.get("summary")}

---

## Top Strengths

{format_list(chair.get("top_strengths", []))}

---

## Top Weaknesses

{format_list(chair.get("top_weaknesses", []))}

---

## Top Risks

{format_list(chair.get("top_risks", []))}

---

## Scientific Reviewer

Score: {scientific.get("score")}

Confidence: {scientific.get("confidence")}

Justification:
{scientific.get("justification")}

---

## Commercial Reviewer

Score: {commercial.get("score")}

Confidence: {commercial.get("confidence")}

Justification:
{commercial.get("justification")}

---

## Risk Reviewer

Risk Level: {risk.get("risk_level")}

Score: {risk.get("score")}

Confidence: {risk.get("confidence")}

Justification:
{risk.get("justification")}

---

## Final Feedback

{chair.get("final_feedback")}

---

## Raw JSON

{json.dumps(result, indent=2, ensure_ascii=False)}
"""

    report_path = os.path.join(output_dir, f"{job_id}.md")

    with open(report_path, "w", encoding="utf-8") as file:
        file.write(content)

    return report_path