import { levelColors, type MatchLevel, type PanelPatient, type QuietDot, type SourceNode } from "./workspace-data";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type OverlayPatient = {
  patient_id: string;
  display_name: string;
  risk_level: MatchLevel | null;
  reasons?: { text?: string; chart_fields?: string[] }[];
  mismatches?: string[];
  clinician_note?: string | null;
  clinician_checks?: string[];
  assessed_by?: "agent" | "rules_floor" | "rules_fallback" | "rules_only";
};

function recordMeta(assessedBy: OverlayPatient["assessed_by"]): string {
  if (assessedBy === "rules_floor") return "Synthetic record · kept by rules, Mishti disagreed";
  if (assessedBy === "rules_fallback" || assessedBy === "rules_only") return "Synthetic record · matched by rules, not reviewed by Mishti";
  return "Synthetic record";
}

export type SourceRecord = {
  source_id?: string;
  pmid?: string | null;
  title?: string;
  journal?: string;
  publication_date?: string | null;
  pubmed_url?: string | null;
};

export type RunView = {
  run_id: string;
  status: string;
  progress?: string[];
  error?: string | null;
  created_at?: string;
  completed_at?: string | null;
  overlay?: { patients?: OverlayPatient[] };
  report?: {
    report_id?: string;
    generated_at?: string;
    sections?: {
      question?: string;
      literature?: string;
      limitations?: string;
      sources?: SourceRecord[];
    };
    footer?: string;
    placeholder?: boolean;
    model_summary?: Record<string, unknown>;
  };
  source_pack?: SourceRecord[];
  placeholder?: boolean;
  placeholder_reason?: string | null;
};

export type ReportView = {
  kicker: string;
  title: string;
  question: string;
  supports: string[];
  limits: string[];
  footer: string;
  placeholder?: boolean;
};

export type GraphEdge = { from: string; to: string; color: string };

export type PresentedRun = {
  patients: PanelPatient[];
  quiet: QuietDot[];
  sources: SourceNode[];
  edges: GraphEdge[];
  report: ReportView;
  reviewCount: number;
};

type DraftResponse = {
  draft_id: string;
  edited_text?: string;
  model_draft?: { body?: string; subject?: string };
  blocked_terms?: string[];
  approved?: boolean;
  delivery?: { recipient?: string; status?: string };
  detail?: string;
};

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail) return body.detail;
  } catch {
    /* The server sometimes returns an empty body. */
  }
  return fallback;
}

export async function fetchHealth(): Promise<number | null> {
  const response = await fetch(`${API_URL}/health`);
  if (!response.ok) return null;
  const body = (await response.json()) as { cohort_size?: number };
  return typeof body.cohort_size === "number" ? body.cohort_size : null;
}

export async function startLiteratureRun(question: string, file?: File | null, sample = false): Promise<RunView> {
  const form = new FormData();
  if (question.trim()) form.append("question", question.trim());
  if (file) form.append("file", file);
  if (sample) form.append("sample", "true");
  const response = await fetch(`${API_URL}/api/runs`, { method: "POST", body: form });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not start a literature run"));
  return (await response.json()) as RunView;
}

export type ReportHistoryItem = {
  run_id: string;
  created_at?: string;
  completed_at?: string | null;
  title: string;
  question: string;
  review_count: number;
  source_count: number;
  placeholder?: boolean;
};

export async function listRuns(): Promise<ReportHistoryItem[]> {
  const response = await fetch(`${API_URL}/api/runs`);
  if (!response.ok) throw new Error(await errorMessage(response, "Could not load past reports"));
  const body = (await response.json()) as ReportHistoryItem[];
  return Array.isArray(body) ? body : [];
}

export async function readLatestRun(): Promise<RunView> {
  const response = await fetch(`${API_URL}/api/runs/latest`);
  if (!response.ok) throw new Error(await errorMessage(response, "No completed report is saved yet"));
  return (await response.json()) as RunView;
}

export async function readRun(runId: string): Promise<RunView> {
  const response = await fetch(`${API_URL}/api/runs/${runId}`);
  if (!response.ok) throw new Error(await errorMessage(response, "Could not read the run"));
  return (await response.json()) as RunView;
}

/** Drafts a patient message. Passing `rewrite` asks the writer to rework the text the physician is looking at. */
export async function createDraft(runId: string, patientId: string, points: string[], rewrite?: { instruction: string; previousText: string }): Promise<DraftResponse> {
  const response = await fetch(`${API_URL}/api/runs/${runId}/patients/${patientId}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, instruction: rewrite?.instruction.trim() || undefined, previous_text: rewrite?.previousText.trim() || undefined }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not draft the message"));
  return (await response.json()) as DraftResponse;
}

export async function approveDraft(draftId: string, finalText: string): Promise<DraftResponse> {
  const response = await fetch(`${API_URL}/api/drafts/${draftId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ final_text: finalText }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Send was refused"));
  return (await response.json()) as DraftResponse;
}

export async function openVoiceSession(runId: string): Promise<{ secret: string; brief: string }> {
  const response = await fetch(`${API_URL}/api/runs/${runId}/voice/session`, { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    voice_secret?: { value?: string; client_secret?: string | { value?: string } } | string;
    context?: { brief?: string | null; report?: { sections?: { question?: string; literature?: string; limitations?: string }; footer?: string; report_id?: string } };
  };
  if (!response.ok) throw new Error(body.detail || "Could not open a voice session");
  const secret = clientSecret(body.voice_secret);
  if (!secret) throw new Error("The voice service did not return a session secret");
  const report = body.context?.report;
  // Runs saved before the cohort agent wrote briefs fall back to the report sections.
  const brief =
    body.context?.brief ||
    [report?.report_id ? `Report ${report.report_id}.` : "", report?.sections?.question, report?.sections?.literature, report?.sections?.limitations, report?.footer]
      .filter(Boolean)
      .join(" ");
  return { secret, brief };
}

function clientSecret(secret: { value?: string; client_secret?: string | { value?: string } } | string | undefined): string | undefined {
  if (!secret) return undefined;
  if (typeof secret === "string") return secret;
  if (secret.value) return secret.value;
  if (typeof secret.client_secret === "string") return secret.client_secret;
  return secret.client_secret?.value;
}

function asLines(value: unknown, fallback: string): string[] {
  if (Array.isArray(value)) {
    const lines = value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
    if (lines.length) return lines;
  }
  if (typeof value === "string" && value.trim()) {
    const lines = value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length ? lines : [value.trim()];
  }
  return [fallback];
}

function place(index: number, count: number, radiusX: number, radiusY: number, turn = 0): { x: number; y: number } {
  const angle = count <= 1 ? -0.6 : (index / count) * Math.PI * 2 - Math.PI / 2 + turn;
  return { x: 430 + Math.cos(angle) * radiusX, y: 300 + Math.sin(angle) * radiusY };
}

export function presentRun(view: RunView, cohortSize: number): PresentedRun {
  const overlay = view.overlay?.patients ?? [];
  const matched = overlay.filter((patient) => patient.risk_level);
  const quietPeople = overlay.filter((patient) => !patient.risk_level);
  const pack = view.source_pack?.length ? view.source_pack : view.report?.sections?.sources ?? [];
  const summary = view.report?.model_summary ?? {};
  const sections = view.report?.sections ?? {};
  const patients: PanelPatient[] = matched.map((patient, index) => {
    const spot = place(index, matched.length, 190, 110);
    const level = patient.risk_level as MatchLevel;
    const fields = (patient.reasons ?? []).map((reason) => reason.text).filter((text): text is string => Boolean(text));
    return {
      id: patient.patient_id,
      name: patient.display_name,
      summary: fields[0] || "Matched this run",
      level,
      x: spot.x,
      y: spot.y,
      r: level === "CRITICAL" ? 11 : level === "HIGH" ? 9 : 8,
      meta: recordMeta(patient.assessed_by),
      fields: fields.length ? fields : ["Chart fields used in this contrast"],
      mismatches: patient.mismatches ?? [],
      review: patient.clinician_note || "Review whether this evidence is close enough to matter at the next visit.",
      checks: patient.clinician_checks?.filter(Boolean),
    };
  });
  const sources: SourceNode[] = pack.slice(0, 8).map((source, index) => {
    const spot = place(index, Math.max(pack.length, 1), 70, 46, 0.5);
    const pmid = source.pmid || "";
    const citation = [source.title, source.journal, source.publication_date].filter(Boolean).join(" · ");
    const url = source.pubmed_url || (pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "");
    return { id: source.source_id || `s${index + 1}`, label: `S${index + 1}`, x: spot.x, y: spot.y, citation: citation || "Source", pmid, url };
  });
  const edges: GraphEdge[] = patients.flatMap((patient, index) => {
    const source = sources[index % Math.max(sources.length, 1)];
    if (!source) return [];
    return [{ from: patient.id, to: source.id, color: levelColors(patient.level).node }];
  });
  const quiet: QuietDot[] = (quietPeople.length ? quietPeople : overlay).map((patient, index) => {
    const spot = place(index, Math.max(quietPeople.length || overlay.length, 1), 250 + (index % 3) * 28, 120 + (index % 2) * 24, 0.2);
    return { x: spot.x, y: spot.y, r: 4 + (index % 3) };
  });
  const question = asLines(summary.question ?? sections.question, "The run assessed the synthetic panel against recent literature.")[0] ?? "";
  const title = typeof summary.title === "string" && summary.title.trim() ? summary.title : question.slice(0, 72);
  const stamp = view.report?.generated_at ? view.report.generated_at.slice(0, 10) : view.completed_at?.slice(0, 10) || "latest";
  return {
    patients,
    quiet: quietPeople.length ? quiet : [],
    sources,
    edges,
    reviewCount: matched.length,
    report: {
      kicker: `PANEL REPORT · ${stamp}`,
      title: title || "Panel report",
      question,
      supports: asLines(summary.supports ?? summary.literature ?? sections.literature, "Findings are limited to the sources attached to this run."),
      limits: asLines(summary.does_not_support ?? summary.limitations ?? sections.limitations, "Evidence matching is a review prompt, not a treatment recommendation."),
      footer: view.report?.footer || "Synthetic records. Decision support, not a treatment recommendation.",
      placeholder: Boolean(view.placeholder || view.report?.placeholder),
    },
  };
}

export function formatWhen(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function cohortLabel(size: number | null): string {
  return size ? `Synthetic panel · ${size} patients` : "Synthetic panel";
}

/** A note the physician keeps for themselves. It is never sent to the patient or read by Mishti. */
export type PatientNote = { note_id: string; patient_id: string; run_id?: string | null; created_at: string; text: string; source?: "typed" | "voice" };

export async function listNotes(patientId: string): Promise<PatientNote[]> {
  const response = await fetch(`${API_URL}/api/patients/${patientId}/notes`);
  if (!response.ok) throw new Error(await errorMessage(response, "Could not load the notes"));
  const body = (await response.json()) as PatientNote[];
  return Array.isArray(body) ? body : [];
}

export async function addNote(patientId: string, text: string, runId: string | null, source: "typed" | "voice" = "typed"): Promise<PatientNote> {
  const response = await fetch(`${API_URL}/api/patients/${patientId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, run_id: runId ?? undefined, source }),
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not save the note"));
  return (await response.json()) as PatientNote;
}

export async function deleteNote(noteId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/notes/${noteId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not delete the note"));
}

export async function countNotes(): Promise<Record<string, number>> {
  const response = await fetch(`${API_URL}/api/notes/counts`);
  if (!response.ok) return {};
  return (await response.json()) as Record<string, number>;
}

/** Starting bullets for a private note, condensed from this report's review of the patient. */
export async function suggestNote(runId: string, patientId: string): Promise<{ bullets: string[]; source: "model" | "review" }> {
  const response = await fetch(`${API_URL}/api/runs/${runId}/patients/${patientId}/note-draft`, { method: "POST" });
  if (!response.ok) throw new Error(await errorMessage(response, "Could not suggest a note"));
  const body = (await response.json()) as { bullets?: string[]; source?: "model" | "review" };
  return { bullets: Array.isArray(body.bullets) ? body.bullets : [], source: body.source === "review" ? "review" : "model" };
}
