"""Server-side xAI integration. Never expose XAI_API_KEY to the browser."""
import os
import httpx
from fastapi import HTTPException

XAI_URL = "https://api.x.ai/v1"

def _headers():
    key = os.getenv("XAI_API_KEY")
    if not key:
        raise HTTPException(503, "XAI_API_KEY is not configured on the API server")
    return {"Authorization": f"Bearer {key}"}

async def ingest_trial_paper(content: bytes, filename: str, content_type: str | None) -> dict:
    """Upload the original paper and ask Grok 4.7 to analyse the full document."""
    if len(content) > 50 * 1024 * 1024:
        raise HTTPException(413, "Trial paper must be 50 MB or smaller")
    async with httpx.AsyncClient(timeout=120.0) as client:
        upload = await client.post(
            f"{XAI_URL}/files",
            headers=_headers(),
            files={"file": (filename, content, content_type or "application/pdf")},
        )
        if upload.is_error:
            raise HTTPException(upload.status_code, f"xAI upload failed: {upload.text[:300]}")
        file_id = upload.json()["id"]
        prompt = """You are TrialLens, a clinical evidence analyst. Read the entire attached trial paper. Return concise JSON only with: title, journal, publication_date, key_findings, inclusion_criteria (array), exclusion_criteria (array), target_biomarkers (object), safety_signals (array), and abstract. Do not prescribe treatment. State uncertainty where the paper is unclear."""
        analysis = await client.post(
            f"{XAI_URL}/responses",
            headers={**_headers(), "Content-Type": "application/json"},
            json={"model": "grok-4.7", "reasoning_effort": "high", "input": [{"role": "user", "content": [{"type": "input_text", "text": prompt}, {"type": "input_file", "file_id": file_id}]}]},
        )
        if analysis.is_error:
            raise HTTPException(analysis.status_code, f"Grok analysis failed: {analysis.text[:300]}")
    result = analysis.json()
    output_text = result.get("output_text") or next((part.get("text", "") for item in reversed(result.get("output", [])) for part in item.get("content", []) if part.get("type") == "output_text"), "")
    return {"file_id": file_id, "response_id": result.get("id"), "analysis": output_text, "model": "grok-4.7"}

async def create_voice_secret() -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(f"{XAI_URL}/realtime/client_secrets", headers={**_headers(), "Content-Type": "application/json"}, json={"expires_after": {"seconds": 300}})
    if response.is_error:
        raise HTTPException(response.status_code, f"Voice session setup failed: {response.text[:300]}")
    return response.json()
