"""TrialLens backend API.  The browser consumes saved run view models only."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from services.pipeline import (approve_draft, cohort_agent, get_run, ident, literature_agent,
                               load_cohort, now, patient_message_agent, phenotype_bundle, placeholder_dossier, save_run, seed_cohort)
from services.xai import create_voice_secret, load_local_env
load_local_env()
from services import store
from services.store import latest_completed_run


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
            await launch_run(None, None, scheduled=True); last_day = stamp.date()
        await asyncio.sleep(3600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    store.initialize(); seed_cohort()
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

VIEW_FIELDS = ("run_id", "created_at", "completed_at", "scheduled", "status", "progress", "error", "overlay", "report", "source_pack", "placeholder", "placeholder_reason")

def public_run(run: dict) -> dict:
    return {key: run.get(key) for key in VIEW_FIELDS}

async def finish_run(run_id: str, upload: dict | None, question: str | None, placeholder: bool = False) -> None:
    run = get_run(run_id)
    cohort = load_cohort()
    try:
        if placeholder:
            dossier = placeholder_dossier(run["phenotype_bundle"], question, "Sample report requested", [question] if question else ["sample"])
        else:
            dossier = await literature_agent(run["phenotype_bundle"], upload, question)
        placeholder = (dossier.get("retrieval") or {}).get("source") == "placeholder"
        run.update({"status": "contrast", "dossier": dossier, "source_pack": dossier["sources"], "placeholder": placeholder, "placeholder_reason": (dossier.get("retrieval") or {}).get("placeholder_reason"), "progress": run["progress"] + ["literature_complete"]})
        save_run(run)
        overlay, report = await cohort_agent(dossier, cohort)
        run["audit"]["agent_2_input"] = {"dossier_id": dossier["dossier_id"], "identified_synthetic_cohort": True}
        run.update({"status": "complete", "overlay": overlay, "report": report, "source_pack": dossier["sources"], "placeholder": placeholder, "placeholder_reason": (dossier.get("retrieval") or {}).get("placeholder_reason"), "progress": run["progress"] + ["contrast_complete", "report_complete"], "completed_at": now()})
    except Exception as exc:
        run.update({"status": "failed", "error": str(exc), "completed_at": now()})
    save_run(run)

async def launch_run(upload: dict | None, question: str | None, scheduled: bool = False, placeholder: bool = False) -> dict:
    cohort = load_cohort(); bundle = phenotype_bundle(cohort)
    run = {"run_id": ident("run"), "created_at": now(), "scheduled": scheduled, "status": "literature", "progress": ["phenotype_complete"], "question": question, "placeholder": placeholder, "phenotype_bundle": bundle, "upload": {"filename": upload["filename"]} if upload else None, "audit": {"agent_1_input": {"phenotype_bundle_id": bundle["phenotype_bundle_id"], "forbidden_identifiers_checked": True}, "agent_2_input": "pending", "agent_3_sessions": [], "agent_4_drafts": []}}
    save_run(run)
    asyncio.create_task(finish_run(run["run_id"], upload, question, placeholder))
    return run

@app.get("/health")
async def health(): return {"status": "ok", "cohort_size": len(load_cohort()), "synthetic": True}

@app.post("/api/runs")
async def start_run(file: UploadFile | None = File(None), question: str | None = Form(None), sample: str | None = Form(None)):
    upload = extract_upload(file, await file.read()) if file and file.filename else None
    return public_run(await launch_run(upload, question, placeholder=(sample or "").lower() in {"1", "true", "yes"}))

def short_label(text: str, limit: int = 88) -> str:
    text = " ".join(str(text).split())
    if len(text) <= limit: return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(".,;:")
    return f"{cut or text[:limit]}…"

def report_summary(run: dict) -> dict:
    report = run.get("report") or {}
    summary = report.get("model_summary") or {}
    sections = report.get("sections") or {}
    question = summary.get("question") if isinstance(summary.get("question"), str) else sections.get("question") or ""
    raw_title = summary.get("title") if isinstance(summary.get("title"), str) and str(summary.get("title")).strip() else question
    title = short_label(raw_title) if raw_title else "Panel report"
    patients = (run.get("overlay") or {}).get("patients") or []
    return {
        "run_id": run.get("run_id"),
        "created_at": run.get("created_at"),
        "completed_at": run.get("completed_at"),
        "title": title,
        "question": question,
        "review_count": sum(1 for patient in patients if patient.get("risk_level")),
        "source_count": len(run.get("source_pack") or []),
        "placeholder": bool(run.get("placeholder") or report.get("placeholder")),
    }

@app.get("/api/runs")
async def list_runs():
    return [report_summary(run) for run in store.completed_runs()]

@app.get("/api/runs/latest")
async def latest_run():
    run = latest_completed_run()
    if not run: raise HTTPException(404, "No completed report is saved yet")
    return public_run(run)

@app.get("/api/runs/{run_id}")
async def read_run(run_id: str):
    # No raw dossier or full cohort in the normal frontend contract.
    return public_run(get_run(run_id))

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
    draft["run_id"] = run_id; store.save_draft(draft); run["audit"]["agent_4_drafts"].append({"draft_id": draft["draft_id"], "patient_id": patient_id, "created_at": now()}); save_run(run)
    return draft

@app.post("/api/drafts/{draft_id}/approve")
async def approve_patient_message(draft_id: str, request: ApproveRequest):
    draft = approve_draft(store.get_draft(draft_id), request.final_text)
    store.save_draft(draft); return draft
