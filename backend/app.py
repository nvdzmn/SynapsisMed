"""TrialLens backend API.  The browser consumes saved run view models only."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from services.pipeline import (approve_draft, cohort_agent, get_run, ident, literature_agent,
                               load_cohort, note_prefill_agent, now, patient_message_agent, phenotype_bundle, placeholder_dossier, save_run, seed_cohort, voice_context)
from services.xai import create_voice_secret, load_local_env
from services.mail import mail_status, send_patient_message
load_local_env()
from services import store
from services.store import latest_completed_run


class DraftRequest(BaseModel):
    # No points means a personal message, written only from the instruction.
    points: list[str] = Field(default_factory=list)
    instruction: str | None = Field(None, max_length=500)
    previous_text: str | None = Field(None, max_length=8000)
class ApproveRequest(BaseModel):
    final_text: str = Field(min_length=1, max_length=8000)
class NoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    run_id: str | None = None
    source: Literal["typed", "voice"] = "typed"

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
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3001"], allow_credentials=True, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])

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
        overlay, report, trace = await cohort_agent(dossier, cohort, question or (dossier.get("retrieval") or {}).get("question"))
        run["audit"]["agent_2_input"] = {"dossier_id": dossier["dossier_id"], "identified_synthetic_cohort": True, "names_sent_to_model": False}
        run["audit"]["agent_2_trace"] = trace
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
    return {"run_id": run_id, "report_id": run["report"]["report_id"], "voice_secret": secret, "context": {"report": run["report"], "sources": run["source_pack"], "brief": voice_context(run)}}

@app.post("/api/runs/{run_id}/patients/{patient_id}/draft")
async def draft_patient_message(run_id: str, patient_id: str, request: DraftRequest):
    run = get_run(run_id)
    if run["status"] != "complete": raise HTTPException(409, "Drafting requires a completed run")
    patient = next((p for p in load_cohort() if p["id"] == patient_id), None)
    if not patient: raise HTTPException(404, "Patient not found")
    draft = await patient_message_agent(patient, request.points, request.instruction, ((run.get("report") or {}).get("note_briefs") or {}).get(patient_id), request.previous_text)
    draft["run_id"] = run_id; store.save_draft(draft); run["audit"]["agent_4_drafts"].append({"draft_id": draft["draft_id"], "patient_id": patient_id, "created_at": now()}); save_run(run)
    return draft

@app.post("/api/drafts/{draft_id}/approve")
async def approve_patient_message(draft_id: str, request: ApproveRequest):
    draft = store.get_draft(draft_id)
    if (draft.get("delivery") or {}).get("status") == "delivered": raise HTTPException(409, "This message has already been sent")
    draft = approve_draft(draft, request.final_text)
    patient = known_patient(draft["patient_id"])
    try:
        sent = await send_patient_message((draft.get("model_draft") or {}).get("subject") or "", request.final_text, patient["name"])
    except HTTPException as exc:
        # Approved but undelivered is recorded as such, so the audit trail never shows a send that did not happen.
        draft["delivery"] = {"status": "failed", "error": str(exc.detail), "attempted_at": now()}; store.save_draft(draft)
        raise
    draft["delivery"] = {"status": "delivered", "sent_at": now(), **sent}
    store.save_draft(draft); return draft

@app.get("/api/mail/status")
async def read_mail_status():
    return mail_status()

def known_patient(patient_id: str) -> dict:
    patient = next((p for p in load_cohort() if p["id"] == patient_id), None)
    if not patient: raise HTTPException(404, "Patient not found")
    return patient

@app.get("/api/notes/counts")
async def count_notes():
    return store.note_counts()

@app.get("/api/patients/{patient_id}/notes")
async def list_notes(patient_id: str):
    known_patient(patient_id)
    return store.notes_for(patient_id)

@app.post("/api/patients/{patient_id}/notes")
async def add_note(patient_id: str, request: NoteRequest):
    # The physician's own notes: stored as written, never sent to the patient or to a model.
    known_patient(patient_id)
    if not request.text.strip(): raise HTTPException(400, "Write something before saving")
    note = {"note_id": ident("nt"), "patient_id": patient_id, "run_id": request.run_id, "created_at": now(), "text": request.text.strip(), "source": request.source}
    store.add_note(note)
    return note

@app.delete("/api/notes/{note_id}")
async def remove_note(note_id: str):
    store.delete_note(note_id)
    return {"deleted": note_id}

@app.post("/api/runs/{run_id}/patients/{patient_id}/note-draft")
async def draft_note(run_id: str, patient_id: str):
    run = get_run(run_id)
    if run["status"] != "complete": raise HTTPException(409, "Notes can be suggested once the report is complete")
    assessment = next((p for p in (run.get("overlay") or {}).get("patients") or [] if p["patient_id"] == patient_id), None)
    if not assessment: raise HTTPException(404, "Patient not found in this report")
    return await note_prefill_agent(assessment)
