"use client";

import { motion } from "framer-motion";
import type { Phase } from "../../lib/workspace-data";

type StepState = "pending" | "active" | "done" | "error";

type RunTrackerProps = {
  phase: Phase;
  literatureDone: boolean;
  contrastDone: boolean;
  finishedAt: string;
  reviewCount: number;
  total: number;
  sourceCount: number;
  attachedName: string | null;
  error: string;
  onAttach: () => void;
  onClearAttachment: () => void;
  onStart: () => void;
};

/** The strip above the graph: what a run does, where this one is, and what it found. */
export default function RunTracker({ phase, literatureDone, contrastDone, finishedAt, reviewCount, total, sourceCount, attachedName, error, onAttach, onClearAttachment, onStart }: RunTrackerProps) {
  const complete = phase === "ready" || phase === "empty";
  const running = phase === "running";
  const failed = phase === "failed";

  const literature: StepState = phase === "idle" ? "pending" : complete || literatureDone ? "done" : failed ? "error" : "active";
  const contrast: StepState = complete || contrastDone ? "done" : !literatureDone ? "pending" : failed ? "error" : "active";
  const report: StepState = complete ? "done" : running && contrastDone ? "active" : failed && contrastDone ? "error" : "pending";

  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const steps: { title: string; state: StepState; detail: string }[] = [
    {
      title: "Literature",
      state: literature,
      detail:
        literature === "pending" ? "Finds recent PubMed trials that match this panel" : literature === "active" ? "Searching PubMed…" : literature === "done" ? `${plural(sourceCount, "source")} retrieved${attachedName ? " + your file" : ""}` : "PubMed search failed",
    },
    {
      title: "Contrast",
      state: contrast,
      detail: contrast === "pending" ? "Checks every chart against that evidence" : contrast === "active" ? `Contrasting ${plural(total, "chart")}…` : contrast === "done" ? `${plural(total, "chart")} checked · ${reviewCount} flagged` : "Contrast stopped",
    },
    {
      title: "Report",
      state: report,
      detail: report === "pending" ? "Writes the report, one section per flagged patient" : report === "active" ? "Writing the report…" : report === "done" ? (phase === "empty" ? "Ready · nothing to flag" : `Ready${finishedAt ? ` · ${finishedAt}` : ""}`) : "Not written",
    },
  ];

  const headline = complete ? `Run complete${finishedAt ? ` · ${finishedAt}` : ""}` : running ? (literatureDone ? "Contrasting charts with the evidence" : "Searching the literature") : failed ? "Run failed" : "Ready to check the panel";
  const detail = complete ? (phase === "empty" ? "No patients flagged this run" : `${reviewCount} of ${total} patients to review`) : running ? "Usually under a minute" : failed ? error || "Stopped before the report was ready" : "Runs weekdays at 07:00, or start one now";
  const tone = failed ? "bg-blocked-fg" : complete ? "bg-cleared-fg" : running ? "bg-violet" : "bg-neutral-400";

  return (
    <section className="rounded-xl border border-line bg-surface px-4 pb-3 pt-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative grid h-7 w-7 shrink-0 place-items-center">
            {running && <motion.span className="absolute inset-0 rounded-full bg-violet" initial={{ opacity: 0.35, scale: 0.6 }} animate={{ opacity: 0, scale: 1.4 }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }} />}
            <span className={`h-2.5 w-2.5 rounded-full ${tone}`} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-[0.6px] text-muted">PANEL CHECK</p>
            <p className="truncate text-sm font-semibold leading-5 text-ink">
              {headline}
              <span className="ml-2 font-normal text-secondary">{detail}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {attachedName ? (
            <span className="flex h-9 items-center gap-2 rounded-lg border border-accent/40 bg-accent-surface pl-3 pr-1.5 text-xs font-medium text-accent">
              <span className="max-w-[200px] truncate">{attachedName}</span>
              <button type="button" onClick={onClearAttachment} aria-label="Remove attached source" className="grid h-6 w-6 place-items-center rounded-md text-base leading-none hover:bg-surface">
                ×
              </button>
            </span>
          ) : (
            <button type="button" onClick={onAttach} disabled={running} className="flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-canvas disabled:opacity-50">
              <span aria-hidden className="text-base leading-none">+</span>
              Attach a source
              <span className="text-[11px] font-normal text-muted">PDF · DOCX · TXT</span>
            </button>
          )}
          {(phase === "idle" || failed) && (
            <button type="button" onClick={onStart} className="h-9 rounded-lg bg-violet px-3.5 text-sm font-semibold text-white hover:bg-violet-press">
              {failed ? "Retry run" : "Start run"}
            </button>
          )}
        </div>
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-3">
        {steps.map((step, index) => (
          <li key={step.title} className="min-w-0">
            <div className="flex items-center gap-2">
              <StepBadge index={index + 1} state={step.state} />
              <span className={`text-xs font-semibold tracking-[0.06px] ${step.state === "pending" ? "text-secondary" : step.state === "error" ? "text-blocked-fg" : "text-ink"}`}>{step.title}</span>
            </div>
            <p className={`mt-1 truncate text-[11px] leading-4 tracking-[0.055px] ${step.state === "error" ? "text-blocked-fg" : step.state === "pending" ? "text-muted" : "text-secondary"}`} title={step.detail}>
              {step.detail}
            </p>
            <Track state={step.state} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function StepBadge({ index, state }: { index: number; state: StepState }) {
  const styles = {
    done: "border-cleared-border bg-cleared-bg text-cleared-fg",
    active: "border-violet bg-violet text-white",
    pending: "border-line-strong bg-surface text-muted",
    error: "border-blocked-border bg-blocked-bg text-blocked-fg",
  }[state];
  return <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold ${styles}`}>{state === "done" ? "✓" : state === "error" ? "×" : index}</span>;
}

function Track({ state }: { state: StepState }) {
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
      {state === "done" && <motion.div className="h-full rounded-full bg-cleared-fg" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 0.5, ease: "easeOut" }} />}
      {state === "error" && <div className="h-full w-full rounded-full bg-blocked-fg opacity-70" />}
      {state === "active" && <motion.div className="h-full w-2/5 rounded-full bg-violet" animate={{ x: ["-100%", "260%"] }} transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }} />}
    </div>
  );
}
