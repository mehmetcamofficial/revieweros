import os
import uuid

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from services.parser import extract_text_from_file
from services.gemini import run_reviewer_panel
from services.report_generator import generate_markdown_report


app = FastAPI(
    title="ReviewerOS API",
    version="0.1.0",
    description="Autonomous AI reviewer panel API for grants, accelerators, and startup applications."
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


@app.get("/")
def root():
    return {
        "app": "ReviewerOS",
        "version": "0.1.0",
        "message": "Autonomous AI reviewer panel API is running."
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "ReviewerOS API"
    }


@app.post("/analyze")
async def analyze_application(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())

    if not file.filename:
        return {
            "job_id": job_id,
            "error": "No file name was provided."
        }

    safe_filename = file.filename.replace(" ", "_")
    file_path = os.path.join(UPLOAD_DIR, f"{job_id}_{safe_filename}")

    with open(file_path, "wb") as f:
        f.write(await file.read())

    try:
        extracted_text = extract_text_from_file(file_path)
    except Exception as error:
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": f"Failed to extract text from file: {str(error)}"
        }

    if not extracted_text.strip():
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": "No text could be extracted from the uploaded file."
        }

    try:
        result = run_reviewer_panel(
            application_text=extracted_text,
            file_name=file.filename,
            job_id=job_id
        )
    except Exception as error:
        return {
            "job_id": job_id,
            "file_name": file.filename,
            "error": f"AI reviewer panel failed: {str(error)}"
        }

    try:
        report_path = generate_markdown_report(
            job_id=job_id,
            result=result,
            output_dir=REPORT_DIR
        )
    except Exception as error:
        report_path = None
        result["report_error"] = str(error)

    return {
        "job_id": job_id,
        "file_name": file.filename,
        "report_path": report_path,
        "result": result
    }