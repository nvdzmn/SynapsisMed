"use client";

import { useEffect, useRef, useState } from "react";
import { CONDITIONS, DEFAULT_QUERY, blockedReasons, type PanelPatient, type Phase } from "../../lib/workspace-data";
import { addNote, approveDraft, cohortLabel, countNotes, createDraft, fetchHealth, formatWhen, listRuns, presentRun, readLatestRun, readRun, startLiteratureRun, type PresentedRun, type ReportHistoryItem, type RunView } from "../../lib/triallens";
import CohortField from "./CohortField";
import MessageDrawer from "./MessageDrawer";
import NotesDrawer from "./NotesDrawer";
import ReportPanel, { ConditionMenu } from "./ReportPanel";
import RunTracker from "./RunTracker";
import ScheduleControl, { scheduleInSentence, useSchedule } from "./ScheduleControl";
import { useVoiceSession, type VoiceToolResult } from "./useVoiceSession";

type MessagePoint = { text: string; checked: boolean };

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
  const [voiceSubject, setVoiceSubject] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<"message" | "notes" | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [patientsOpen, setPatientsOpen] = useState(false);
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [conditionIds, setConditionIds] = useState<string[]>(["hfpef", "ckd3"]);
  const [conditionQuery, setConditionQuery] = useState("");
  const [attachedName, setAttachedName] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [messagePoints, setMessagePoints] = useState<MessagePoint[]>([]);
  const [draftText, setDraftText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [approvedFor, setApprovedFor] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentDetail, setSentDetail] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [browsing, setBrowsing] = useState(true);
  const [history, setHistory] = useState<ReportHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [notesVersion, setNotesVersion] = useState(0);
  const [schedule, setSchedule] = useSchedule();
  const fileRef = useRef<HTMLInputElement>(null);
  const attachedFile = useRef<File | null>(null);
  const pollTimer = useRef<number | null>(null);
  const cohortRef = useRef<number | null>(null);
  const patient = presented?.patients.find((item) => item.id === selectedId) ?? presented?.patients[0] ?? null;
  const reasons = patient ? blockedReasons(draftText, patient.name, names) : [];
  const approved = Boolean(patient) && approvedFor === `${patient?.id}:${draftText}` && reasons.length === 0 && !drafting;
  const graphReady = phase === "ready";

  /** Matches what the physician said to a flagged patient in the open report: a full name or a first name. */
  const findPatient = (spoken: unknown): PanelPatient | null => {
    const wanted = String(spoken ?? "").trim().toLowerCase();
    if (!wanted) return null;
    const flagged = presented?.patients ?? [];
    return flagged.find((item) => item.name.toLowerCase() === wanted) ?? flagged.find((item) => item.name.toLowerCase().split(" ")[0] === wanted.split(" ")[0]) ?? null;
  };

  /** What the voice agent is allowed to do. It prepares work on screen; approving and sending stay with the physician. */
  const runVoiceTool = async (name: string, args: Record<string, unknown>): Promise<VoiceToolResult> => {
    const target = findPatient(args.patient_name);
    if (!target) return { ok: false, detail: `No flagged patient by that name in this report. Flagged: ${(presented?.patients ?? []).map((item) => item.name).join(", ") || "none"}.` };
    if (name === "draft_message") {
      const instruction = typeof args.instruction === "string" ? args.instruction : "";
      // Left out, the choice is kept as it is on screen; said either way, it sets the ticks.
      const findings = typeof args.include_findings === "boolean" ? args.include_findings : null;
      if (findings === false && !instruction.trim()) return { ok: false, detail: "A message without findings needs to be told what to say." };
      const redraft = drawer === "message" && patient?.id === target.id && draftText.trim() && !sent;
      if (redraft) {
        // The voice model tends to say "include findings" on every redraft, so a personal message only gets them back when the physician asks.
        const wantsFindings = findings === true && /finding|result|medical|report|evidence|research/i.test(instruction);
        const change = findings === false ? false : wantsFindings ? true : null;
        const ticked = change === null ? messagePoints : messagePoints.map((point) => ({ ...point, checked: change }));
        if (change !== null) setMessagePoints(ticked);
        const points = ticked.filter((point) => point.checked).map((point) => point.text);
        if (!points.length && !instruction.trim()) return { ok: false, detail: "No findings are ticked and nothing was said about what to write." };
        const done = await writeDraft(target, points, { instruction, previousText: draftText });
        return done ? { ok: true, detail: `The message for ${target.name} was rewritten and is on screen. It has not been sent; the physician approves and sends it on screen.` } : { ok: false, detail: "The writer could not rewrite the message. The earlier text is unchanged." };
      }
      const done = await openMessage(target, instruction, true, findings !== false);
      return done ? { ok: true, detail: `A draft message for ${target.name} is on screen for review. It has not been sent; the physician approves and sends it on screen.` } : { ok: false, detail: "The writer could not draft the message." };
    }
    if (name === "save_note") {
      const text = typeof args.text === "string" ? args.text.trim() : "";
      if (!text) return { ok: false, detail: "There was nothing to save." };
      await addNote(target.id, text, runId, "voice");
      setSelectedId(target.id);
      setDrawer("notes");
      setNotesVersion((current) => current + 1);
      void loadNoteCounts();
      return { ok: true, detail: `Saved a private note for ${target.name}. It is on screen and only the physician sees it.` };
    }
    return { ok: false, detail: "That action is not available by voice." };
  };
  const voice = useVoiceSession(runId, runVoiceTool);

  const loadHistory = async () => {
    try {
      setHistory(await listRuns());
      setHistoryError("");
    } catch (cause) {
      setHistoryError(cause instanceof Error && cause.message ? cause.message : "Could not load past reports");
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadNoteCounts = async () => {
    try {
      setNoteCounts(await countNotes());
    } catch {
      /* The count is a convenience; the notes drawer reports its own errors. */
    }
  };

  useEffect(() => {
    void loadNoteCounts();
    void fetchHealth()
      .then((size) => {
        cohortRef.current = size;
        setCohortSize(size);
      })
      .catch(() => setCohortSize(null));
    void loadHistory();
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
      else if (drawer) setDrawer(null);
      else if (focus === "voice") {
        voice.stop();
        setFocus(graphReady ? "patient" : null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conditionOpen, patientsOpen, searchOpen, drawer, focus, graphReady, voice]);

  const applyView = (view: RunView, focusPatient = true) => {
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
    setFocus(focusPatient && next.patients.length ? "patient" : null);
  };

  const showHistory = () => {
    if (phase === "running") return;
    voice.stop();
    setDrawer(null);
    setSearchOpen(false);
    setConditionOpen(false);
    setPatientsOpen(false);
    setFocus(null);
    setPresented(null);
    setSelectedId(null);
    setRunId(null);
    setProgress([]);
    setCompletedAt(null);
    setError("");
    setPhase("idle");
    setBrowsing(true);
    void loadHistory();
  };

  const openReport = async (id: string) => {
    setOpeningId(id);
    setSearchOpen(false);
    setConditionOpen(false);
    setPatientsOpen(false);
    setDrawer(null);
    try {
      const view = await readRun(id);
      applyView(view, false);
      setBrowsing(false);
    } catch (cause) {
      setHistoryError(cause instanceof Error && cause.message ? cause.message : "Could not open that report");
    } finally {
      setOpeningId(null);
    }
  };

  const startRun = async (sample = false) => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
    voice.stop();
    setSearchOpen(false);
    setConditionOpen(false);
    setPatientsOpen(false);
    setDrawer(null);
    setFocus(null);
    setPresented(null);
    setBrowsing(false);
    setPhase("running");
    setError("");
    setProgress(["phenotype_complete"]);
    const focusLabels = CONDITIONS.filter((item) => conditionIds.includes(item.id)).map((item) => item.label);
    const asked = [query.trim(), focusLabels.length ? `Focus on ${focusLabels.join(", ")}.` : ""].filter(Boolean).join(" ");
    try {
      const started = await startLiteratureRun(asked, sample ? null : attachedFile.current, sample);
      setRunId(started.run_id);
      const tick = async () => {
        const view = await readRun(started.run_id);
        applyView(view);
        if (view.status === "complete" || view.status === "failed") {
          void loadHistory();
          return;
        }
        pollTimer.current = window.setTimeout(() => void tick(), 1200);
      };
      await tick();
    } catch (cause) {
      setPhase("failed");
      setError(cause instanceof Error && cause.message ? cause.message : "Could not reach the TrialLens API");
    }
  };

  const startVoice = (subject: string | null) => {
    if ((phase !== "ready" && phase !== "empty") || !runId) return;
    setDrawer(null);
    setVoiceSubject(subject);
    setFocus("voice");
    void voice.connect(subject);
  };

  /** From a patient card: focus the conversation on that patient. */
  const openVoice = () => startVoice(patient?.name ?? null);
  /** From the graph's corner button: cover the whole report. */
  const openReportVoice = () => startVoice(null);

  /** Opens the message drawer with a first draft. Voice passes its own target and keeps the conversation running. */
  const openMessage = async (target: PanelPatient | null = patient, instruction = "", fromVoice = false, findings = true): Promise<boolean> => {
    if (!target || !runId) return false;
    const texts = target.fields.filter(Boolean);
    const points = (texts.length ? texts : ["The findings in this run that apply to this chart"]).map((text) => ({ text, checked: findings }));
    if (fromVoice) setSelectedId(target.id);
    else {
      voice.stop();
      setFocus("patient");
    }
    setMessagePoints(points);
    setDraftText("");
    setDraftId(null);
    setApprovedFor(null);
    setSent(false);
    setSentDetail("");
    setMessageError("");
    setDrawer("message");
    return writeDraft(target, points.filter((point) => point.checked).map((point) => point.text), instruction.trim() ? { instruction, previousText: "" } : undefined);
  };

  /** The physician's own notes on this patient. Nothing here is drafted by a model or sent anywhere. */
  const openNotes = () => {
    if (!patient) return;
    voice.stop();
    setFocus("patient");
    setDrawer("notes");
  };

  /** Asks the writer for a patient message. With `rewrite`, the current text stays on screen until the new one arrives. */
  const writeDraft = async (target: PanelPatient, points: string[], rewrite?: { instruction: string; previousText: string }): Promise<boolean> => {
    if (!runId) return false;
    setDrafting(true);
    setMessageError("");
    try {
      const draft = await createDraft(runId, target.id, points, rewrite);
      setDraftId(draft.draft_id);
      setDraftText(draft.edited_text || draft.model_draft?.body || "");
      setApprovedFor(null);
      return true;
    } catch (cause) {
      setMessageError(cause instanceof Error && cause.message ? cause.message : rewrite?.previousText ? "Could not rewrite the message" : "Could not draft the message");
      return false;
    } finally {
      setDrafting(false);
    }
  };

  const rewriteMessage = (instruction: string) => {
    const points = messagePoints.filter((point) => point.checked).map((point) => point.text);
    if ((!points.length && !instruction.trim()) || sent || !patient) return;
    void writeDraft(patient, points, { instruction, previousText: draftText });
  };

  const sendMessage = async () => {
    if (!draftId || !approved) return;
    setSending(true);
    setMessageError("");
    try {
      const result = await approveDraft(draftId, draftText);
      setSent(true);
      setSentDetail(result.delivery?.recipient ? `Emailed to ${result.delivery.recipient} · synthetic patient` : "Emailed to the test inbox · synthetic patient");
    } catch (cause) {
      setApprovedFor(null);
      setMessageError(cause instanceof Error && cause.message ? cause.message : "Send was refused");
    } finally {
      setSending(false);
    }
  };

  const literatureDone = progress.includes("literature_complete") || phase === "ready" || phase === "empty";
  const contrastDone = progress.includes("contrast_complete") || phase === "ready" || phase === "empty";
  const finishedAt = formatWhen(completedAt);
  const reviewCount = presented?.reviewCount ?? 0;
  const total = cohortSize ?? reviewCount;

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
          <ScheduleControl schedule={schedule} onSave={setSchedule} />
          <span className="grid h-7 min-w-8 place-items-center rounded-2xl bg-cleared-bg px-2 text-xs font-medium tracking-[0.06px] text-cleared-fg">DO</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3.5 py-4 pl-6 pr-4">
          <RunTracker
            scheduleLabel={scheduleInSentence(schedule)}
            phase={phase}
            literatureDone={literatureDone}
            contrastDone={contrastDone}
            finishedAt={finishedAt}
            reviewCount={reviewCount}
            total={total}
            sourceCount={presented?.sources.length ?? 0}
            attachedName={attachedName}
            error={error}
            onStart={() => void startRun()}
          />
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
          <CohortField
            phase={phase}
            stage={literatureDone ? "contrast" : "literature"}
            patients={presented?.patients ?? []}
            quiet={presented?.quiet ?? []}
            sources={presented?.sources ?? []}
            edges={presented?.edges ?? []}
            report={presented?.report ?? null}
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
            onTalkReport={openReportVoice}
            voiceSubject={voiceSubject}
            onDraft={() => void openMessage()}
            onNotes={openNotes}
            noteCounts={noteCounts}
            onEndVoice={() => {
              voice.stop();
              setFocus(graphReady ? "patient" : null);
            }}
            onToggleMute={voice.toggleMuted}
            onDismissCard={() => setFocus(null)}
            onTalkGroup={(names) => startVoice(names.join(" and "))}
          />
        </section>
        <aside className="relative flex w-[480px] shrink-0 flex-col border-l border-line bg-surface">
          {drawer === "notes" && patient ? (
            <NotesDrawer key={patient.id} patientId={patient.id} patientName={patient.name} runId={runId} version={notesVersion} onChanged={() => void loadNoteCounts()} onClose={() => setDrawer(null)} />
          ) : drawer === "message" && patient ? (
            <MessageDrawer
              key={patient.id}
              patientName={patient.name}
              draft={draftText}
              points={messagePoints}
              approved={approved}
              sent={sent}
              sentDetail={sentDetail}
              drafting={drafting}
              sending={sending}
              reasons={reasons}
              error={messageError}
              onDraft={(value) => {
                setDraftText(value);
                setSent(false);
                setApprovedFor(null);
              }}
              onTogglePoint={(index) => setMessagePoints((current) => current.map((point, pointIndex) => (pointIndex === index ? { ...point, checked: !point.checked } : point)))}
              onToggleApproved={() => {
                if (reasons.length > 0 || !patient) return;
                setApprovedFor((current) => (current === `${patient.id}:${draftText}` ? null : `${patient.id}:${draftText}`));
              }}
              onRewrite={rewriteMessage}
              onSend={() => void sendMessage()}
              onClose={() => setDrawer(null)}
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
              scheduleLabel={scheduleInSentence(schedule)}
              report={presented?.report ?? null}
              patients={presented?.patients ?? []}
              sources={presented?.sources ?? []}
              error={error}
              reviewCount={reviewCount}
              browsing={browsing}
              history={history}
              historyLoading={historyLoading}
              historyError={historyError}
              openingId={openingId}
              onQuery={setQuery}
              onOpenSearch={() => {
                setSearchOpen(true);
                setDrawer(null);
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
              onSample={() => void startRun(true)}
              attachedName={attachedName}
              onAttach={() => fileRef.current?.click()}
              onClearAttachment={() => {
                attachedFile.current = null;
                setAttachedName(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              onSelectPatient={(id) => {
                setSelectedId(id);
                setFocus("patient");
              }}
              onRetry={() => void startRun()}
              onShowHistory={showHistory}
              onOpenReport={(id) => void openReport(id)}
              onOpenLast={() => {
                void (async () => {
                  const cached = lastPresented && lastRunId ? { presented: lastPresented, runId: lastRunId } : null;
                  if (cached) {
                    setPresented(cached.presented);
                    setRunId(cached.runId);
                    setPhase(cached.presented.patients.length ? "ready" : "empty");
                    setSelectedId(cached.presented.patients[0]?.id ?? null);
                    setFocus(cached.presented.patients.length ? "patient" : null);
                    setError("");
                    return;
                  }
                  try {
                    const view = await readLatestRun();
                    applyView(view);
                  } catch (cause) {
                    setError(cause instanceof Error && cause.message ? cause.message : "No completed report is saved yet");
                  }
                })();
              }}
            />
          )}
          {conditionOpen && !drawer && (
            <ConditionMenu ids={conditionIds} query={conditionQuery} onQuery={setConditionQuery} onToggle={(id) => setConditionIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))} onClear={() => setConditionIds([])} />
          )}
        </aside>
      </div>
    </main>
  );
}

