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
from . import store

ROOT = Path(__file__).parents[1]

def now() -> str: return datetime.now(UTC).isoformat()
def ident(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex[:12]}"
def source_cohort() -> list[dict]:
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

def seed_cohort() -> None: store.replace_patients(source_cohort())
def load_cohort() -> list[dict]: return store.patients()

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

def save_run(run: dict) -> None: store.save_run(run)
def get_run(run_id: str) -> dict: return store.get_run(run_id)

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

async def literature_agent(bundle: dict, upload: dict | None = None, question: str | None = None) -> dict:
    terms = []
    if question and question.strip(): terms.append(question.strip()[:300])
    if "HFpEF" in bundle["conditions"]: terms.append("heart failure preserved ejection fraction SGLT2 clinical trial")
    if "plaque psoriasis" in bundle["conditions"]: terms.append("plaque psoriasis biologic randomized trial")
    if "severe asthma" in bundle["conditions"]: terms.append("severe eosinophilic asthma biologic trial")
    terms = terms[:4] or ["clinical trial recent"]
    articles: list[dict] = []
    errors: list[str] = []
    for term in terms:
        try: articles.extend(await fetch_pubmed_abstracts(f"({term}) AND 2021:2026[dp]", 4))
        except Exception as exc: errors.append(str(exc))
    if not articles and errors and not upload:
        raise RuntimeError(errors[0])
    unique = {item["pmid"]: item for item in articles}.values()
    sources = [{"source_id": f"pmid:{a['pmid']}", **a, "pubmed_url": f"https://pubmed.ncbi.nlm.nih.gov/{a['pmid']}/", "landmark": False} for a in list(unique)[:12]]
    if upload: sources.append({"source_id": upload["source_id"], "pmid": None, "title": upload["filename"], "journal": "Physician-uploaded literature", "publication_date": None, "abstract": upload.get("text", "")[:5000], "pubmed_url": None, "landmark": False})
    finding_sources = [source["source_id"] for source in sources]
    fallback = [{"finding_id": "f1", "statement": "Recent literature was retrieved for the panel phenotype; applicability requires chart-level clinician review.", "design": "other", "population": "See attached source abstracts.", "intervention_or_exposure": "Not stated consistently across retrieved abstracts.", "comparator": "Not stated", "outcome": "Not stated", "direction": "uncertain", "effect": {"measure": None, "value": None, "interval": None, "as_reported": False, "source_quote": ""}, "source_ids": finding_sources[:3], "limitations": "Generated fallback when the model or PubMed source is unavailable.", "conflicts_with": []}]
    model_output = await openai_literature(bundle, sources, upload)
    findings = model_output.get("findings", fallback) if model_output else fallback
    return {"dossier_version": "1.0", "dossier_id": ident("ed"), "generated_at": now(), "phenotype_bundle_id": bundle["phenotype_bundle_id"], "retrieval": {"source": "ncbi_pubmed_eutilities", "window": {"from": "2021-01-01", "to": datetime.now().date().isoformat()}, "queries": [{"query_id": f"q{i+1}", "term": term, "result_count": len(sources), "pmids_fetched": [s["pmid"] for s in sources if s["pmid"]], "pmids_omitted": []} for i, term in enumerate(terms)]}, "sources": sources, "findings": findings, "applicability_hints": [], "gaps": ["This is literature surveillance, not a treatment or enrollment determination."]}

def placeholder_dossier(bundle: dict, question: str | None, reason: str, terms: list[str]) -> dict:
    sources = [
        {"source_id": "pmid:34449189", "pmid": "34449189", "title": "EMPEROR-Preserved", "journal": "NEJM", "publication_date": "2021", "pubmed_url": "https://pubmed.ncbi.nlm.nih.gov/34449189/", "landmark": True, "abstract": "Empagliflozin in heart failure with preserved ejection fraction (HFpEF). Patients with heart failure and a range of kidney function were studied.", "key_findings": "Fewer heart failure hospitalizations when ejection fraction is preserved."},
        {"source_id": "pmid:36027570", "pmid": "36027570", "title": "DELIVER", "journal": "NEJM", "publication_date": "2022", "pubmed_url": "https://pubmed.ncbi.nlm.nih.gov/36027570/", "landmark": True, "abstract": "Dapagliflozin in heart failure with mildly reduced or preserved ejection fraction. Outcomes were assessed across eGFR strata in HFpEF.", "key_findings": "Heart failure events were lower across the ejection-fraction range studied."},
        {"source_id": "pmid:36331190", "pmid": "36331190", "title": "EMPA-KIDNEY", "journal": "NEJM", "publication_date": "2023", "pubmed_url": "https://pubmed.ncbi.nlm.nih.gov/36331190/", "landmark": True, "abstract": "Empagliflozin in chronic kidney disease. Kidney outcomes were studied down to a low eGFR, including people with and without heart failure.", "key_findings": "Kidney disease progression was lower across a wide eGFR range."},
    ]
    findings = [{"finding_id": "f1", "statement": "Sample literature: SGLT2 inhibitor trials in heart failure with preserved ejection fraction and in chronic kidney disease. Not retrieved live from PubMed.", "design": "other", "population": "HFpEF and CKD trial populations described in the sample sources.", "intervention_or_exposure": "SGLT2 inhibitor", "comparator": "Placebo", "outcome": "Heart failure events and kidney disease progression", "direction": "uncertain", "effect": {"measure": None, "value": None, "interval": None, "as_reported": False, "source_quote": ""}, "source_ids": [source["source_id"] for source in sources], "limitations": "These sources are a fixed stand-in so the rest of the workspace can be tested.", "conflicts_with": []}]
    return {"dossier_version": "1.0", "dossier_id": ident("ed"), "generated_at": now(), "phenotype_bundle_id": bundle["phenotype_bundle_id"], "retrieval": {"source": "placeholder", "placeholder_reason": reason, "question": question, "window": {"from": "2021-01-01", "to": datetime.now().date().isoformat()}, "queries": [{"query_id": f"q{i+1}", "term": term, "result_count": 0, "pmids_fetched": [], "pmids_omitted": []} for i, term in enumerate(terms)]}, "sources": sources, "findings": findings, "applicability_hints": [], "gaps": ["This dossier is a sample for testing, not a live PubMed retrieval."]}

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

def response_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"]
    chunks = []
    for item in payload.get("output") or []:
        for part in item.get("content") or []:
            if part.get("text"): chunks.append(part["text"])
    return "\n".join(chunks)

async def grok_json(prompt: str, model: str = "grok-4.7", timeout: float = 90) -> dict | None:
    from services.xai import load_local_env
    load_local_env()
    key = os.getenv("XAI_API_KEY")
    if not key: return None
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post("https://api.x.ai/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json={"model": model, "input": prompt})
    if response.is_error: return None
    return safe_json(response_text(response.json()))

def report_sections(dossier: dict, overlay: dict) -> dict:
    matched = [p for p in overlay["patients"] if p["risk_level"]]
    if (dossier.get("retrieval") or {}).get("source") != "placeholder":
        return {"question": "The run assessed anonymized condition and biomarker patterns in a synthetic panel.", "literature": "Findings are limited to the sources attached to this run.", "limitations": "Evidence matching is a review prompt, not a treatment recommendation.", "patients": matched, "sources": dossier["sources"]}
    asked = ((dossier.get("retrieval") or {}).get("question") or "").strip() or "Does recent evidence support SGLT2 inhibitors for patients with heart failure, preserved ejection fraction, and CKD?"
    return {"question": asked, "literature": "Fewer heart failure hospitalizations or cardiovascular deaths when ejection fraction is above 40%.\nBenefit held across eGFR down to about 20–25 in the trial populations.", "limitations": "A mortality benefit on its own.\nUse below eGFR 20, on dialysis, or in type 1 diabetes.", "patients": matched, "sources": dossier["sources"]}

COHORT_MODEL = "grok-4.7"
NOTE_MODEL = "grok-4.20-0309-non-reasoning"  # the note writer only rephrases Agent 2's points, so it runs on the fastest model
COHORT_TIMEOUT = 300  # seconds per model call; grok-4.7 regularly takes 70 to 100 and has passed 180
COHORT_MAX_TURNS = 6
COHORT_MAX_REVIEWS = 24
COHORT_PARALLEL = 12
RISK_LEVELS = ("CRITICAL", "HIGH", "MODERATE")
PRESCRIBING = re.compile(r"\b(?:start|stop|double) taking\b", re.I)

COHORT_BRIEF = """You are the clinical evidence reviewer for a physician's patient panel. You review one patient against an evidence dossier and decide whether the evidence is relevant enough that the physician should look at this chart. You are decision support: never prescribe, and never recommend starting, stopping, or changing a medicine.

How to work: call get_chart to read the chart, and call get_source for every source you rely on before you rely on it. You may call several tools in one turn, for example get_chart together with the sources you expect to need. When you have enough, call record_assessment once. If it is rejected, fix the listed problems and call it again.

Use only the chart and the dossier sources. If the sources do not state something, do not fill it in from memory; record it as a mismatch. Quote chart values exactly as the chart gives them.

Risk levels:
- CRITICAL: the evidence applies to this patient and a chart value means this review should happen first, such as a value near a boundary the sources describe.
- HIGH: the evidence applies to this patient's condition.
- MODERATE: the evidence partly applies, with gaps that matter.
- NONE: the dossier does not concern this patient. Give no reasons, and leave voice_brief and note_context empty.

What each field is for:
- reasons[].text: a bullet on the physician's patient card, 14 words at most. Lead with the chart fact and its value, then what the evidence says about it, like 'eGFR 46 with CKD: kidney progression was lower across a wide eGFR range'. Three reasons at most.
- reasons[].detail: the full reasoning behind that bullet in one sentence, naming the sources it rests on.
- reasons[].plain_language: the same point in everyday words, written to the patient as 'you'. No medicine names, doses, study names, or advice.
- mismatches: card bullets, 12 words at most each, on how this patient differs from the populations studied or what the chart does not show, like 'No heart failure on chart; two of three sources studied heart failure'. Be specific to this patient. Three at most, the ones that matter most to the physician.
- clinician_checks: card bullets, 10 words at most each, on what the physician should check at the next visit. Start each with a verb, like 'Confirm whether LVEF has been measured'. One to three.

The card bullets are read at a glance. Write them as short notes, not sentences: no 'the chart lists', no 'this patient', no closing full stop.
- voice_brief: 40 to 80 words a spoken assistant will use to talk this patient through with the physician. Say 'this patient'.
- note_context: one or two sentences guiding whoever writes the patient's note on tone and emphasis. It must be safe for the patient to read.

Never put a name or a patient ID in any text field."""

COHORT_TOOLS = [
    {"type": "function", "name": "get_chart", "description": "Read the chart of the patient under review: conditions, metrics with units, current medications, age, and sex.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"type": "function", "name": "get_source", "description": "Read one source from the evidence dossier: its abstract and key findings.", "parameters": {"type": "object", "properties": {"source_id": {"type": "string"}}, "required": ["source_id"], "additionalProperties": False}},
    {"type": "function", "name": "record_assessment", "description": "Record the final assessment for this patient. It is checked against the chart and the dossier and rejected with reasons if it does not match.", "parameters": {"type": "object", "properties": {
        "risk_level": {"type": "string", "enum": [*RISK_LEVELS, "NONE"]},
        "reasons": {"type": "array", "items": {"type": "object", "properties": {
            "text": {"type": "string"},
            "detail": {"type": "string"},
            "chart_fields": {"type": "array", "items": {"type": "string"}, "description": "Chart fields this reason rests on: age, sex, conditions, current_medications, or metrics.<name>."},
            "source_ids": {"type": "array", "items": {"type": "string"}},
            "plain_language": {"type": "string"}}, "required": ["text", "detail", "chart_fields", "source_ids", "plain_language"], "additionalProperties": False}},
        "mismatches": {"type": "array", "items": {"type": "string"}},
        "clinician_checks": {"type": "array", "items": {"type": "string"}},
        "voice_brief": {"type": "string"},
        "note_context": {"type": "string"}}, "required": ["risk_level", "reasons", "mismatches", "clinician_checks", "voice_brief", "note_context"], "additionalProperties": False}},
]

def chart_view(person: dict) -> dict:
    """The chart as Agent 2 sees it: no name, no contact details."""
    return {"patient_id": person["id"], "age": person.get("age"), "sex": person.get("gender"), "conditions": person.get("conditions") or [], "metrics": person.get("metrics") or {}, "metric_units": person.get("metric_units") or {}, "current_medications": person.get("current_medications") or []}

def check_assessment(found: dict, chart: dict, source_ids: set[str]) -> list[str]:
    errors = []; level = found.get("risk_level"); reasons = found.get("reasons") or []
    if level not in (*RISK_LEVELS, "NONE"): errors.append(f"risk_level must be one of {[*RISK_LEVELS, 'NONE']}")
    if level in RISK_LEVELS and not reasons: errors.append("A flagged patient needs at least one reason")
    checks = found.get("clinician_checks") or []
    if level in RISK_LEVELS and not checks: errors.append("A flagged patient needs at least one clinician_check")
    # The card has to stay small enough to sit beside its node, so the bullet limits are enforced here.
    for label, bullets, most, words in (("reasons", [reason.get("text") for reason in reasons], 3, 14), ("mismatches", found.get("mismatches") or [], 3, 12), ("clinician_checks", checks, 3, 10)):
        if len(bullets) > most: errors.append(f"Give at most {most} {label}, not {len(bullets)}")
        for index, bullet in enumerate(bullets, 1):
            if len(str(bullet or "").split()) > words: errors.append(f"{label} {index} is {len(str(bullet).split())} words; the limit is {words}")
    fields = {"age", "sex", "conditions", "current_medications"} | {f"metrics.{name}" for name in chart["metrics"]}
    for index, reason in enumerate(reasons, 1):
        text = str(reason.get("text") or ""); cited = reason.get("chart_fields") or []
        if not text.strip(): errors.append(f"Reason {index} has no text")
        if not cited: errors.append(f"Reason {index} must cite at least one chart field")
        unknown = [field for field in cited if field not in fields]
        if unknown: errors.append(f"Reason {index} cites chart fields that are not in this chart: {unknown}. Available: {sorted(fields)}")
        missing = [source for source in reason.get("source_ids") or [] if source not in source_ids]
        if missing: errors.append(f"Reason {index} cites sources that are not in the dossier: {missing}")
        for field in cited:
            value = chart["metrics"].get(field.removeprefix("metrics.")) if field.startswith("metrics.") else None
            if isinstance(value, (int, float)) and not re.search(rf"(?<![\d.]){re.escape(f'{value:g}')}(?!\.?\d)", text):
                errors.append(f"Reason {index} cites {field} but does not quote the chart value {value:g}")
        blocked = safety_blocks(str(reason.get("plain_language") or ""), chart["patient_id"])
        if blocked: errors.append(f"Reason {index} plain_language is not safe for a patient: {blocked}")
    blocked = safety_blocks(str(found.get("note_context") or ""), chart["patient_id"])
    if blocked: errors.append(f"note_context is not safe for a patient: {blocked}")
    for key, text in (("clinician_checks", " ".join(map(str, checks))), ("voice_brief", str(found.get("voice_brief") or ""))):
        if PRESCRIBING.search(text): errors.append(f"{key} must not tell anyone to start, stop, or change a medicine")
    return errors

async def grok_turn(client: httpx.AsyncClient, key: str, body: dict) -> dict:
    for attempt in range(3):
        try: response = await client.post("https://api.x.ai/v1/responses", headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, json=body)
        except httpx.TimeoutException:
            if attempt == 2: raise
            continue
        if response.status_code not in (429, 500, 502, 503, 504) or attempt == 2: break
        await asyncio.sleep(5 * (attempt + 1))
    if response.is_error: raise RuntimeError(f"xAI {response.status_code}: {response.text[:200]}")
    return response.json()

async def review_patient(client: httpx.AsyncClient, key: str, gate: asyncio.Semaphore, person: dict, dossier: dict, question: str | None) -> tuple[dict | None, dict]:
    """One tool loop for one chart. Returns the accepted assessment, or None, and the trace for the audit log."""
    chart = chart_view(person); sources = {source["source_id"]: source for source in dossier["sources"]}
    trace = {"patient_id": person["id"], "model": COHORT_MODEL, "started_at": now(), "turns": 0, "tool_calls": [], "outcome": "incomplete"}
    task = {"question": question, "findings": dossier.get("findings"), "sources": [{key_: source.get(key_) for key_ in ("source_id", "title", "journal", "publication_date")} for source in sources.values()]}
    items: list[dict] = [{"role": "system", "content": COHORT_BRIEF}, {"role": "user", "content": "Review the patient against this dossier. " + json.dumps(task)}]
    accepted = None
    async with gate:
        try:
            for _ in range(COHORT_MAX_TURNS):
                output = (await grok_turn(client, key, {"model": COHORT_MODEL, "input": items, "tools": COHORT_TOOLS})).get("output") or []
                trace["turns"] += 1; items += output
                calls = [item for item in output if item.get("type") == "function_call"]
                if not calls: items.append({"role": "user", "content": "Finish by calling record_assessment."})
                for call in calls:
                    name = call.get("name"); args = safe_json(call.get("arguments") or "{}") or {}
                    if name == "get_chart": result = chart
                    elif name == "get_source":
                        source = sources.get(args.get("source_id"))
                        result = {key_: source.get(key_) for key_ in ("source_id", "title", "journal", "publication_date", "abstract", "key_findings")} if source else {"error": f"No such source. Available: {sorted(sources)}"}
                    elif name == "record_assessment":
                        errors = check_assessment(args, chart, set(sources))
                        result = {"rejected": errors} if errors else {"accepted": True}
                        if not errors: accepted = args
                    else: result = {"error": f"Unknown tool {name}"}
                    trace["tool_calls"].append({"name": name, "arguments": args, "problems": result.get("rejected") or result.get("error")})
                    items.append({"type": "function_call_output", "call_id": call.get("call_id"), "output": json.dumps(result)})
                if accepted: break
            trace["outcome"] = "recorded" if accepted else "turn_limit"
        except Exception as exc:
            trace["outcome"] = f"error: {type(exc).__name__}: {str(exc)[:200]}"
    trace["finished_at"] = now()
    return accepted, trace

def merge_review(rule: dict, review: dict | None, dossier: dict) -> dict:
    """The rules stay as a floor: a chart they flag is never dropped, and a failed review is labelled."""
    if review is None: return {**rule, "assessed_by": "rules_fallback"}
    level = review["risk_level"] if review["risk_level"] in RISK_LEVELS else None
    checks = [str(check).strip() for check in review.get("clinician_checks") or [] if str(check).strip()]; note = ". ".join(checks)
    if not level and rule["risk_level"]:
        return {**rule, "mismatches": review.get("mismatches") or rule["mismatches"], "clinician_checks": ["Model review did not rate this chart as a match", *checks][:3], "clinician_note": f"The model review did not rate this chart as a match. {note}".strip(), "assessed_by": "rules_floor"}
    cited = {source for reason in review.get("reasons") or [] for source in reason.get("source_ids") or []}
    findings = [finding["finding_id"] for finding in dossier.get("findings") or [] if cited & set(finding.get("source_ids") or [])]
    return {"patient_id": rule["patient_id"], "display_name": rule["display_name"], "risk_level": level, "finding_ids": findings if level else [], "reasons": review.get("reasons") or [] if level else [], "mismatches": review.get("mismatches") or [] if level else [], "clinician_checks": checks if level else [], "clinician_note": note or None, "assessed_by": "agent"}

async def review_cohort(dossier: dict, cohort: list[dict], rules: dict, question: str | None) -> tuple[dict, dict, list[dict]]:
    from services.xai import load_local_env
    load_local_env()
    key = os.getenv("XAI_API_KEY"); by_rule = {patient["patient_id"]: patient for patient in rules["patients"]}
    # Rule-flagged charts go first so the cap never pushes one out of review.
    queue = sorted(cohort, key=lambda person: by_rule[person["id"]]["risk_level"] is None)[:COHORT_MAX_REVIEWS] if key else []
    reviews: dict[str, dict | None] = {}; traces = []
    if queue:
        gate = asyncio.Semaphore(COHORT_PARALLEL)
        async with httpx.AsyncClient(timeout=COHORT_TIMEOUT) as client:
            results = await asyncio.gather(*[review_patient(client, key, gate, person, dossier, question) for person in queue])
        for person, (review, trace) in zip(queue, results): reviews[person["id"]] = review; traces.append(trace)
    patients = [merge_review(by_rule[person["id"]], reviews[person["id"]], dossier) if person["id"] in reviews else {**by_rule[person["id"]], "assessed_by": "rules_only"} for person in cohort]
    overlay = {**rules, "patients": patients, "assessment": {"model": COHORT_MODEL if key else None, **{label: sum(1 for patient in patients if patient["assessed_by"] == label) for label in ("agent", "rules_floor", "rules_fallback", "rules_only")}}}
    return overlay, {person_id: review for person_id, review in reviews.items() if review}, traces

async def cohort_agent(dossier: dict, cohort: list[dict], question: str | None = None) -> tuple[dict, dict, list[dict]]:
    """Agent 2: matches the panel, writes the physician's report, and writes the briefs the voice and note agents work from."""
    overlay, reviews, traces = await review_cohort(dossier, cohort, deterministic_overlay(dossier, cohort), question)
    placeholder = (dossier.get("retrieval") or {}).get("source") == "placeholder"
    footer = "Synthetic records. Sample sources, not a live PubMed search. Decision support, not a treatment recommendation." if placeholder else "Decision support from synthetic records; not a treatment recommendation."
    report = {"report_id": ident("rp"), "dossier_id": dossier["dossier_id"], "generated_at": now(), "placeholder": placeholder, "sections": report_sections(dossier, overlay), "footer": footer}
    matched = [patient for patient in overlay["patients"] if patient["risk_level"]]
    prompt = ("You are the clinical evidence reviewer for a physician's patient panel. Write the panel report and a brief for a spoken assistant. Return JSON only with the keys title, question, supports (array of strings), does_not_support (array of strings), and voice_brief. "
              "supports and does_not_support say what the dossier sources do and do not support for the flagged charts. voice_brief is 80 to 150 words the spoken assistant will use to walk the physician through the panel: the question, what the evidence supports and does not, and the pattern across the flagged charts. "
              "Speak about the flagged charts as a group. Never put a name or a patient ID in any text. Never prescribe. Use only this dossier and these assessments. "
              + json.dumps({"question": question, "dossier": {"sources": dossier.get("sources"), "findings": dossier.get("findings")}, "flagged": [{key: patient.get(key) for key in ("patient_id", "risk_level", "reasons", "mismatches", "clinician_note")} for patient in matched]}))
    summary = await grok_json(prompt, COHORT_MODEL, COHORT_TIMEOUT)
    if summary: report["model_summary"] = {key: summary.get(key) for key in ("title", "question", "supports", "does_not_support")}
    else: report["footer"] += " The report summary is built-in text because the model did not respond."
    failed = overlay["assessment"]["rules_fallback"] + overlay["assessment"]["rules_only"]
    if failed: report["footer"] += f" {failed} of {len(cohort)} charts were matched by rules only, without a model review."
    report["voice_brief"] = {"panel": (summary or {}).get("voice_brief") if isinstance((summary or {}).get("voice_brief"), str) else None, "patients": {patient["patient_id"]: reviews[patient["patient_id"]].get("voice_brief") for patient in matched if patient["assessed_by"] == "agent"}}
    report["note_briefs"] = {patient["patient_id"]: {"context": reviews[patient["patient_id"]].get("note_context"), "points": [{"text": reason["text"], "plain_language": reason.get("plain_language")} for reason in patient["reasons"]]} for patient in matched if patient["assessed_by"] == "agent"}
    return overlay, report, traces

def voice_context(run: dict) -> str | None:
    """What the voice agent may talk about, written by Agent 2. None for runs saved before Agent 2 wrote briefs."""
    report = run.get("report") or {}; briefs = report.get("voice_brief") or {}; summary = report.get("model_summary") or {}
    if not briefs.get("panel") and not briefs.get("patients"): return None
    lines = [f"Report {report.get('report_id')}.", str(summary.get("question") or (report.get("sections") or {}).get("question") or ""), briefs.get("panel") or ""]
    for patient in (run.get("overlay") or {}).get("patients") or []:
        if not patient.get("risk_level"): continue
        brief = (briefs.get("patients") or {}).get(patient["patient_id"]) or " ".join(reason.get("text", "") for reason in patient.get("reasons") or [])
        lines.append(f"{patient['display_name']}, {patient['risk_level']}: {brief}")
    return " ".join(line for line in [*lines, report.get("footer") or ""] if line)

async def personal_message_agent(patient: dict, instruction: str | None, previous: str | None = None) -> dict:
    """A message with no findings in it, written only from what the physician asked for."""
    if not (instruction or "").strip(): raise HTTPException(400, "Tick at least one point, or say what the message should be about")
    prompt = ("You are writing a short personal message from a care team to one of their patients. Return JSON only, with the keys subject and body. "
              "Write to the patient directly as 'you', signed 'Your care team'. Open with a greeting that uses their first name. "
              "The message is about what the physician asked for below and nothing else. Use only the details the physician gave. Do not add a date, a time span, an event, a person, a place, or any other fact they did not say; if a detail is missing, leave it out. "
              "Do not mention test results, measurements, diagnoses, research, or the chart. Do not give advice, and do not name any medicine, dose, study, paper, or PMID. Do not mention any other patient. Do not mention AI or software. If the physician asked for any of those things, leave that part out without comment and write the rest. "
              "Keep it warm and brief: 80 words at most unless the physician asks for more. "
              + json.dumps({"name": patient["name"], "physician_asked_for": instruction.strip()}))
    if previous: prompt += " This is a rewrite of the draft below. Keep what fits the request above and drop everything else, including any medical content. Draft to rewrite: " + json.dumps(previous)
    model = await grok_json(prompt, NOTE_MODEL)
    # There are no points to fall back on, so a failed write is reported instead of filled with a template.
    if not (model and {"subject", "body"} <= model.keys()): raise HTTPException(502, "The writer could not write this message." + (" Your text is unchanged." if previous else ""))
    blocked = safety_blocks(model["body"], patient["id"])
    return {"draft_id": ident("dr"), "patient_id": patient["id"], "run_points": [], "personal": True, "model_draft": model, "edited_text": model["body"], "approved": False, "blocked_terms": blocked, "created_at": now()}

async def patient_message_agent(patient: dict, points: list[str], instruction: str | None, brief: dict | None = None, previous: str | None = None) -> dict:
    if not points: return await personal_message_agent(patient, instruction, previous)
    wording = {point["text"]: point.get("plain_language") for point in (brief or {}).get("points") or []}
    prompt = ("You are writing a short message from a care team to one of their patients. Return JSON only, with the keys subject and body. "
              "Write to the patient directly as 'you', signed 'Your care team'. Open with a greeting that uses their first name. "
              "Each point below is the physician's own chart-review shorthand. Do not repeat it word for word. Where a point comes with plain_language from the clinical reviewer, build your sentence on that, and follow reviewer_context for tone and emphasis. Otherwise say what the point means in everyday words: name the body part and what the measurement tells us, and explain any number you keep in a few plain words. "
              "Say the care team has been reviewing recent research alongside their chart and would like to talk it over at their next visit. Invite them to bring questions. Keep the tone calm and warm, never alarming. "
              "Sixth-to-eighth-grade reading level, 90 to 140 words, short paragraphs separated by blank lines. "
              "Do not diagnose, predict outcomes, or recommend starting, stopping, or changing any medicine. Do not name any medicine, dose, study, paper, or PMID, and do not comment on which medicines the patient does or does not take; leave out any point that is only about their medicines.Do not mention any other person. Do not mention AI, software, reports, dossiers, or that this is practice or test data. "
              + json.dumps({"name": patient["name"], "points": [{"point": point, "plain_language": wording.get(point)} for point in points], "reviewer_context": (brief or {}).get("context")}))
    if previous: prompt += (" This is a rewrite of the draft below. Write a new version, not the same text. Cover only the points listed above: if the draft talks about something that is not in those points, leave it out. Draft to rewrite: " + json.dumps(previous))
    if instruction and instruction.strip(): prompt += (" The physician asked for this change, and it comes before the length and layout given above: " + json.dumps(instruction.strip()) + " Do exactly that, counting sentences or words if it names a number. Ignore any part of it that would break the rules on medicines, advice, names, or studies.")
    model = await grok_json(prompt, NOTE_MODEL)
    # A failed rewrite must not replace the physician's text with the built-in template.
    if previous and not (model and {"subject", "body"} <= model.keys()): raise HTTPException(502, "The writer could not rewrite this message. Your text is unchanged.")
    draft = model if model and {"subject", "body"} <= model.keys() else {"subject": "A message from your care team", "body": f"Hello {patient['name']},\n\nWe would like to discuss: {' '.join(points)}\n\nThis is a synthetic practice message."}
    blocked = [other["name"] for other in load_cohort() if other["id"] != patient["id"] and other["name"] in draft["body"]] + re.findall(r"PMID\s*\d+|\b(start|stop|double) taking\b", draft["body"], re.I)
    return {"draft_id": ident("dr"), "patient_id": patient["id"], "run_points": points, "model_draft": draft, "edited_text": draft["body"], "approved": False, "blocked_terms": blocked, "created_at": now()}

async def note_prefill_agent(assessment: dict) -> dict:
    """Starting bullets for the physician's own note, condensed from Agent 2's review. No name is sent, and saved notes are never read."""
    review = {"risk_level": assessment.get("risk_level"), "reasons": [reason.get("detail") or reason.get("text") for reason in assessment.get("reasons") or []], "mismatches": assessment.get("mismatches") or [], "checks": assessment.get("clinician_checks") or ([assessment["clinician_note"]] if assessment.get("clinician_note") else [])}
    prompt = ("You are drafting a physician's private chart note about one of their patients, from an evidence review of that chart. Return JSON only, with the key bullets: an array of 3 to 5 strings. "
              "Each bullet is one thing worth remembering about this chart at the next visit: the finding that matters, the gap in the evidence, or the thing to check. 14 words at most each, written as the physician's own shorthand, no closing full stop. "
              "Keep every number exactly as given. Do not repeat a point twice. Do not recommend starting, stopping, or changing a medicine. Use only this review. Never include a name or a patient ID. "
              + json.dumps(review))
    model = await grok_json(prompt, NOTE_MODEL)
    bullets = [" ".join(str(bullet).split()) for bullet in (model or {}).get("bullets") or [] if str(bullet).strip()] if isinstance((model or {}).get("bullets"), list) else []
    bullets = [bullet for bullet in bullets if not PRESCRIBING.search(bullet)][:5]
    if bullets: return {"bullets": bullets, "source": "model"}
    # Without the model, the review's own bullets are still a useful start, and the drawer says where they came from.
    return {"bullets": [str(item) for item in [*(reason.get("text") for reason in assessment.get("reasons") or []), *review["checks"]] if item][:5], "source": "review"}

def safety_blocks(text: str, patient_id: str) -> list[str]:
    reasons = []
    for other in load_cohort():
        if other["id"] != patient_id and other.get("name") and other["name"] in text:
            reasons.append(f"Another patient's name: {other['name']}")
    for match in re.findall(r"PMID\s*(\d{5,})", text, re.I):
        reasons.append(f"A PMID: {match}")
    if re.search(r"\b(?:start|stop|double) taking\b|\b\d+\s?mg\b", text, re.I):
        reasons.append("Medication instructions are not allowed in a patient message")
    return reasons

def approve_draft(draft: dict, final_text: str) -> dict:
    reasons = safety_blocks(final_text, draft["patient_id"])
    draft["blocked_terms"] = reasons
    if reasons: raise HTTPException(422, " ".join(reasons))
    draft.update({"edited_text": final_text, "approved": True, "approved_at": now()})
    return draft
