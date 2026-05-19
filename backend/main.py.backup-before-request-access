import json
import os
import time
import uuid

from fastapi import Depends, FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from services.auth import optional_user_id, require_demo_auth
from services.firestore_store import (
    get_analysis,
    list_analyses,
    save_analysis,
    upsert_report_path,
)
from services.gemini import run_reviewer_panel
from services.parser import extract_text_from_file
from services.pdf_report import generate_pdf_report
from services.report_generator import generate_markdown_report
from services.streaming import run_streaming_review


app = FastAPI(
    title="ReviewerOS API",
    version="0.1.0",
    description="Autonomous AI reviewer panel API for grants, accelerators, and startup applications.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
REPORT_DIR = "reports"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)


def estimate_tokens_from_result(result: dict) -> int:
    text = json.dumps(result or {}, ensure_ascii=False)
    estimated = round(len(text) / 4)

    return max(1000, estimated)


def estimate_flash_lite_cost(tokens: int) -> float:
    return round((tokens / 1_000_000) * 0.35, 6)


def ensure_telemetry(result: dict, latency_seconds=None) -> dict:
    if not isinstance(result, dict):
        return result

    existing_telemetry = result.get("telemetry") or {}

    tokens = existing_telemetry.get("tokens")
    if tokens is None or tokens == "" or tokens == "-":
        tokens = estimate_tokens_from_result(result)

    cost_usd = existing_telemetry.get("cost_usd")
    if cost_usd is None or cost_usd == "" or cost_usd == "-":
        cost_usd = estimate_flash_lite_cost(int(tokens))

    final_latency = existing_telemetry.get("latency_seconds")
    if final_latency is None or final_latency == "" or final_latency == "-":
        final_latency = latency_seconds

    result["telemetry"] = {
        "model": existing_telemetry.get("model") or "gemini-2.5-flash-lite",
        "tokens": tokens,
        "cost_usd": cost_usd,
        "latency_seconds": final_latency,
    }

    return result


@app.get("/")
def root():
    return {
        "app": "ReviewerOS",
        "version": "0.1.0",
        "message": "Autonomous AI reviewer panel API is running.",
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ReviewerOS API",
    }


@app.get("/auth/check")
def check_auth(user_id: str = Depends(require_demo_auth)):
    return {
        "ok": True,
        "user_id": user_id,
    }


@app.get("/analyses")
def get_recent_analyses(
    limit: int = 20,
    user_id: str = Depends(require_demo_auth),
):
    safe_limit = max(1, min(limit, 50))

    return {
        "user_id": user_id,
        "items": list_analyses(limit=safe_limit, user_id=user_id),
    }


@app.get("/analyses/{job_id}")
def get_saved_analysis(
    job_id: str,
    user_id: str = Depends(require_demo_auth),
):
    analysis = get_analysis(job_id)

    if not analysis:
        return {
            "error": "Analysis not found.",
        }

    analysis_user_id = analysis.get("user_id") or "demo-user"

    if analysis_user_id != user_id:
        return {
            "error": "Analysis not found for this user.",
        }

    return analysis


@app.post("/analyses")
def create_saved_analysis(
    payload: dict,
    user_id: str = Depends(require_demo_auth),
):
    job_id = payload.get("job_id", str(uuid.uuid4()))
    file_name = payload.get("file_name", "application")
    result = payload.get("result")
    report_path = payload.get("report_path")

    if not result:
        return {
            "error": "Missing result payload.",
        }

    result = ensure_telemetry(result)

    saved = save_analysis(
        job_id=job_id,
        file_name=file_name,
        result=result,
        report_path=report_path,
        user_id=user_id,
    )

    return {
        "job_id": job_id,
        "user_id": user_id,
        "saved": saved,
    }


@app.get("/analyses/{job_id}/report")
def download_saved_analysis_report(
    job_id: str,
    user_id: str = Depends(optional_user_id),
):
    """
    Public-ish share endpoint.

    It intentionally does not require the demo access code so a copied PDF link
    can be opened directly by a reviewer/investor/demo audience.

    If a user_id header is present, it is accepted but not enforced here.
    """
    analysis = get_analysis(job_id)

    if not analysis:
        return {
            "error": "Analysis not found.",
        }

    result = analysis.get("result")
    file_name = analysis.get("file_name", "application")

    if not result:
        return {
            "error": "Saved analysis has no result payload.",
        }

    result = ensure_telemetry(result)

    pdf_path = generate_pdf_report(
        job_id=job_id,
        result=result,
        output_dir=REPORT_DIR,
        file_name=file_name,
    )

    upsert_report_path(job_id=job_id, report_path=pdf_path)

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{job_id}-revieweros-executive-report.pdf",
    )


@app.post("/analyze")
async def analyze_application(
    file: UploadFile = File(...),
    user_id: str = Depends(require_demo_auth),
):
    job_id = str(uuid.uuid4())

    if not file.filename:
        return {
            "job_id": job_id,
            "error": "No file name was provided.",
        }

    safe_filename = file.filename.replace(" ", "_")
    file_path = os.path.join(UPLOAD_DIR, f"{job_id}_{safe_filename}")

    with open(file_path, "wb") as uploaded_file:
        uploaded_file.write(await file.read())

    try:
        extracted_text = extract_text_from_file(file_path)
    except Exception as error:
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": f"Failed to extract text from file: {str(error)}",
        }

    if not extracted_text.strip():
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": "No text could be extracted from the uploaded file.",
        }

    try:
        start_time = time.time()

        result = run_reviewer_panel(
            application_text=extracted_text,
            file_name=file.filename,
            job_id=job_id,
        )

        latency_seconds = round(time.time() - start_time, 2)
        result = ensure_telemetry(result, latency_seconds=latency_seconds)

    except Exception as error:
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": f"AI reviewer panel failed: {str(error)}",
        }

    try:
        report_path = generate_markdown_report(
            job_id=job_id,
            result=result,
            output_dir=REPORT_DIR,
        )
    except Exception as error:
        report_path = None
        result["report_error"] = str(error)

    save_analysis(
        job_id=job_id,
        file_name=file.filename,
        result=result,
        report_path=report_path,
        user_id=user_id,
    )

    return {
        "job_id": job_id,
        "user_id": user_id,
        "file_name": file.filename,
        "report_path": report_path,
        "result": result,
    }


@app.post("/report/pdf")
async def create_pdf_report(
    payload: dict,
    user_id: str = Depends(require_demo_auth),
):
    job_id = payload.get("job_id", str(uuid.uuid4()))
    result = payload.get("result")
    file_name = payload.get("file_name", "application")

    if not result:
        return {
            "error": "Missing result payload.",
        }

    result = ensure_telemetry(result)

    pdf_path = generate_pdf_report(
        job_id=job_id,
        result=result,
        output_dir=REPORT_DIR,
        file_name=file_name,
    )

    upsert_report_path(job_id=job_id, report_path=pdf_path)

    save_analysis(
        job_id=job_id,
        file_name=file_name,
        result=result,
        report_path=pdf_path,
        user_id=user_id,
    )

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{job_id}-revieweros-executive-report.pdf",
    )


@app.websocket("/ws/analyze")
async def websocket_analyze(websocket: WebSocket):
    await websocket.accept()

    try:
        payload = await websocket.receive_json()

        job_id = payload.get("job_id", str(uuid.uuid4()))
        file_name = payload.get("file_name", "streamed_application.txt")
        application_text = payload.get("application_text", "")
        user_id = payload.get("user_id", "demo-user")
        access_code = payload.get("access_code")

        expected_access_code = os.getenv("REVIEWEROS_ACCESS_CODE", "revieweros-demo-2026")

        if expected_access_code and access_code != expected_access_code:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Invalid or missing ReviewerOS access code.",
                }
            )
            await websocket.close()
            return

        if not application_text.strip():
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "No application text was provided.",
                }
            )
            await websocket.close()
            return

        await run_streaming_review(
            websocket=websocket,
            application_text=application_text,
            file_name=file_name,
            job_id=job_id,
        )

        await websocket.close()

    except WebSocketDisconnect:
        print("WebSocket disconnected.")

    except Exception as error:
        await websocket.send_json(
            {
                "type": "error",
                "message": str(error),
            }
        )
        await websocket.close()