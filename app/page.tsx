"use client";

import { Activity, BookOpen, FileUp, LoaderCircle, Mic, Search, ShieldCheck, Wifi } from "lucide-react";
import { useMemo, useState } from "react";
import PatientCohortPanel from "../components/PatientCohortPanel";
import Visualizer3D from "../components/Visualizer3D";
import VoiceTriageModal from "../components/VoiceTriageModal";
import type { CohortMatch, IngestResponse, PaperAnalysis, Patient, Study } from "../lib/types";

const patients: Patient[] = [
  { id: "PT-104", name: "Marcus Vance", age: 58, conditions: ["Type 2 Diabetes Mellitus", "Heart Failure with Preserved EF", "Chronic Kidney Disease"], metrics: { eGFR: 38, LVEF: 52 } },
  { id: "PT-209", name: "Elena Rostova", age: 64, conditions: ["Refractory Plaque Psoriasis", "Psoriatic Arthritis"], metrics: { PASI: 16.5, eGFR: 72 } },
  { id: "PT-312", name: "David Okafor", age: 49, conditions: ["Severe Uncontrolled Asthma", "Eosinophilia"], metrics: { Eosinophils: 480 } },
  { id: "PT-405", name: "Sarah Jenkins", age: 71, conditions: ["Heart Failure", "Chronic Kidney Disease Stage 3"], metrics: { eGFR: 42, LVEF: 48 } },
  { id: "PT-508", name: "Michael Chang", age: 53, conditions: ["Hypertension", "Dyslipidemia"], metrics: { eGFR: 88, LVEF: 60 } },
  { id: "PT-617", name: "Anika Shah", age: 39, conditions: ["Eosinophilic Asthma", "Atopic Dermatitis"], metrics: { Eosinophils: 620, FEV1: 58 } },
];

const seededStudy: Study = {
  pmid: "37622686",
  title: "Semaglutide in Patients with Heart Failure with Preserved Ejection Fraction and Obesity",
  journal: "New England Journal of Medicine",
  publication_date: "2023",
  abstract: "Heart failure with preserved ejection fraction and chronic kidney disease trial evaluating semaglutide. Patients with HFpEF and eGFR criteria showed improved symptoms and clinical outcomes.",
  key_findings: "Evidence signal: symptom improvement and fewer heart failure events among eligible patients.",
};

const seedMatches: CohortMatch[] = [
  { patient: patients[0] as Patient, risk_level: "CRITICAL", match_reasons: ["HFpEF with eGFR 38 mL/min meets the kidney-risk evidence signal"], recommended_action: "Prioritize renal and heart-failure review" },
  { patient: patients[3] as Patient, risk_level: "HIGH", match_reasons: ["Heart failure with LVEF 48% aligns with study cohort"], recommended_action: "Review trial eligibility and care plan" },
];

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function Home() {
  const [query, setQuery] = useState("heart failure SGLT2 preserved ejection fraction");
  const [ingesting, setIngesting] = useState(false);
  const [study, setStudy] = useState<Study>(seededStudy);
  const [matches, setMatches] = useState<CohortMatch[]>(seedMatches);
  const [loading, setLoading] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [selected, setSelected] = useState<Patient | null>(null);
  const [mode, setMode] = useState("Seeded evidence");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  const selectPatient = (patient: Patient) => {
    setSelected(patient);
    setVoiceOpen(true);
  };

  const runAudit = async () => {
    setLoading(true);
    try {
      const results = await fetch(`${apiUrl}/api/literature/search?q=${encodeURIComponent(query)}`).then((response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<Study[]>;
      });
      const nextStudy = results[0];
      if (!nextStudy) throw new Error();
      setStudy(nextStudy);
      const audit = await fetch(`${apiUrl}/api/audit/cohort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ abstract: nextStudy.abstract }),
      }).then((response) => response.json() as Promise<{ matched_patients?: CohortMatch[] }>);
      setMatches(audit.matched_patients || []);
      setMode("Live PubMed");
    } catch {
      const isDerm = /psoria|biologic/i.test(query);
      setStudy(
        isDerm
          ? {
              ...seededStudy,
              pmid: "38521632",
              title: "Targeted biologic therapy in refractory plaque psoriasis",
              journal: "Dermatology Evidence Review",
              abstract: "Psoriasis biologic trial for refractory plaque psoriasis and psoriatic arthritis.",
              key_findings: "Evidence signal: biologic escalation in treatment-refractory disease.",
            }
          : seededStudy,
      );
      setMatches(
        isDerm
          ? [{ patient: patients[1] as Patient, risk_level: "HIGH", match_reasons: ["Refractory plaque psoriasis with PASI score 16.5 aligns with trial"], recommended_action: "Evaluate biologic eligibility" }]
          : seedMatches,
      );
      setMode("Seeded fallback");
    } finally {
      setLoading(false);
    }
  };

  const ingestPaper = async (file?: File) => {
    if (!file) return;
    setIngesting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await fetch(`${apiUrl}/api/evidence/ingest`, { method: "POST", body: form }).then(async (response) => {
        if (!response.ok) {
          const body = (await response.json()) as { detail?: string };
          throw new Error(body.detail || "Paper ingestion failed");
        }
        return response.json() as Promise<IngestResponse>;
      });
      const parsed = JSON.parse(data.analysis.replace(/^```json\s*|\s*```$/g, "")) as PaperAnalysis & { analysis?: string };
      setStudy({
        ...parsed,
        pmid: data.file_id,
        journal: parsed.journal || "Full trial paper",
        title: parsed.title || file.name,
        key_findings: parsed.key_findings || parsed.analysis,
        abstract: parsed.abstract || JSON.stringify(parsed.inclusion_criteria || []),
      });
      setMode("Grok 4.7 full-paper analysis");
    } catch (err) {
      window.alert(errorMessage(err, "Paper ingestion failed. Check XAI_API_KEY on the API server."));
    } finally {
      setIngesting(false);
    }
  };

  const critical = useMemo(() => matches.filter((item) => item.risk_level === "CRITICAL").length, [matches]);

  return (
    <main className="min-h-screen bg-[#060b16] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/85 px-5 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-300 to-blue-600 font-bold text-slate-950 shadow-lg shadow-sky-500/20">Ω</div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                SynapseMed <span className="text-sky-400">/ TrialLens</span>
              </h1>
              <p className="text-[10px] tracking-wide text-slate-500">AUTONOMOUS EVIDENCE-TO-COHORT SURVEILLANCE</p>
            </div>
          </div>
          <button onClick={() => setVoiceOpen(true)} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-blue-500 px-3 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-sky-500/20 transition hover:brightness-110">
            <Mic className="h-4 w-4" />
            Voice triage
          </button>
        </div>
      </header>
      <div className="grid-bg min-h-[calc(100vh-65px)]">
        <div className="mx-auto max-w-7xl p-4 md:p-6">
          <div className="mb-5 flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-300">
              <Wifi className="h-3 w-3" />
              {mode}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-1 text-[10px] text-slate-400">
              <ShieldCheck className="h-3 w-3 text-sky-400" />
              Synthetic cohort · de-identified
            </span>
            <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-[10px] text-rose-300">
              {critical} critical signal{critical === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-5 lg:grid-cols-12">
            <section className="space-y-4 lg:col-span-7">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 shadow-xl shadow-slate-950/20">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => event.key === "Enter" && void runAudit()}
                      className="w-full rounded-xl border border-slate-700 bg-slate-950 px-9 py-2.5 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-sky-500"
                      placeholder="Search PubMed: SGLT2, biologics, GLP-1…"
                    />
                  </div>
                  <button onClick={() => void runAudit()} disabled={loading} className="flex min-w-[106px] items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-950 transition hover:bg-sky-200 disabled:opacity-60">
                    {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                    {loading ? "Searching" : "Run audit"}
                  </button>
                </div>
                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-[11px] text-slate-400 transition hover:border-sky-500 hover:text-sky-300">
                  <FileUp className="h-3.5 w-3.5" />
                  {ingesting ? "Grok 4.7 is reading the full paper…" : "Upload a full trial paper for Grok 4.7 analysis (PDF, DOCX, TXT)"}
                  <input type="file" accept=".pdf,.docx,.txt" className="hidden" disabled={ingesting} onChange={(event) => void ingestPaper(event.target.files?.[0])} />
                </label>
              </div>
              <Visualizer3D patients={patients} matches={matches} onSelectPatient={selectPatient} study={study} />
              <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                  <BookOpen className="h-3.5 w-3.5" />
                  {study.journal} · PMID {study.pmid} · {study.publication_date || "Recent"}
                </div>
                <h2 className="mt-2 text-sm font-medium leading-5 text-slate-100">{study.title}</h2>
                <p className="mt-2 text-xs leading-5 text-slate-400">{study.key_findings || study.abstract?.slice(0, 260)}</p>
              </article>
            </section>
            <section className="lg:col-span-5">
              <PatientCohortPanel matches={matches} onSelect={selectPatient} />
            </section>
          </div>
        </div>
      </div>
      {voiceOpen && <VoiceTriageModal patient={selected || matches[0]?.patient} study={study} apiUrl={apiUrl} onClose={() => setVoiceOpen(false)} />}
    </main>
  );
}
