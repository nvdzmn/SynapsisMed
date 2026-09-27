"""TrialLens backend API.  The browser consumes saved run view models only."""
from __future__ import annotations

import asyncio, json
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from services.pipeline import (approve_draft, cohort_agent, get_run, ident, literature_agent,
                               load_cohort, now, patient_message_agent, phenotype_bundle, save_run)
from services.xai import create_voice_secret

ROOT = Path(__file__).parent
DRAFT_DIR = ROOT / "data" / "drafts"; DRAFT_DIR.mkdir(parents=True, exist_ok=True)

class DraftRequest(BaseModel):
    points: list[str] = Field(min_length=1)
    instruction: str | None = None
class ApproveRequest(BaseModel):
    final_text: str = Field(min_length=1, max_length=8000)

async def scheduled_runs():
    """Small v1 scheduler: wake hourly and start one weekday run after 07:00 UTC."""
    last_day = None
    while True:
        stamp = __import__("datetime").datetime.now(__import__("datetime").UTC)
        if stamp.weekday() < 5 and stamp.hour >= 7 and stamp.date() != last_day:
            await create_run(None, scheduled=True); last_day = stamp.date()
        await asyncio.sleep(3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(scheduled_runs())
    yield
    task.cancel()

app = FastAPI(title="SynapseMed TrialLens API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

def extract_upload(file: UploadFile, content: bytes) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt"}: raise HTTPException(400, "Upload PDF, DOCX, or TXT")
    if len(content) > 50 * 1024 * 1024: raise HTTPException(413, "Uploaded source must be 50 MB or smaller")
    try:
        if suffix == ".pdf":
            from pypdf import PdfReader; import io
            text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(content)).pages)
        elif suffix == ".docx":
            from docx import Document; import io
            text = "\n".join(p.text for p in Document(io.BytesIO(content)).paragraphs)
        else: text = content.decode("utf-8", errors="replace")
    except Exception as exc: raise HTTPException(422, f"Could not read uploaded source: {exc}")
    return {"source_id": f"file:{ident('src')}", "filename": file.filename, "text": text}

async def create_run(upload: dict | None, scheduled: bool = False) -> dict:
    cohort = load_cohort(); bundle = phenotype_bundle(cohort)
    run = {"run_id": ident("run"), "created_at": now(), "scheduled": scheduled, "status": "literature", "progress": ["phenotype_complete"], "phenotype_bundle": bundle, "upload": {"filename": upload["filename"]} if upload else None, "audit": {"agent_1_input": {"phenotype_bundle_id": bundle["phenotype_bundle_id"], "forbidden_identifiers_checked": True}, "agent_2_input": "pending", "agent_3_sessions": [], "agent_4_drafts": []}}
    save_run(run)
    try:
        dossier = await literature_agent(bundle, upload); run.update({"status": "contrast", "dossier": dossier, "progress": run["progress"] + ["literature_complete"]}); save_run(run)
        overlay, report = await cohort_agent(dossier, cohort); run["audit"]["agent_2_input"] = {"dossier_id": dossier["dossier_id"], "identified_synthetic_cohort": True}; run.update({"status": "complete", "overlay": overlay, "report": report, "source_pack": dossier["sources"], "progress": run["progress"] + ["contrast_complete", "report_complete"], "completed_at": now()})
    except Exception as exc: run.update({"status": "failed", "error": str(exc), "completed_at": now()})
    save_run(run); return run

@app.get("/health")
async def health(): return {"status": "ok", "cohort_size": len(load_cohort()), "synthetic": True}

@app.post("/api/runs")
async def start_run(file: UploadFile | None = File(None)):
    upload = extract_upload(file, await file.read()) if file else None
    return await create_run(upload)

@app.get("/api/runs/{run_id}")
async def read_run(run_id: str):
    run = get_run(run_id)
    # No raw dossier or full cohort in the normal frontend contract.
    return {key: run.get(key) for key in ("run_id", "created_at", "completed_at", "scheduled", "status", "progress", "error", "overlay", "report", "source_pack")}

@app.post("/api/runs/{run_id}/voice/session")
async def voice_session(run_id: str):
    run = get_run(run_id)
    if run["status"] != "complete": raise HTTPException(409, "Voice requires a completed report")
    secret = await create_voice_secret()
    run["audit"]["agent_3_sessions"].append({"created_at": now(), "report_id": run["report"]["report_id"]}); save_run(run)
    return {"run_id": run_id, "report_id": run["report"]["report_id"], "voice_secret": secret, "context": {"report": run["report"], "sources": run["source_pack"]}}

@app.post("/api/runs/{run_id}/patients/{patient_id}/draft")
async def draft_patient_message(run_id: str, patient_id: str, request: DraftRequest):
    run = get_run(run_id)
    if run["status"] != "complete": raise HTTPException(409, "Drafting requires a completed run")
    patient = next((p for p in load_cohort() if p["id"] == patient_id), None)
    if not patient: raise HTTPException(404, "Patient not found")
    draft = await patient_message_agent(patient, request.points, request.instruction)
    draft["run_id"] = run_id; (DRAFT_DIR / f"{draft['draft_id']}.json").write_text(json.dumps(draft, indent=2)); run["audit"]["agent_4_drafts"].append({"draft_id": draft["draft_id"], "patient_id": patient_id, "created_at": now()}); save_run(run)
    return draft

@app.post("/api/drafts/{draft_id}/approve")
async def approve_patient_message(draft_id: str, request: ApproveRequest):
    path = DRAFT_DIR / f"{draft_id}.json"
    if not path.exists(): raise HTTPException(404, "Draft not found")
    draft = approve_draft(json.loads(path.read_text()), request.final_text)
    path.write_text(json.dumps(draft, indent=2)); return draft
