"""The server-owned four-agent TrialLens pipeline.

Every agent has a deliberately narrow input.  Providers are optional for local
demo runs: deterministic fallbacks preserve the exact same API contracts.
"""
from __future__ import annotations

import asyncio, hashlib, json, os, re, uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException
from .pubmed import fetch_pubmed_abstracts
from .synthea import load_synthea_csv

ROOT = Path(__file__).parents[1]
RUN_DIR = ROOT / "data" / "runs"
RUN_DIR.mkdir(parents=True, exist_ok=True)

def now() -> str: return datetime.now(UTC).isoformat()
def ident(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex[:12]}"
def load_cohort() -> list[dict]:
    synthea = load_synthea_csv(ROOT / "data" / "synthea_csv")
    if synthea: return synthea
    raw = json.loads((ROOT / "data" / "clinic_cohort.json").read_text())
    for patient in raw:
        patient["patient_id"] = patient["id"]; patient["synthetic"] = True
        patient["contact_email"] = "synthetic-patient@example.invalid"
        patient["metric_units"] = {"eGFR": "mL/min/1.73 m²", "LVEF": "%", "Blood_Eosinophils": "cells/µL", "PASI_Score": "score"}
        # Deterministic demo-only enrichment where a Synthea export lacks a useful marker.
        if "asthma" in " ".join(patient["conditions"]).lower(): patient["metrics"].setdefault("Blood_Eosinophils", 360)
    return raw

def phenotype_bundle(cohort: list[dict]) -> dict:
    labels, bands, meds, ages, sexes = set(), set(), set(), set(), set()
    for person in cohort:
        text = " ".join(person["conditions"]).lower()
        if "hfpef" in text or "preserved ef" in text: labels.add("HFpEF")
        if "kidney" in text: labels.add("CKD")
        if "psoriasis" in text: labels.add("plaque psoriasis")
        if "asthma" in text: labels.add("severe asthma")
        value = person["metrics"].get("eGFR")
        if value is not None: bands.add("eGFR < 45" if value < 45 else "eGFR 45-89")
        if person["metrics"].get("Blood_Eosinophils", 0) >= 300: bands.add("eosinophils >= 300")
        if person["metrics"].get("PASI_Score", 0) >= 10: bands.add("PASI >= 10")
        meds.update("SGLT2 inhibitor" if "empagliflozin" in m.lower() else "" for m in person["current_medications"])
        ages.add("40-54" if person["age"] < 55 else "55-64" if person["age"] < 65 else "65+"); sexes.add(person["gender"].lower())
    return {"phenotype_bundle_id": ident("pb"), "generated_at": now(), "conditions": sorted(filter(None, labels)), "biomarker_bands": sorted(bands), "medication_classes": sorted(filter(None, meds)), "age_bands": sorted(ages), "sexes_present": sorted(sexes)}

def save_run(run: dict) -> None: (RUN_DIR / f"{run['run_id']}.json").write_text(json.dumps(run, indent=2))
def get_run(run_id: str) -> dict:
    path = RUN_DIR / f"{run_id}.json"
    if not path.exists(): raise HTTPException(404, "Run not found")
    return json.loads(path.read_text())

def safe_json(text: str) -> dict | None:
    try: return json.loads(re.sub(r"^```json\s*|\s*```$", "", text.strip()))
    except json.JSONDecodeError: return None

async def openai_literature(bundle: dict, articles: list[dict], upload: dict | None) -> dict | None:
    key = os.getenv("OPENAI_API_KEY")
    if not key: return None
    prompt = "Return JSON evidence findings only. Never name people or use ids. Use only supplied PubMed sources. " + json.dumps({"phenotype": bundle, "articles": articles, "upload": upload})
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json={"model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), "input": prompt, "text": {"format": {"type": "json_object"}}})
    if response.is_error: return None
    return safe_json(response.json().get("output_text", ""))

async def literature_agent(bundle: dict, upload: dict | None = None) -> dict:
    terms = []
    if "HFpEF" in bundle["conditions"]: terms.append("heart failure preserved ejection fraction SGLT2 clinical trial")
    if "plaque psoriasis" in bundle["conditions"]: terms.append("plaque psoriasis biologic randomized trial")
    if "severe asthma" in bundle["conditions"]: terms.append("severe eosinophilic asthma biologic trial")
    terms = terms[:3] or ["clinical trial recent"]
    articles: list[dict] = []
    for term in terms:
        try: articles.extend(await fetch_pubmed_abstracts(f"({term}) AND 2021:3000[dp]", 4))
        except Exception: pass
    unique = {item["pmid"]: item for item in articles}.values()
    sources = [{"source_id": f"pmid:{a['pmid']}", **a, "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{a['pmid']}/", "landmark": False} for a in list(unique)[:12]]
    if upload: sources.append({"source_id": upload["source_id"], "pmid": None, "title": upload["filename"], "journal": "Physician-uploaded literature", "publication_date": None, "abstract": upload.get("text", "")[:5000], "pubmed_url": None, "landmark": False})
    finding_sources = [source["source_id"] for source in sources]
    fallback = [{"finding_id": "f1", "statement": "Recent literature was retrieved for the panel phenotype; applicability requires chart-level clinician review.", "design": "other", "population": "See attached source abstracts.", "intervention_or_exposure": "Not stated consistently across retrieved abstracts.", "comparator": "Not stated", "outcome": "Not stated", "direction": "uncertain", "effect": {"measure": None, "value": None, "interval": None, "as_reported": False, "source_quote": ""}, "source_ids": finding_sources[:3], "limitations": "Generated fallback when the model or PubMed source is unavailable.", "conflicts_with": []}]
    model_output = await openai_literature(bundle, sources, upload)
    findings = model_output.get("findings", fallback) if model_output else fallback
    return {"dossier_version": "1.0", "dossier_id": ident("ed"), "generated_at": now(), "phenotype_bundle_id": bundle["phenotype_bundle_id"], "retrieval": {"source": "ncbi_pubmed_eutilities", "window": {"from": "2021-01-01", "to": datetime.now().date().isoformat()}, "queries": [{"query_id": f"q{i+1}", "term": term, "result_count": len(sources), "pmids_fetched": [s["pmid"] for s in sources if s["pmid"]], "pmids_omitted": []} for i, term in enumerate(terms)]}, "sources": sources, "findings": findings, "applicability_hints": [], "gaps": ["This is literature surveillance, not a treatment or enrollment determination."]}

def deterministic_overlay(dossier: dict, cohort: list[dict]) -> dict:
    text = " ".join([s.get("title", "") + " " + s.get("abstract", "") for s in dossier["sources"]]).lower(); result = []
    for person in cohort:
        conditions = " ".join(person["conditions"]).lower(); metrics = person["metrics"]; reasons = []; risk = None
        if ("heart failure" in text or "hfpef" in text) and ("heart failure" in conditions or "hfpef" in conditions): reasons.append({"text": f"Heart-failure phenotype with LVEF {metrics.get('LVEF', 'not recorded')}% aligns with the dossier topic.", "chart_fields": ["conditions", "metrics.LVEF"], "finding_id": "f1"}); risk = "HIGH"
        if ("kidney" in text or "egfr" in text) and metrics.get("eGFR", 999) < 45: reasons.append({"text": f"eGFR {metrics['eGFR']} mL/min/1.73 m² warrants first review against the cited evidence.", "chart_fields": ["metrics.eGFR"], "finding_id": "f1"}); risk = "CRITICAL"
        if "psoriasis" in text and "psoriasis" in conditions: reasons.append({"text": f"Plaque psoriasis with PASI {metrics.get('PASI_Score', 'not recorded')} aligns with the dossier topic.", "chart_fields": ["conditions", "metrics.PASI_Score"], "finding_id": "f1"}); risk = risk or "HIGH"
        if "asthma" in text and "asthma" in conditions: reasons.append({"text": f"Asthma with eosinophils {metrics.get('Blood_Eosinophils', 'not recorded')} cells/µL aligns with the dossier topic.", "chart_fields": ["conditions", "metrics.Blood_Eosinophils"], "finding_id": "f1"}); risk = risk or "HIGH"
        result.append({"patient_id": person["id"], "display_name": person["name"], "risk_level": risk, "finding_ids": ["f1"] if risk else [], "reasons": reasons, "mismatches": ["Trial enrollment criteria are not fully visible in this synthetic chart."] if risk else [], "clinician_note": "Review whether the cited population is close enough to matter at the next visit." if risk else None})
    return {"overlay_id": ident("ov"), "dossier_id": dossier["dossier_id"], "patients": result}

async def grok_json(prompt: str) -> dict | None:
    key = os.getenv("XAI_API_KEY")
    if not key: return None
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post("https://api.x.ai/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json={"model": "grok-4.7", "input": prompt})
    return safe_json(response.json().get("output_text", "")) if response.is_success else None

async def cohort_agent(dossier: dict, cohort: list[dict]) -> tuple[dict, dict]:
    overlay = deterministic_overlay(dossier, cohort)
    report = {"report_id": ident("rp"), "dossier_id": dossier["dossier_id"], "generated_at": now(), "sections": {"question": "The run assessed anonymized condition and biomarker patterns in a synthetic panel.", "literature": "Findings are limited to the sources attached to this run.", "limitations": "Evidence matching is a review prompt, not a treatment recommendation.", "patients": [p for p in overlay["patients"] if p["risk_level"]], "sources": dossier["sources"]}, "footer": "Decision support from synthetic records; not a treatment recommendation."}
    prompt = "Return JSON with a concise academic panel report. Never prescribe. Use only this dossier and cohort. " + json.dumps({"dossier": dossier, "overlay": overlay})
    model = await grok_json(prompt)
    if model: report["model_summary"] = model
    return overlay, report

async def patient_message_agent(patient: dict, points: list[str], instruction: str | None) -> dict:
    if not points: raise HTTPException(400, "Select at least one physician-confirmed point")
    prompt = "Return JSON with subject and body. Sixth-to-eighth-grade reading level. Do not give medical advice, name papers, PMIDs, other people, or mention AI. This is synthetic practice data. " + json.dumps({"name": patient["name"], "points": points, "instruction": instruction})
    model = await grok_json(prompt)
    draft = model if model and {"subject", "body"} <= model.keys() else {"subject": "A note from your care team", "body": f"Hello {patient['name']},\n\nWe would like to discuss: {' '.join(points)}\n\nThis is a synthetic practice message."}
    blocked = [other["name"] for other in load_cohort() if other["id"] != patient["id"] and other["name"] in draft["body"]] + re.findall(r"PMID\s*\d+|\b(start|stop|double) taking\b", draft["body"], re.I)
    return {"draft_id": ident("dr"), "patient_id": patient["id"], "run_points": points, "model_draft": draft, "edited_text": draft["body"], "approved": False, "blocked_terms": blocked, "created_at": now()}

def approve_draft(draft: dict, final_text: str) -> dict:
    if draft["blocked_terms"]: raise HTTPException(422, "Draft is blocked by content safety checks")
    if not os.getenv("PATIENT_MAIL_SINK"): raise HTTPException(409, "PATIENT_MAIL_SINK is required for synthetic delivery")
    draft.update({"edited_text": final_text, "approved": True, "approved_at": now(), "delivery": {"recipient": os.getenv("PATIENT_MAIL_SINK"), "status": "queued_for_demo_sink"}})
    return draft
