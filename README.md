# SynapseMed / TrialLens

Clinical evidence-to-cohort surveillance prototype with a Next.js dashboard and FastAPI API.

## Run the dashboard

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The UI gracefully uses seeded evidence when the API is not running.

## Run the API

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000` to enable live PubMed search and cohort audits.

## Backend agent pipeline

The `backend-agent-pipeline` branch adds the PRD backend contract. Start FastAPI from `backend/`, then call `POST /api/runs` (optionally multipart with `file`) and use `GET /api/runs/{run_id}` to render the completed graph/report view model. The API retains raw dossiers and the synthetic cohort server-side.

To use a Synthea download, place its CSV export under `backend/data/synthea_csv/` with `patients.csv`, `conditions.csv`, `observations.csv`, and `medications.csv`. The adapter uses it automatically; absent demo-only biomarkers are deterministically marked/derived in code so a downloaded export can still drive the demo.

Agent assignments for the demo are: Agent 1 uses a configurable OpenAI model (`OPENAI_MODEL`, default `gpt-4.1-mini`), Agent 2 and Agent 4 use Grok 4.7, and Agent 3 uses Grok Voice.

## xAI / Grok setup

Set `XAI_API_KEY` in the environment running FastAPI. TrialLens uploads paper files server-side and has Grok 4.7 analyse the attached full document. Voice triage uses a five-minute scoped client secret for `grok-voice-latest`; the permanent xAI key is never sent to the browser.

Set `OPENAI_API_KEY` to enable Agent 1 model synthesis after PubMed retrieval. Without provider keys, deterministic contract-preserving demo fallbacks are used; provider failures never substitute a canned study. Set `PATIENT_MAIL_SINK` before approving a synthetic patient message—delivery otherwise refuses.
