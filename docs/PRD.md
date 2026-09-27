# SynapseMed TrialLens — Product Requirements

**Status:** Draft, decisions locked  
**Date:** 26 September 2026  
**Audience:** Product, engineering, and clinical design  
**Data assumption for v1:** Synthetic clinic records only. The system is still designed as if those records were real, so a later move to clinic data does not require a new privacy model.

This document turns the four-agent concept into a buildable product. The choices in section 21 are locked.

---

## 1. Summary

TrialLens helps a physician see which recent clinical literature matters for the patients already in their panel, and talk through that evidence without reading every paper.

The product does four jobs, in order, and only on the server:

1. **Literature agent.** Looks at an anonymized description of the panel’s conditions and biomarkers, searches PubMed, and writes a structured evidence dossier for the next agent.
2. **Cohort agent.** Reads that dossier together with the identified synthetic chart, decides which patients the evidence may concern, drives the cohort graph, and writes the report the physician actually reads.
3. **Voice agent.** Reads that physician report, keeps the scientific nuance, and is the main way the physician discusses the result.
4. **Patient-message agent.** Drafts a plain-language note for one patient, only when the physician asks. The physician approves the exact text, and server code sends it. The model cannot choose the recipient or send by itself.

The physician remains the decision-maker. TrialLens is decision support. It does not diagnose, prescribe, place orders, or tell a patient to start or stop a treatment.

---

## 2. Problem

Relevant trials and reviews move faster than a clinic schedule. A physician can know their panel well and still miss a paper that changes how a subset of those patients should be reviewed.

Search boxes do not solve this. A PubMed query returns papers. It does not say which people in this clinic the paper may concern, what the paper does not show, or how to explain any of it later to a patient.

TrialLens closes that gap in one pass:

- Find recent literature for the conditions and biomarker patterns in the panel.
- Contrast that literature with individual charts.
- Give the physician a sourced, careful report and a conversation about it.
- If the physician wants a patient to receive an explanation, draft that explanation in everyday language, separately from the scientific report, and send it only after the physician approves the exact text.

## 3. Who it is for

**Primary user:** A physician reviewing their own panel. v1 assumes one clinician workspace and one synthetic panel. Multi-physician clinics, shared inboxes, and health-system deployment are later.

**Secondary user:** The patient, and only as the recipient of a message the physician approved. Patients do not log in, search literature, or talk to the voice agent in v1.

**Not a user in v1:** Care coordinators, pharmacists, researchers, or patients’ family members.

## 4. Product principles

1. **Minimum context per agent.** Each agent receives only the fields required for its job. Identified charts never enter the literature search.
2. **The join happens once.** Only the cohort agent is allowed to place evidence next to a named person.
3. **Sources stay attached.** Every scientific claim in the physician report points at a PubMed record the literature agent actually retrieved. The voice agent does not invent papers.
4. **Nuance is the product.** Uncertainty, study design, and mismatch between a trial population and a chart are part of the output, not a disclaimer pasted on the end.
5. **Two languages.** The physician hears academic prose. The patient, if a draft is requested, reads plain language. Those texts are produced by different agents and are not rewrites of each other with a simpler prompt.
6. **Outbound is a separate, smaller system.** The model writes a draft. Server code sends that draft, and only after the physician approves the exact text. A scheduled literature run never sends mail.
7. **Synthetic data is labeled.** The interface and every message say the panel is synthetic. While that flag is set, delivery is allowed only to a configured test inbox, not to whatever address happens to be on the chart.

---

## 5. What v1 includes

- A synthetic panel stored on the server, based on the current clinic cohort file, with stable patient ids.
- A deterministic phenotype projection that strips identifiers before any model call.
- PubMed retrieval through NCBI E-utilities, performed only by the literature agent’s tools.
- An evidence dossier in a versioned JSON schema, stored on the server.
- A cohort contrast that produces graph data and one physician report for the panel.
- A report view and a cohort graph fed by that contrast, replacing today’s keyword match when the pipeline has run.
- A voice session on Grok Voice whose instructions and knowledge are the current physician report and its source list.
- A manual run and a weekday morning scheduled run for the one panel.
- A physician-uploaded PDF, DOCX, or TXT treated as an extra literature source on a run, alongside PubMed.
- A patient-message draft for one selected patient. After the physician approves the exact text, the server sends it.
- An audit record of what each agent was given and what it produced, with identifiers absent from the literature agent’s log.

## 6. Out of scope for v1

- Real patient data, EHR integration, and SMART-on-FHIR.
- Accounts for more than one physician, or a patient login.
- Email that sends itself: no bulk send, no send from the voice agent, and no send from the scheduled literature run.
- SMS, portal messages, or phone calls.
- The voice agent searching PubMed, editing the chart, or drafting patient messages.
- The literature agent reading names, contact details, or free-text notes.
- Full-text purchase or paywall bypass. PubMed abstracts are the retrieval source. A file the physician uploads is an additional source, not a way around a paywall.
- Diagnosis codes as orders, medication changes, or “eligibility” determinations that read like enrollment decisions.
- Claiming the product is a regulated medical device. Copy should describe literature surveillance and clinician review.

---

## 7. Current prototype and the gap

The repo today is a single dashboard and a small API.

| Area | Today | Target |
| --- | --- | --- |
| Literature | One PubMed query from the search box, abstracts only | Literature agent runs one or more PubMed queries from a phenotype, then writes a dossier |
| Matching | Keyword overlap between one abstract and condition strings | Cohort agent contrasts the whole dossier with charts |
| Graph | 3D cohort field driven by that keyword match | Same kind of view, driven by the cohort agent’s overlay |
| Reading | A short study card | A physician report with sources, uncertainty, and per-patient reasons |
| Voice | Grok Voice with a short prompt built in the browser from the selected patient | Grok Voice, with a server-built session bound to a stored report |
| Patient writing | None | Plain-language note, sent only after the physician approves the exact text |
| Runs | Physician clicks search | Manual start and a weekday morning schedule |
| Privacy boundary | The browser holds the seeded panel, including names | The browser receives a view model. The literature agent never receives names |

The seeded fallback in the dashboard can stay for local UI work. It is not the product behavior once the pipeline is available.

---

## 8. Trust boundaries

```text
Physician
   │
   ▼
Frontend  ─────────────── receives view models only
   │
   ▼
TrialLens API
   │
   ├─ Phenotype projector   (code, not a model)
   │     input:  identified synthetic chart
   │     output: PhenotypeBundle with no names, ids, or contacts
   │
   ├─ Agent 1  Literature
   │     tools:  PubMed only
   │     input:  PhenotypeBundle
   │     output: EvidenceDossier
   │
   ├─ Agent 2  Cohort
   │     input:  EvidenceDossier + identified Cohort
   │     output: CohortOverlay + PhysicianReport
   │
   ├─ Agent 3  Voice
   │     input:  PhysicianReport + source list + the patient in focus
   │     output: speech and a transcript
   │     cannot: PubMed, email, chart writes
   │
   └─ Agent 4  Patient message
         input:  one patient + physician-selected points to explain
         output: a draft
         cannot: choose the recipient, send, or see other patients
```

The frontend does not call OpenAI, NCBI, or an email provider. Model keys stay on the server. The voice client, if it needs a browser credential, receives a short-lived secret the way the current voice route does, and that secret cannot do anything except the voice session.

Agent 1 and Agent 2 do not share a conversation. Agent 2 receives the dossier as a document. It does not receive Agent 1’s scratchpad, tool traces, or the original chart fields that were removed.

---

## 9. Synthetic cohort

v1 continues from `backend/data/clinic_cohort.json`: named synthetic adults with conditions, a small set of metrics, and current medications.

Each record needs, in addition to what is there now:

- A stable `patient_id` (already present as `id`).
- An explicit `synthetic: true` flag on the dataset, not only in the UI.
- A contact email used only by the send worker after approval. It is never copied into the phenotype bundle or the dossier. On the synthetic panel that address is not a real patient inbox.
- Units stored with metrics (`eGFR` in mL/min/1.73 m², eosinophils in cells/µL, and so on) so the cohort agent does not guess.
- Sex and exact age on the chart for Agent 2. The current file already has `gender` and `age`.

The dataset remains small enough to inspect by hand. It should include people who do not match the main evidence, so an empty review queue is a successful run, not a failure.

---

## 10. Phenotype bundle

Before Agent 1 runs, ordinary code builds a `PhenotypeBundle`. The model does not write this object and cannot query the cohort to enrich it.

A bundle describes patterns in the panel, not people.

Allowed contents:

- Condition labels, normalized to a small internal vocabulary (`HFpEF`, `CKD`, `severe asthma`, `plaque psoriasis`, and the other conditions in the synthetic file).
- Optional code systems later (ICD-10, SNOMED). v1 may use labels only, as long as they are produced by code from the chart, not free-typed by the model.
- Biomarker bands, for example `eGFR < 45`, `eosinophils >= 300`, `PASI >= 10`. Bands come from fixed thresholds in code. Exact lab values do not leave the chart.
- Medication classes (`SGLT2 inhibitor`, `topical psoriasis therapy`), not dose strings and not drug start dates.
- Counts that are safe in a tiny synthetic set only if we accept they are identifying in a real clinic. **v1 omits per-person counts and omits a list of individuals.** The bundle says which patterns exist, not how many named people have them.
- Age bands and sex as group attributes, derived by code from the chart. Example: `age_bands: ["40-54", "55-64"]`, `sexes_present: ["female", "male"]`. This is not a roster and not a list of exact ages. Exact age stays on the chart for Agent 2.

Forbidden in the bundle and anywhere in Agent 1’s prompt or tools:

- Name, id, medical record number, address, phone, email
- Exact date of birth or exact age
- Free-text notes, letters, or prior agent reports
- Another patient’s record

The API stores the bundle next to the dossier so a reviewer can see what was searched, and so a test can fail if a forbidden field appears.

---

## 11. Agent 1 — Literature

### Job

Given a phenotype bundle, search PubMed for recent, relevant clinical literature and return an evidence dossier. The dossier is the handoff. It is not the document the physician reads.

### Tools

- NCBI E-utilities: esearch and efetch, as the current `backend/services/pubmed.py` client already does, extended to record the query, the date, the sort, and the PMIDs returned.
- Read a PDF, DOCX, or TXT the physician attached to this run. The file is literature, analyzed without the chart. Its findings enter the dossier as a source with a `file:` id and a null PMID.
- No cohort database tool.
- No web browsing, no email, no patient id lookup.

The agent may issue several queries if the bundle contains more than one condition cluster (heart failure and kidney disease in one search, psoriasis in another). Each query is stored on the dossier.

### Retrieval rules

- Default window: publications from the last five years, with a small number of older landmark trials only when a recent paper cites them and the abstract is available. The dossier marks anything outside the window as `landmark: true`.
- Prefer human clinical studies: trials, meta-analyses, systematic reviews, and large cohort studies. Case reports are included only when the bundle is rare and nothing stronger came back, and they are labeled as such.
- Cap the sources that enter the dossier (proposed: 12). The agent must say which retrieved PMIDs were left out and why, in one line each, so silence is not mistaken for a negative search.
- Store the abstract text that was actually fetched. Later claims have to be supportable from that text or be marked `not_stated_in_source`.
- Do not invent sample sizes, hazard ratios, or p-values. If the abstract does not report a figure, the field is null.

### Model

Agent 1 uses an OpenAI model with tool calling. The exact model name is a configuration value, not a hard-coded product requirement. Uploaded files are an input to this agent. They are not a second, separate Grok analysis path. Agent 3 remains on Grok Voice.

### Output format

**Requirement:** Agent 1 returns JSON that validates against `EvidenceDossier` schema version `1.0`. It does not return a prose paper, a PDF, or a markdown article.

A prose “research paper” is a poor handoff. The next agent has to find populations, endpoints, conflicts, and PMIDs reliably. Free text drops negatives and mixes the claim with the source. JSON keeps those pieces addressable. The scientific detail still lives in prose, inside specific fields, so the dossier is not a pile of tags.

The physician never sees this JSON. Agent 2 is the reader.

#### EvidenceDossier 1.0

```json
{
  "dossier_version": "1.0",
  "dossier_id": "ed_01J...",
  "generated_at": "2026-09-26T18:00:00Z",
  "phenotype_bundle_id": "pb_01J...",
  "retrieval": {
    "source": "ncbi_pubmed_eutilities",
    "window": { "from": "2021-01-01", "to": "2026-09-26" },
    "queries": [
      {
        "query_id": "q1",
        "term": "heart failure preserved ejection fraction SGLT2",
        "result_count": 42,
        "pmids_fetched": ["37622681"],
        "pmids_omitted": [{ "pmid": "123", "reason": "animal study" }]
      }
    ]
  },
  "sources": [
    {
      "source_id": "pmid:37622681",
      "pmid": "37622681",
      "title": "",
      "journal": "",
      "publication_date": "2023",
      "publication_types": ["Journal Article"],
      "abstract": "",
      "pubmed_url": "https://pubmed.ncbi.nlm.nih.gov/37622681/",
      "landmark": false
    }
  ],
  "findings": [
    {
      "finding_id": "f1",
      "statement": "One sentence a clinician would accept as a careful claim.",
      "design": "randomized_trial | meta_analysis | systematic_review | cohort | other",
      "population": "Who was studied, in the paper's terms.",
      "intervention_or_exposure": "",
      "comparator": "",
      "outcome": "",
      "direction": "benefit | harm | null | mixed | uncertain",
      "effect": {
        "measure": "HR",
        "value": null,
        "interval": null,
        "as_reported": false,
        "source_quote": ""
      },
      "source_ids": ["pmid:37622681"],
      "limitations": "What makes this a weak or narrow claim.",
      "conflicts_with": []
    }
  ],
  "applicability_hints": [
    {
      "hint_id": "h1",
      "phenotype_features": ["HFpEF", "reduced eGFR"],
      "finding_ids": ["f1"],
      "why_it_may_apply": "",
      "why_it_may_not": "",
      "safety_notes": []
    }
  ],
  "gaps": [
    "What a physician might expect to find that this search did not return."
  ]
}
```

Validation rejects a dossier when:

- A PubMed `source_id` is missing a PMID that was fetched in this run. An uploaded file uses a `file:` id and a null PMID, and it must name the stored file.
- A finding cites a source id that is not in `sources`.
- `effect.as_reported` is true but `value` is null, or `as_reported` is false while `value` is filled in.
- Any string matches a name, patient id, or email from the cohort. That check is a fixture test, not a prompt instruction alone.

Applicability hints describe phenotype features. They do not name patients. Naming patients is Agent 2’s job, after the dossier is closed.

---

## 12. Agent 2 — Cohort contrast and physician report

### Job

Read one evidence dossier and the identified synthetic cohort. Produce:

1. A **cohort overlay** the graph and the patient list can render.
2. A **physician report** in academic prose.
3. A **source pack**: the citations the report actually used, in reading order.

### Input

- The validated dossier.
- The cohort records, including names, ids, ages, conditions, metrics, and medications.
- Nothing from Agent 1 except the dossier. No tool-call transcript.

Agent 2 does not search PubMed. If the dossier is too thin, the report says so and names the gap. It does not quietly run another search.

### Cohort overlay

Each patient is either unmatched or matched to one or more findings.

```json
{
  "overlay_id": "ov_01J...",
  "dossier_id": "ed_01J...",
  "patients": [
    {
      "patient_id": "PT-104",
      "display_name": "Marcus Vance",
      "risk_level": "CRITICAL | HIGH | MODERATE",
      "finding_ids": ["f1"],
      "reasons": [
        {
          "text": "HFpEF with eGFR 38 mL/min/1.73 m² sits inside the renal range discussed in f1.",
          "chart_fields": ["conditions", "metrics.eGFR"],
          "finding_id": "f1"
        }
      ],
      "mismatches": [
        "The trial enrollment criteria are not fully visible in this chart."
      ],
      "clinician_note": "Review whether the cited population is close enough to matter at the next visit."
    }
  ]
}
```

Matched patients keep the prototype labels. The legend caption reads “Evidence match,” so the badge is not presented as a measure of how sick someone is.

- **CRITICAL** — the chart lines up with a finding and there is a safety or applicability issue to see first.
- **HIGH** — there is a real alignment, without that extra safety signal.
- **MODERATE** — related condition, weak or indirect evidence.

Unmatched patients are still returned, with no `risk_level` and no edge, so the graph can show the rest of the panel as quiet nodes. The report does not invent a reason to include them.

`clinician_note` is a review prompt. It is not a treatment recommendation. The strings “start”, “stop”, “prescribe”, and “eligible for enrollment” are not allowed in that field unless the physician typed them later. v1 copy uses “review”, “compare”, and “discuss”.

### Physician report

One report per pipeline run, covering the panel, with a short section per matched patient. Unmatched patients are listed once, as not implicated by this dossier.

The report is stored as structured sections plus rendered markdown, so the voice agent can load a section without scraping headings.

Required sections, in this order:

1. **Question this run asked.** The phenotype in one paragraph. No names in this section.
2. **What the recent literature supports.** Findings in academic prose, each tied to a journal, year, and PMID. Study design is named. Effect estimates appear only when `as_reported` is true, and they are quoted as reported rather than recalculated.
3. **What it does not support.** Gaps, conflicts, and populations that do not match the charts.
4. **Patients to review.** For each matched person: name, id, the chart facts used, the finding ids, why the contrast was made, and why it might be wrong.
5. **Sources.** PMID, title, journal, year, link.

Tone: the way a careful colleague briefs another physician. Hedged where the evidence is hedged. No marketing language, no “breakthrough”, no second person (“you should”). Numeric claims that are not in the dossier are a failed report.

The report carries a fixed footer: this is decision support from synthetic records, and it is not a treatment recommendation.

### Graph contract

The 3D cohort field stays the main view.

- Center node: the dossier, labeled with the lead question, not a single paper title unless the run only cited one paper.
- Surrounding nodes: patients.
- An edge exists only for a patient who has a `risk_level`.
- Color maps to `CRITICAL`, `HIGH`, and `MODERATE`, using the same palette as the prototype. Quiet nodes stay slate.

The overlay is the only data the graph needs. The graph does not re-run matching in the browser.

---

## 13. Agent 3 — Voice

### Job

Be the physician’s conversation about the current report. This is the main interaction, not a side feature on top of search.

### What it knows at session start

A server-built context pack:

- The physician report for this run.
- The source pack (titles, journals, years, PMIDs, and the finding statements).
- The patient currently in focus, if the physician opened someone from the graph or the list. If nobody is in focus, the pack is the panel report and the agent says it is discussing the panel.
- The synthetic-data flag and the decision-support footer.

It does not receive the raw cohort file, other runs, Agent 1’s tool logs, or any patient’s contact details.

### Behavior

- Speak in the same academic register as the report, but in sentences that can be said aloud. Short enough to answer, willing to go deeper if asked.
- Cite the study the way a person would: journal, year, and what kind of study it was. Offer the PMID if asked.
- If the physician asks for something the report does not contain, say it is not in this dossier. Do not fill the hole with general medical knowledge presented as if it came from the search.
- If asked what to prescribe, decline and point back to the review notes.
- If asked to email a patient or to look up a different person by guessing, decline. Drafting is a separate action in the interface, not a voice tool.
- Stay on this report. A request to “search again” is a new pipeline run, started from the UI, not a tool inside the call.

### Session mechanics

- The browser receives a short-lived voice credential, as it does today.
- Session length is bounded (the current voice secret is five minutes; keep a short bound).
- Transcript and the report id are stored with the run so the physician can see what was said.
- Ending the session stops the microphone and discards the live credential.

Agent 3 uses Grok Voice (`grok-voice-latest`), with the same short-lived client-secret pattern as the prototype. The permanent xAI key stays on the server. The context pack is what changes: the session is briefed on the stored report, not on a prompt assembled in the browser.

---

## 14. Agent 4 — Patient message

### Job

Write one plain-language note for one patient. The physician edits it if they want, approves the exact text, and the server sends that text.

### Why this agent is separate

The physician report is a bad source to paraphrase into a patient letter. It is full of study design, PMIDs, and other people’s contrasts. A writing pass over that document will leak cohort details or keep an academic tone. Agent 4 gets a much smaller packet.

### Who can start it

Only an explicit physician action on one selected patient: “Draft a note for this patient.” The voice agent cannot call it. A pipeline run cannot call it. There is no “email the flagged patients” action.

### Input packet

- That patient’s name and the greeting the physician would use.
- The model does not receive the email address. After approval, server code copies the address for delivery. On a synthetic panel, delivery is forced to the configured test inbox even if the chart contains something else.
- A physician-selected list of points, each point being a sentence the physician confirmed from the report. The model does not receive the rest of the report, the dossier, or other patients.
- Optional physician instruction in plain language (“mention that we can talk at Thursday’s visit”).
- Reading-level target and a banned-phrase list.

If the physician selects nothing, the product does not guess the content. It asks them to pick at least one point.

### Output

A subject line and a body.

Style requirements:

- Written for an adult with no medical training.
- Short sentences and short paragraphs. Target about a sixth- to eighth-grade reading level. This is checked with a simple readability score in the API, and the draft is regenerated once if it misses by a wide margin.
- No PMID, no journal name, no hazard ratio, no confidence interval, no “trial showed a 20% reduction” unless the physician’s selected point already said that in plain words.
- Any medical term that must stay is defined in the same sentence.
- The sender is the physician, not the software. The draft does not say “an AI reviewed your chart.”
- It does not tell the patient to start, stop, or change a medicine. It can say the physician wants to discuss something at the next visit.
- It does not mention other patients, the cohort, scores, or “you were flagged.”
- Synthetic messages include a visible line that the panel is synthetic and the note is a practice message.

The physician can edit the draft in the UI. The stored record keeps the model draft and the edited text separately. Send uses the edited text only after approval, and any further edit clears that approval.

### Outbound security

- **No recipient selection by the model.** The send worker copies the address from that one chart after the physician approves the exact bytes on screen. While `synthetic` is true, the worker ignores the chart address and delivers only to `PATIENT_MAIL_SINK`, a single configured test inbox. If that variable is unset, send refuses.
- **Approval is of the final text.** The physician approves, then the product sends. Editing after approval invalidates approval.
- **The outbound worker is not the model.** The mail provider key lives only on that worker. Agent 4’s prompt never sees it, and the worker does not call a model.
- **No attachments** in v1, and no link that opens the dossier or another patient’s page.
- **No inbound mail.** Replies are not read by an agent in v1.
- **No bulk and no automatic send.** One patient, one approved note. The scheduled literature run does not create drafts.
- **Audit.** Draft requested, patient id, selected point ids, model draft hash, edited text hash, approval time, sink or recipient used, and provider message id. Logs do not store the whole cohort.
- **Content check before send.** Server-side scan for other patients’ names and ids, PMIDs, and instruction phrases (“stop taking”, “start taking”, “double your dose”). A hit blocks send. The physician can edit and try again. They cannot override the scan with a checkbox.

---

## 15. Backend

All four agents run in the API process or in workers it controls. Proposed shape, replacing the keyword audit as the primary path:

| Step | Owner | Result |
| --- | --- | --- |
| `POST /api/runs` | API | Creates a run from the synthetic cohort. Also invoked by the weekday schedule. |
| `POST /api/runs` with a file | API | Same run, plus one uploaded PDF, DOCX, or TXT for Agent 1 |
| Phenotype projection | Code | `PhenotypeBundle`, including age bands and sexes present |
| Literature | Agent 1 | `EvidenceDossier` |
| Contrast | Agent 2 | `CohortOverlay` + one panel `PhysicianReport` |
| `GET /api/runs/{id}` | API | Overlay, report, and sources for the graph and the report pane |
| `POST /api/runs/{id}/voice/session` | API | Short-lived Grok Voice credential bound to that report |
| `POST /api/runs/{id}/patients/{patient_id}/draft` | Agent 4 | A draft for that patient |
| `POST /api/drafts/{id}/approve` | API | Approves the exact text and asks the send worker to deliver it |

The schedule is one run per weekday morning in the physician’s timezone, default `07:00`. It uses the full panel and does not attach a file. The physician can also start a run at any time. A scheduled run that finds no matches still completes and is shown as an empty review queue.

The existing routes (`/api/literature/search`, `/api/audit/cohort`, `/api/evidence/ingest`, `/api/voice/session`) can remain during the rewrite as a compatibility layer, then be removed once the UI calls runs only.

Persistence for v1 can be files or a single local database. The objects above are the contract. A run is immutable after Agent 2 finishes. A new pass creates a new run. Drafts hang off a run and a patient.

Failures:

- PubMed down or empty: the run completes with an empty source list and a report that says the search returned nothing. The UI does not fall back to a canned study and present it as this run.
- Dossier fails validation: the run fails visibly. Agent 2 does not “repair” a dossier that cites papers it did not fetch.
- Voice credential fails: the report and graph still work.
- Draft fails the content check: send is blocked and the physician sees the warning.
- `PATIENT_MAIL_SINK` is unset on a synthetic panel: approval is stored and send refuses.

---

## 16. Frontend

v1 keeps the current graph-first screen. The 3D cohort field remains the orientation view. The physician report opens beside it. Voice stays attached to the selected node. The backend contracts are the overlay and the panel report, so a later visual pass does not need a new data model.

The screen has to:

1. Show that the panel is synthetic.
2. Start a run, show the next scheduled run, and show progress across literature, contrast, and report.
3. Let the physician read the panel report, with sources that open PubMed, and upload a paper onto a manual run.
4. Show which patients were implicated, why, and which chart fields were used, using `CRITICAL`, `HIGH`, and `MODERATE`.
5. Show patients who were not implicated, including a completed run whose review queue is empty.
6. Open Grok Voice on the current report, and show who is in focus.
7. Offer “Draft a note” only from a selected patient, after the physician picks the points to include, then require approval of the exact text before send.
8. Keep model output in those slots. The browser does not re-rank patients with its own keyword rules once a run exists.

The current search box that sends a free-text PubMed query from the browser is retired as the primary control. The physician starts a run for the panel, or waits for the weekday run.

---

## 17. Clinical safety

- Every physician-facing surface includes the decision-support line.
- `CRITICAL`, `HIGH`, and `MODERATE` are evidence-match labels carried over from the prototype. They are not a validated acuity score. The legend caption says “Evidence match.”
- The product does not compute new medical scores beyond the bands in the phenotype code.
- Conflicts in the literature are shown, not averaged away.
- Agent 3’s refusal to prescribe is part of acceptance testing, not only a prompt line.
- Patient drafts are not clinical advice. The allowed act is explaining that the physician wants a conversation.

---

## 18. Privacy and security requirements

Even with synthetic data:

- Literature requests are logged and snapshotted in tests against a forbidden-term list built from the cohort (names, ids, emails).
- Agent prompts are assembled on the server from stored objects, not from arbitrary browser JSON merged into the system prompt.
- CORS stays limited to the app origin.
- Secrets (`OPENAI_API_KEY`, `XAI_API_KEY`, and the mail provider key) are environment variables on the server. They are not `NEXT_PUBLIC_*`. The mail key is readable only by the send worker.
- Voice credentials expire quickly and are scoped to realtime speech.
- Run storage is local and private in v1. There is no public share link for a report.
- The UI does not put the dossier JSON in the page for convenience. If an engineer needs it, it is an authenticated debug route that is off by default.

When real data becomes possible, the same boundaries have to hold. v1 does not add EHR access “temporarily” without a new review of this document.

---

## 19. Acceptance criteria

A v1 run is acceptable when:

1. Starting a run with the synthetic cohort produces a dossier that validates, and the PubMed queries are stored on it.
2. A test patient name from the cohort does not appear in the phenotype bundle, the dossier, or the Agent 1 request log.
3. The overlay’s edges correspond to finding ids that exist in the dossier, and at least one synthetic patient is correctly left unmatched for a psoriasis-only dossier or a heart-failure-only dossier.
4. The physician report cites only PMIDs present in that dossier, and every number it quotes is `as_reported`.
5. The graph renders `CRITICAL`, `HIGH`, and `MODERATE` from the overlay without a second matching pass in the browser, and unmatched patients stay on the graph with no edge.
6. A run with no matches completes, shows an empty review queue, and is treated as success.
7. Voice answers a question about a cited study using the report, and answers “what should I prescribe?” without a medication instruction. The session uses a Grok Voice client secret minted on the server.
8. A patient note can be created only after a patient and at least one point are selected. The draft contains no other patient’s name and no PMID. Send happens only after approval of the exact text. On the synthetic panel, the message is delivered only to `PATIENT_MAIL_SINK`. A scheduled run does not send mail.
9. An uploaded PDF on a manual run appears in the dossier as a `file:` source and can be cited by the report.

---

## 20. Suggested build order

1. **Phenotype projector and dossier schema**, with the forbidden-term test, before any model prompt is trusted.
2. **Agent 1 against live PubMed**, saved as a run.
3. **Agent 2 overlay and report**, shown in the existing layout with as little visual change as possible.
4. **Retire browser-side keyword audit** for pipeline runs.
5. **Bind Grok Voice to the stored report.**
6. **Patient drafts, approval, and send** through the test inbox.
7. **Weekday schedule**, after a manual run is trustworthy.

Keep the current 3D layout while steps 1–3 land. Do not redesign the screen before the overlay and the panel report are frozen.

---

## 21. Locked decisions

Confirmed for v1:

1. **One physician, one synthetic panel.** Multi-physician access waits.
2. **Runs start both ways.** The physician can start one, and the server starts one each weekday at 07:00 in their timezone.
3. **Agent 1 receives age bands and sex as group attributes,** plus conditions and biomarker bands. It does not receive names, ids, exact ages, or a roster.
4. **Agent 3 stays on Grok Voice.** Agent 1 is OpenAI.
5. **The frontend stays graph-first.** The 3D cohort field remains the main view, with the report beside it.
6. **Patient messages are sent in v1** after the physician approves the exact text. Synthetic delivery goes only to a configured test inbox.
7. **One panel report per run,** with a section for each matched patient.
8. **Uploaded PDF, DOCX, and TXT stay in v1** as extra literature sources on a manual run.
9. **Match labels stay `CRITICAL`, `HIGH`, and `MODERATE`.** The legend caption says they are evidence matches.
10. **An empty review queue is a successful run** and should be demoed on purpose.
