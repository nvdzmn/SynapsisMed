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

## xAI / Grok setup

Set `XAI_API_KEY` in the environment running FastAPI. TrialLens uploads paper files server-side and has Grok 4.7 analyse the attached full document. Voice triage uses a five-minute scoped client secret for `grok-voice-latest`; the permanent xAI key is never sent to the browser.
