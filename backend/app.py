from pathlib import Path
import json
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from services.pubmed import fetch_pubmed_abstracts
from services.xai import create_voice_secret, ingest_trial_paper

app = FastAPI(title="SynapseMed API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
COHORT = json.loads((Path(__file__).parent / "data" / "clinic_cohort.json").read_text())

@app.get("/health")
async def health(): return {"status": "ok", "cohort_size": len(COHORT)}

@app.get("/api/literature/search")
async def search_literature(q: str = "heart failure SGLT2"):
    if not q.strip(): raise HTTPException(400, "Query cannot be empty")
    return await fetch_pubmed_abstracts(q.strip())

@app.post("/api/audit/cohort")
async def audit_cohort(payload: dict):
    text = payload.get("abstract", "").lower()
    matches = []
    for patient in COHORT:
        conditions = " ".join(patient["conditions"]).lower(); metrics = patient["metrics"]; reasons = []; risk = "MODERATE"
        if any(term in text for term in ("heart failure", "hfpef", "preserved ejection")) and ("heart failure" in conditions or "hfpef" in conditions):
            reasons.append(f"Heart-failure phenotype aligned (LVEF {metrics.get('LVEF', 'not recorded')}%)"); risk = "HIGH"
        if any(term in text for term in ("kidney", "renal", "egfr")) and metrics.get("eGFR", 100) < 60:
            reasons.append(f"eGFR {metrics['eGFR']} mL/min is within renal-risk signal"); risk = "CRITICAL"
        if "psoriasis" in text and "psoriasis" in conditions:
            reasons.append(f"Plaque psoriasis; PASI {metrics.get('PASI_Score', 'not recorded')}"); risk = "HIGH"
        if any(term in text for term in ("asthma", "eosinophil")) and "asthma" in conditions:
            reasons.append(f"Severe asthma; eosinophils {metrics.get('Blood_Eosinophils', 'not recorded')}"); risk = "HIGH"
        if reasons: matches.append({"patient": patient, "risk_level": risk, "match_reasons": reasons, "recommended_action": "Clinician review of eligibility, safety and current regimen."})
    return {"matched_patients": matches, "disclaimer": "Decision support only; not a treatment recommendation."}

@app.post("/api/evidence/ingest")
async def ingest_evidence(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith((".pdf", ".txt", ".docx")):
        raise HTTPException(400, "Upload a PDF, TXT, or DOCX trial paper")
    return await ingest_trial_paper(await file.read(), file.filename, file.content_type)

@app.post("/api/voice/session")
async def voice_session():
    """Issues a five-minute scoped client secret for Grok Voice Realtime."""
    return await create_voice_secret()
