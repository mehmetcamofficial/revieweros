# Evalora ReviewerOS

## One-liner

Observable multi-agent proposal review system powered by Gemini, Google Cloud, and Arize Phoenix MCP-style observability for transparent institutional funding decisions.

## Track

Arize Track

## Hosted App

https://www.evalora.com.tr

## Demo Access

Use Demo Workspace mode.

- Workspace ID: jury-demo
- Access Code: evalora-demo-2026

Admin credentials are not public.

## What it does

Evalora ReviewerOS is a web-based AI proposal review platform for universities, research offices, accelerators, and funding teams. It helps reviewers triage, analyze, and synthesize proposal assessments using a multi-agent review workflow.

The system supports workspace-based proposal review, Gemini-powered analysis, PDF reporting, admin-controlled demo access, user management, quota controls, and trace-oriented observability.

## Problem

Institutional proposal review is slow, inconsistent, and difficult to audit. Reviewers often evaluate proposals manually across criteria such as excellence, impact, feasibility, risk, commercialization potential, and funding fit.

Evalora turns that into a structured AI-assisted review workflow.

## How we built it

Frontend:

- React
- TypeScript
- Vite
- Vercel hosting

Backend:

- FastAPI
- Google Cloud Run
- Firestore
- Gemini / Vertex AI-oriented architecture
- Workspace quota and user access control
- PDF report generation

Google Cloud:

- Cloud Run for backend deployment
- Firestore for quota, user, and workspace state
- Vertex AI / Gemini for proposal analysis workflow

Partner integration:

- Arize Track
- Arize Phoenix MCP configuration included in `mcp/arize-phoenix.mcp.json`
- Trace-oriented runtime events and observability panel
- Designed to connect proposal analysis runs to Phoenix traces, sessions, and annotations

## Key features

- Multi-agent proposal review
- Reviewer-style structured outputs
- Workspace-based quota control
- Admin user management
- Jury demo mode
- PDF reporting
- Runtime observability panel
- Arize Phoenix MCP-ready configuration
- Hosted web application

## Judging focus

Evalora addresses the judging criteria through:

- Technological Implementation: Google Cloud Run, Firestore, Gemini-oriented backend, admin controls, MCP-ready observability configuration
- Design: production-style web interface, workspace login, jury demo, admin console
- Potential Impact: faster and more consistent proposal review for research offices and funding teams
- Quality of Idea: observable AI proposal review with governance, quota control, and traceability

## Next steps

- Attach every proposal analysis run to live Arize Phoenix traces
- Add trace-level reviewer confidence scoring
- Add annotation workflows for human reviewer feedback
- Add institution-level dashboards
- Add role-based permissions
