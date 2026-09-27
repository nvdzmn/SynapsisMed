"use client";

import { useEffect, useRef, useState } from "react";
import { CONDITIONS, DEFAULT_QUERY, blockedReasons, type Phase } from "../../lib/workspace-data";
import { approveDraft, cohortLabel, createDraft, fetchHealth, formatWhen, presentRun, readRun, startLiteratureRun, type PresentedRun, type RunView } from "../../lib/triallens";
import CohortField from "./CohortField";
import NoteDrawer from "./NoteDrawer";
import ReportPanel, { ConditionMenu } from "./ReportPanel";
import { useVoiceSession } from "./useVoiceSession";

type NotePoint = { text: string; checked: boolean };

function friendlyError(error: string): string {
  if (/temporarily unavailable|cannot connect to solr/i.test(error)) return "PubMed search is temporarily unavailable. Retry the run in a moment.";
  return error;
}

export default function Workspace() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cohortSize, setCohortSize] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [presented, setPresented] = useState<PresentedRun | null>(null);
  const [lastPresented, setLastPresented] = useState<PresentedRun | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<"patient" | "voice" | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [patientsOpen, setPatientsOpen] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [conditionIds, setConditionIds] = useState<string[]>(["hfpef", "ckd3"]);
  const [conditionQuery, setConditionQuery] = useState("");
  const [attachedName, setAttachedName] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [notePoints, setNotePoints] = useState<NotePoint[]>([]);
  const [draftText, setDraftText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [approvedFor, setApprovedFor] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentDetail, setSentDetail] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [noteError, setNoteError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const attachedFile = useRef<File | null>(null);
  const pollTimer = useRef<number | null>(null);
  const cohortRef = useRef<number | null>(null);
  const voice = useVoiceSession(runId);

  const patient = presented?.patients.find((item) => item.id === selectedId) ?? presented?.patients[0] ?? null;
  const reasons = patient ? blockedReasons(draftText, patient.name, names) : [];
  const approved = Boolean(patient) && approvedFor === `${patient?.id}:${draftText}` && reasons.length === 0 && !drafting;
  const graphReady = phase === "ready";

  useEffect(() => {
    void fetchHealth()
      .then((size) => {
        cohortRef.current = size;
        setCohortSize(size);
      })
      .catch(() => setCohortSize(null));
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (conditionOpen || patientsOpen) {
        setConditionOpen(false);
        setPatientsOpen(false);
        return;
      }
      if (searchOpen) setSearchOpen(false);
      else if (noteOpen) setNoteOpen(false);
      else if (focus === "voice") {
        voice.stop();
        setFocus(graphReady ? "patient" : null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conditionOpen, patientsOpen, searchOpen, noteOpen, focus, graphReady, voice]);

  const applyView = (view: RunView) => {
    setProgress(view.progress ?? []);
    setNames((view.overlay?.patients ?? []).map((item) => item.display_name));
    if (view.status === "failed") {
      setPhase("failed");
      setError(friendlyError(view.error || "The run stopped before a report was written"));
      setFocus(null);
      return;
    }
    if (view.status !== "complete") {
      setPhase("running");
      if (view.source_pack?.length) setPresented(presentRun(view, cohortRef.current ?? 0));
      return;
    }
    const next = presentRun(view, cohortRef.current ?? 0);
    setPresented(next);
    setLastPresented(next);
    setLastRunId(view.run_id);
    setRunId(view.run_id);
    setCompletedAt(view.completed_at ?? null);
    setError("");
    setPhase(next.patients.length ? "ready" : "empty");
    setSelectedId(next.patients[0]?.id ?? null);
    setFocus(next.patients.length ? "patient" : null);
  };

  const startRun = async () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    voice.stop();
    setSearchOpen(false);
    setConditionOpen(false);
    setPatientsOpen(false);
    setNoteOpen(false);
    setFocus(null);
    setPresented(null);
    setPhase("running");
    setError("");
    setProgress(["phenotype_complete"]);
    const focusLabels = CONDITIONS.filter((item) => conditionIds.includes(item.id)).map((item) => item.label);
    const asked = [query.trim(), focusLabels.length ? `Focus on ${focusLabels.join(", ")}.` : ""].filter(Boolean).join(" ");
    try {
      const started = await startLiteratureRun(asked, attachedFile.current);
      setRunId(started.run_id);
      const tick = async () => {
        const view = await readRun(started.run_id);
        applyView(view);
        if (view.status === "complete" || view.status === "failed") return;
        pollTimer.current = window.setTimeout(() => void tick(), 1200);
      };
      await tick();
    } catch (cause) {
      setPhase("failed");
      setError(cause instanceof Error && cause.message ? cause.message : "Could not reach the TrialLens API");
    }
  };

  const openVoice = () => {
    if ((phase !== "ready" && phase !== "empty") || !runId) return;
    setNoteOpen(false);
    setFocus("voice");
    void voice.connect(patient?.name || "the panel");
  };

  const openNote = async () => {
    if (!patient || !runId) return;
    const texts = patient.fields.filter(Boolean);
    const points = (texts.length ? texts : ["The findings in this run that apply to this chart"]).map((text) => ({ text, checked: true }));
    voice.stop();
    setFocus("patient");
    setNotePoints(points);
    setDraftText("");
    setDraftId(null);
    setApprovedFor(null);
    setSent(false);
    setSentDetail("");
    setNoteError("");
    setNoteOpen(true);
    setDrafting(true);
    try {
      const draft = await createDraft(runId, patient.id, points.map((point) => point.text));
      setDraftId(draft.draft_id);
      setDraftText(draft.edited_text || draft.model_draft?.body || "");
    } catch (cause) {
      setNoteError(cause instanceof Error && cause.message ? cause.message : "Could not draft the note");
    } finally {
      setDrafting(false);
    }
  };

  const sendNote = async () => {
    if (!draftId || !approved) return;
    setSending(true);
    setNoteError("");
    try {
      const result = await approveDraft(draftId, draftText);
      setSent(true);
      setSentDetail(result.delivery?.recipient ? `${result.delivery.recipient} · synthetic patient, no real delivery` : "Synthetic patient, no real delivery");
    } catch (cause) {
      setApprovedFor(null);
      setNoteError(cause instanceof Error && cause.message ? cause.message : "Send was refused");
    } finally {
      setSending(false);
    }
  };

  const literatureDone = progress.includes("literature_complete") || phase === "ready" || phase === "empty";
  const contrastDone = progress.includes("contrast_complete") || phase === "ready" || phase === "empty";
  const finishedAt = formatWhen(completedAt);
  const reviewCount = presented?.reviewCount ?? 0;
  const total = cohortSize ?? reviewCount;
  const reviewTitle = phase === "ready" || phase === "empty" ? `Run complete${finishedAt ? ` · ${finishedAt}` : ""}` : phase === "running" ? (literatureDone ? "Checking the panel" : "Searching the literature") : phase === "failed" ? "Run failed" : "No run yet";
  const reviewDetail = phase === "ready" || phase === "empty" ? `${reviewCount} of ${total} patients to review` : phase === "running" ? (literatureDone ? "Contrasting charts with the sources" : "PubMed retrieval is in progress") : phase === "failed" ? "Stopped before the report was ready" : "Next scheduled run · weekdays 07:00";

  return (
    <main className="flex h-screen min-w-[1280px] flex-col bg-canvas text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/brand-mark.svg" alt="" width={40} height={25} />
            <span className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px]">SynapseMed</span>
          </div>
          <span className="rounded-xl border border-line bg-caution-bg px-2.5 py-1 text-xs font-medium tracking-[0.06px] text-caution-fg">{cohortLabel(cohortSize)}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="whitespace-nowrap text-right">
            <p className="text-sm font-semibold leading-5">Next scheduled run · Mon 07:00</p>
            <p className="text-[11px] tracking-[0.055px] text-secondary">Weekdays at 07:00 · scheduled runs never send mail</p>
          </div>
          <button type="button" onClick={openVoice} className="flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-semibold">
            <span className={`h-2 w-2 rounded-full ${focus === "voice" ? "bg-violet" : "bg-ink"}`} />
            {focus === "voice" && patient ? `Voice live · ${patient.name}` : "Voice · discuss report"}
          </button>
          <span className="grid h-7 min-w-8 place-items-center rounded-2xl bg-cleared-bg px-2 text-xs font-medium tracking-[0.06px] text-cleared-fg">DO</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3.5 py-4 pl-6 pr-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-4 py-3">
            <button type="button" onClick={() => fileRef.current?.click()} className="text-left">
              <span className="block text-sm font-semibold text-accent">{attachedName || "+ Attach a source"}</span>
              <span className="block text-[11px] tracking-[0.055px] text-muted">Optional · one PDF, DOCX, or TXT</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                attachedFile.current = file ?? null;
                setAttachedName(file?.name ?? null);
              }}
            />
            <div className="flex items-center gap-1.5">
              <Step label="Literature" state={phase === "idle" ? "pending" : literatureDone ? "done" : phase === "failed" ? "error" : "active"} />
              <Connector />
              <Step label="Contrast" state={phase === "idle" || (phase === "running" && !literatureDone) ? "pending" : contrastDone ? "done" : phase === "failed" ? "error" : "active"} />
              <Connector />
              <Step label="Report" state={phase === "ready" || phase === "empty" ? "done" : "pending"} />
            </div>
            <div className="shrink-0 whitespace-nowrap text-right">
              <p className="text-sm font-semibold leading-5">{reviewTitle}</p>
              <p className="text-[11px] tracking-[0.055px] text-secondary">{reviewDetail}</p>
            </div>
          </div>
          <CohortField
            phase={phase}
            patients={presented?.patients ?? []}
            quiet={presented?.quiet ?? []}
            sources={presented?.sources ?? []}
            edges={presented?.edges ?? []}
            selectedId={graphReady ? selectedId : null}
            showCard={graphReady && focus === "patient" && Boolean(patient)}
            showVoice={focus === "voice"}
            muted={voice.muted}
            voiceYou={voice.you}
            voiceReply={voice.listening ? voice.reply : voice.reply}
            voiceError={voice.error}
            onSelect={(id) => {
              setSelectedId(id);
              setFocus("patient");
            }}
            onTalk={openVoice}
            onDraft={() => void openNote()}
            onEndVoice={() => {
              voice.stop();
              setFocus(graphReady ? "patient" : null);
            }}
            onToggleMute={voice.toggleMuted}
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-secondary">Evidence match</span>
            <LegendPill level="CRITICAL" />
            <LegendPill level="HIGH" />
            <LegendPill level="MODERATE" />
            <span className="text-[11px] tracking-[0.055px] text-muted">No edge: not matched this run · Not an acuity score</span>
          </div>
        </section>
        <aside className="relative flex w-[480px] shrink-0 flex-col border-l border-line bg-surface">
          {noteOpen && patient ? (
            <NoteDrawer
              patientName={patient.name}
              draft={draftText}
              points={notePoints}
              approved={approved}
              sent={sent}
              sentDetail={sentDetail}
              drafting={drafting}
              sending={sending}
              reasons={reasons}
              error={noteError}
              onDraft={(value) => {
                setDraftText(value);
                setSent(false);
                setApprovedFor(null);
              }}
              onTogglePoint={(index) => setNotePoints((current) => current.map((point, pointIndex) => (pointIndex === index ? { ...point, checked: !point.checked } : point)))}
              onToggleApproved={() => {
                if (reasons.length > 0 || !patient) return;
                setApprovedFor((current) => (current === `${patient.id}:${draftText}` ? null : `${patient.id}:${draftText}`));
              }}
              onSend={() => void sendNote()}
              onClose={() => setNoteOpen(false)}
            />
          ) : (
            <ReportPanel
              phase={phase}
              query={query}
              searchOpen={searchOpen}
              conditionOpen={conditionOpen}
              patientsOpen={patientsOpen}
              conditionIds={conditionIds}
              conditionQuery={conditionQuery}
              selectedId={graphReady ? selectedId : null}
              cohortSize={cohortSize}
              report={presented?.report ?? null}
              patients={presented?.patients ?? []}
              sources={presented?.sources ?? []}
              error={error}
              reviewCount={reviewCount}
              onQuery={setQuery}
              onOpenSearch={() => {
                setSearchOpen(true);
                setNoteOpen(false);
              }}
              onCloseSearch={() => {
                setSearchOpen(false);
                setConditionOpen(false);
                setPatientsOpen(false);
              }}
              onToggleConditions={() => {
                setConditionOpen((current) => !current);
                setPatientsOpen(false);
              }}
              onTogglePatients={() => {
                setPatientsOpen((current) => !current);
                setConditionOpen(false);
              }}
              onConditionQuery={setConditionQuery}
              onToggleCondition={(id) => setConditionIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))}
              onClearConditions={() => setConditionIds([])}
              onStart={() => void startRun()}
              onSelectPatient={(id) => {
                setSelectedId(id);
                setFocus("patient");
              }}
              onRetry={() => void startRun()}
              onOpenLast={() => {
                if (!lastPresented || !lastRunId) return;
                setPresented(lastPresented);
                setRunId(lastRunId);
                setPhase(lastPresented.patients.length ? "ready" : "empty");
                setSelectedId(lastPresented.patients[0]?.id ?? null);
                setFocus(lastPresented.patients.length ? "patient" : null);
                setError("");
              }}
            />
          )}
          {conditionOpen && !noteOpen && (
            <ConditionMenu ids={conditionIds} query={conditionQuery} onQuery={setConditionQuery} onToggle={(id) => setConditionIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))} onClear={() => setConditionIds([])} />
          )}
        </aside>
      </div>
    </main>
  );
}

function Connector() {
  return <span className="h-[1.5px] w-4 bg-line-strong" />;
}

function Step({ label, state }: { label: string; state: "done" | "active" | "pending" | "error" }) {
  const styles = {
    done: "border-cleared-border bg-cleared-bg text-cleared-fg",
    active: "border-violet bg-cleared-bg text-cleared-fg",
    pending: "border-line-strong bg-surface text-muted",
    error: "border-blocked-border bg-blocked-bg text-blocked-fg",
  }[state];
  const mark = state === "done" ? "✓" : state === "error" ? "×" : state === "active" ? "●" : "○";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-xs font-medium tracking-[0.06px] ${styles}`}>
      <span>{mark}</span>
      {label}
    </span>
  );
}

function LegendPill({ level }: { level: "CRITICAL" | "HIGH" | "MODERATE" }) {
  const styles = {
    CRITICAL: "border-blocked-border bg-blocked-bg text-blocked-fg",
    HIGH: "border-caution-border bg-caution-bg text-caution-fg",
    MODERATE: "border-accent bg-accent-surface text-accent",
  }[level];
  return <span className={`rounded border px-2 py-0.5 text-xs font-medium tracking-[0.06px] ${styles}`}>{level}</span>;
}
