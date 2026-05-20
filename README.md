
# Evalora ReviewerOS

**Observable multi-agent proposal intelligence platform powered by Gemini, Vertex AI, and Google Cloud.**

Evalora ReviewerOS is an institutional-grade AI reviewer workspace that evaluates grant proposals, accelerator applications, innovation projects, and research submissions through a specialized multi-agent reviewer panel.

It moves beyond chat by orchestrating multiple AI agents, analyzing uploaded documents, producing structured reviewer decisions, generating shareable PDF reports, enforcing workspace quotas, and exposing MCP-compatible observability traces for agent runtime inspection.

---

## Hackathon Track

**Google Cloud Rapid Agent Hackathon**  
**Partner Track:** Arize  
**Project Type:** Observable multi-agent decision intelligence platform  
**Status:** Functional prototype deployed on Google Cloud + Vercel

---

## Live Demo

| Resource | Link |
|---|---|
| Hosted App | `https://evalora.com.tr` |
| Vercel Preview | `https://revieweros.vercel.app` |
| Backend API | `https://revieweros-api-933794864277.europe-west1.run.app` |
| Demo Video | `TODO: add Devpost / YouTube / Loom link` |
| Devpost Submission | `TODO: add Devpost project link` |

---

## What Evalora Does

Proposal evaluation is slow, inconsistent, and often opaque. Universities, accelerators, grant offices, and investment committees need faster review workflows without losing auditability, human oversight, or decision quality.

Evalora solves this by turning every proposal review into an observable multi-agent workflow:

1. Upload a proposal document.
2. Extract and process the document.
3. Run specialized Gemini-powered reviewer agents.
4. Synthesize a final panel decision.
5. Generate a structured PDF report.
6. Save analysis history.
7. Export agent telemetry and traces.
8. Expose MCP-compatible trace inspection endpoints.

---

## Core Capabilities

### Multi-Agent Reviewer Panel

Evalora runs a specialized reviewer panel:

| Agent | Role |
|---|---|
| Scientific Reviewer | Evaluates methodology, novelty, validation, feasibility, and technical rigor. |
| Commercial Reviewer | Assesses market potential, business model, GTM readiness, scalability, and adoption risk. |
| Risk Reviewer | Identifies operational, financial, compliance, technical, and execution risks. |
| Integrity Reviewer | Checks unsupported claims, AI-likelihood, ethics, evidence quality, and governance gaps. |
| Chair Agent | Synthesizes reviewer perspectives into a final score, recommendation, and feedback. |

---

### Observable Agent Runtime

Every analysis produces structured telemetry:

```json
{
  "provider": "vertex-ai",
  "model": "gemini-2.5-pro",
  "agent_runtime": "revieweros",
  "trace_id": "2de44c37-bde0-468c-ac6e-c6c0e9712e98",
  "tokens": 2406,
  "cost_usd": 0.000842,
  "latency_seconds": 3.84,
  "agent_traces": [
    {
      "agent": "Scientific Reviewer",
      "status": "completed",
      "confidence": 0.82,
      "duration_ms": 1200
    },
    {
      "agent": "Commercial Reviewer",
      "status": "completed",
      "confidence": 0.76,
      "duration_ms": 980
    },
    {
      "agent": "Risk Reviewer",
      "status": "completed",
      "confidence": 0.79,
      "duration_ms": 870
    },
    {
      "agent": "Integrity Reviewer",
      "status": "completed",
      "confidence": 0.91,
      "duration_ms": 640
    },
    {
      "agent": "Chair Agent",
      "status": "completed",
      "confidence": 0.88,
      "duration_ms": 520
    }
  ]
}
