"use client";

import { useState, type ReactNode } from "react";
import type { ReportHistoryItem, ReportView } from "../../lib/triallens";
import { button } from "./ui";
import { CONDITIONS, SUGGESTIONS, conditionSummary, levelColors, matchCountLabel, type PanelPatient, type Phase, type SourceNode } from "../../lib/workspace-data";

type ReportPanelProps = {
  phase: Phase;
  query: string;
  searchOpen: boolean;
  conditionOpen: boolean;
  patientsOpen: boolean;
  conditionIds: string[];
  conditionQuery: string;
  selectedId: string | null;
  cohortSize: number | null;
  report: ReportView | null;
  patients: PanelPatient[];
  sources: SourceNode[];
  error: string;
  reviewCount: number;
  browsing: boolean;
  history: ReportHistoryItem[];
  historyLoading: boolean;
  historyError: string;
  openingId: string | null;
  onQuery: (value: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onToggleConditions: () => void;
  onTogglePatients: () => void;
  onConditionQuery: (value: string) => void;
  onToggleCondition: (id: string) => void;
  onClearConditions: () => void;
  onStart: () => void;
  onSample: () => void;
  attachedName: string | null;
  onAttach: () => void;
  onClearAttachment: () => void;
  onSelectPatient: (id: string) => void;
  onRetry: () => void;
  onOpenLast: () => void;
  /** The schedule as the end of a sentence, such as "on weekdays at 07:00". Null when scheduled runs are off. */
  scheduleLabel?: string | null;
  onShowHistory: () => void;
  onOpenReport: (id: string) => void;
};

export default function ReportPanel(props: ReportPanelProps) {
  const { phase, searchOpen, browsing } = props;
  return (
    <div className="flex h-full flex-col gap-[18px] overflow-y-auto p-5">
      {searchOpen ? (
        <SearchComposer {...props} />
      ) : (
        <div className="flex h-8 items-center justify-between gap-3">
          {browsing ? (
            <p className="text-sm font-semibold tracking-[0.2px] text-muted">REPORTS</p>
          ) : (
            <button type="button" onClick={props.onShowHistory} className="-ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-semibold text-violet transition-colors hover:bg-cleared-bg">
              <span aria-hidden className="text-base leading-none">←</span>
              Reports
            </button>
          )}
          <button type="button" onClick={props.onOpenSearch} aria-label="Ask your panel a question" title="Ask your panel a question" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-cleared-border text-violet transition-colors hover:bg-cleared-bg">
            <svg aria-hidden viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.6 3.4a1.7 1.7 0 0 1 2.4 0l.6.6a1.7 1.7 0 0 1 0 2.4L7.4 15.6 3.5 16.5l.9-3.9 9.2-9.2Z" />
              <path d="m12.2 4.8 3 3" />
            </svg>
          </button>
        </div>
      )}
      {browsing ? <HistoryList {...props} /> : searchOpen ? <MinimizedReport phase={phase} report={props.report} reviewCount={props.reviewCount} cohortSize={props.cohortSize} onShow={props.onCloseSearch} /> : <ReportBody {...props} />}
    </div>
  );
}

function formatStamp(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function HistoryList({ history, historyLoading, historyError, openingId, onOpenReport }: ReportPanelProps) {
  return (
    <section className="space-y-3">
      {historyLoading ? (
        <div className="space-y-2">
          {["86%", "74%", "91%"].map((width) => (
            <div key={width} className="h-14 animate-pulse rounded-lg bg-neutral-100" style={{ width }} />
          ))}
        </div>
      ) : historyError ? (
        <p className="rounded-lg border border-blocked-border bg-blocked-bg px-3.5 py-3 text-sm text-blocked-fg">{historyError}</p>
      ) : history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line px-5 py-6 text-sm leading-5 text-secondary">
          <p>No reports yet. Ask the panel a question to write the first one. The graph stays empty until you open a report.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {history.map((item) => {
            const opening = openingId === item.run_id;
            const when = formatStamp(item.completed_at || item.created_at);
            const review = item.review_count === 1 ? "1 to review" : `${item.review_count} to review`;
            const sources = item.source_count === 1 ? "1 source" : `${item.source_count} sources`;
            return (
              <li key={item.run_id}>
                <button type="button" disabled={Boolean(openingId)} onClick={() => onOpenReport(item.run_id)} className="flex w-full flex-col gap-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-left hover:border-violet disabled:opacity-60">
                  <span className="text-sm font-semibold leading-5 text-ink">{item.title}</span>
                  <span className="text-[11px] tracking-[0.055px] text-secondary">
                    {[when, opening ? "Opening…" : review, sources, item.placeholder ? "Sample" : ""].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function sourceHref(source: SourceNode): string {
  if (source.url) return source.url;
  if (source.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`;
  return "";
}

function SourcesDropdown({ sources }: { sources: SourceNode[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-8 items-center gap-2 rounded-full border border-line bg-canvas px-3 text-[11px] tracking-[0.055px] text-muted">
        <span className="font-medium text-ink">Sources</span>
        <span>{sources.length}</span>
        <span className={`text-secondary ${open ? "inline-block rotate-180" : ""}`}>▾</span>
      </button>
      {open ? (
        <ul className="mt-2 space-y-0.5">
          {sources.map((source) => {
            const href = sourceHref(source);
            const row = (
              <>
                <span className="shrink-0 font-mono text-xs font-medium text-secondary">{source.label}</span>
                <span className="min-w-0 flex-1 truncate">{source.pmid ? `${source.citation} · PMID ${source.pmid}` : source.citation}</span>
                {href ? <span className="shrink-0 text-accent">↗</span> : null}
              </>
            );
            return (
              <li key={source.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] leading-4 tracking-[0.055px] text-ink hover:bg-canvas">
                    {row}
                  </a>
                ) : (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-[11px] leading-4 tracking-[0.055px] text-ink">{row}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function SearchComposer({
  phase,
  query,
  conditionIds,
  conditionOpen,
  patientsOpen,
  cohortSize,
  onQuery,
  onCloseSearch,
  onToggleConditions,
  onTogglePatients,
  onStart,
  onSample,
  attachedName,
  onAttach,
  onClearAttachment,
}: ReportPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-[11px] tracking-[0.055px] text-muted">
        <span>ASK YOUR PANEL</span>
        <button type="button" onClick={onCloseSearch} className="tracking-[0.055px]">
          Esc to close
        </button>
      </div>
      <label className="flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5">
        <span className="pt-0.5 text-muted" aria-hidden>
          ⌕
        </span>
        <textarea value={query} onChange={(event) => onQuery(event.target.value)} rows={2} className="min-h-[40px] w-full resize-none bg-transparent text-sm leading-5 text-ink outline-none" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onTogglePatients} className={`flex h-10 items-center justify-between rounded-lg border px-3 text-left ${patientsOpen ? "border-violet" : "border-line"}`}>
          <span className="text-[11px] tracking-[0.055px] text-muted">Patients</span>
          <span className="text-sm text-ink">{cohortSize ? `All ${cohortSize}` : "All"}</span>
          <span className="text-secondary">▾</span>
        </button>
        <button type="button" onClick={onToggleConditions} className={`flex h-10 items-center justify-between gap-2 rounded-lg border px-3 text-left ${conditionOpen ? "border-violet bg-cleared-bg" : "border-line"}`}>
          <span className="text-[11px] tracking-[0.055px] text-muted">Condition</span>
          <span className="truncate text-sm text-ink">{conditionSummary(conditionIds)}</span>
          <span className="text-secondary">▾</span>
        </button>
      </div>
      {patientsOpen && (
        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
          <span className="mr-2 inline-grid h-[18px] w-[18px] place-items-center rounded bg-violet text-[10px] text-white">✓</span>
          {cohortSize ? `All ${cohortSize} patients` : "All patients"}
        </div>
      )}
      {attachedName ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent-surface pl-3 pr-1.5 text-xs font-medium text-accent">
          <span className="min-w-0 truncate">
            <span className="text-[11px] font-normal text-accent/80">Attached · </span>
            {attachedName}
          </span>
          <button type="button" onClick={onClearAttachment} aria-label="Remove attached source" className={`${button.icon} h-7 w-7 text-base leading-none hover:bg-surface`}>
            ×
          </button>
        </div>
      ) : (
        <button type="button" onClick={onAttach} disabled={phase === "running"} className={`${button.secondary} w-full`}>
          <span aria-hidden className="text-base leading-none">+</span>
          Attach a source
          <span className="text-[11px] font-normal text-muted">optional · PDF, DOCX or TXT</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onStart} disabled={phase === "running"} className={button.primary}>
          {phase === "running" ? "Running…" : "Start run"}
        </button>
        <button type="button" onClick={onSample} disabled={phase === "running"} className={button.secondary}>
          Sample report
        </button>
      </div>
      <div>
        <p className="mb-1.5 text-[11px] tracking-[0.055px] text-muted">TRY ASKING</p>
        <div className="space-y-1">
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => onQuery(suggestion)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-ink hover:bg-canvas">
              <span className="text-muted">↳</span>
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function MinimizedReport({ phase, report, reviewCount, cohortSize, onShow }: { phase: Phase; report: ReportView | null; reviewCount: number; cohortSize: number | null; onShow: () => void }) {
  const ready = (phase === "ready" || phase === "empty") && report;
  const total = cohortSize ?? reviewCount;
  return (
    <button type="button" onClick={onShow} className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left">
      <span>
        <span className="block text-[11px] tracking-[0.055px] text-muted">{ready ? report.kicker : "PANEL REPORT"}</span>
        <span className="mt-1 block text-sm font-semibold text-ink">{ready ? report.title : phase === "failed" ? "This run did not finish" : phase === "running" ? "Writing the report" : "No report yet"}</span>
        <span className="mt-1 block text-[11px] tracking-[0.055px] text-secondary">
          {ready ? `${reviewCount} of ${total} patients to review` : "Start a run to see one here"}
        </span>
      </span>
      <span className="text-sm font-semibold text-ink">Show ▾</span>
    </button>
  );
}

function ReportBody(props: ReportPanelProps) {
  if (props.phase === "idle") return <IdleReport cohortSize={props.cohortSize} scheduleLabel={props.scheduleLabel} />;
  if (props.phase === "running") return <RunningReport />;
  if (props.phase === "failed") return <FailedReport error={props.error} onRetry={props.onRetry} onSample={props.onSample} onOpenLast={props.onOpenLast} />;
  return <ReadyReport {...props} />;
}

function IdleReport({ cohortSize, scheduleLabel }: { cohortSize: number | null; scheduleLabel?: string | null }) {
  const count = cohortSize ? `${cohortSize} synthetic patients` : "your synthetic patients";
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">PANEL REPORT</p>
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">No report yet</h2>
      </header>
      <div className="rounded-xl border border-dashed border-line px-5 py-6 text-sm leading-5 text-secondary">
        <p>Start a run to check recent literature against {count}. The report will appear here, one section per matched patient.</p>
        <p className="mt-4">{scheduleLabel ? `Or wait for the scheduled run ${scheduleLabel}. Scheduled runs never send mail.` : "Scheduled runs are off, so a report is written only when you start a run."}</p>
      </div>
      <Caution />
    </>
  );
}

function RunningReport() {
  const widths = ["86%", "96%", "91%", "68%", "96%", "82%", "93%", "59%"];
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">PANEL REPORT</p>
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">Writing the report</h2>
      </header>
      <div className="space-y-4">
        {widths.map((width, index) => (
          <div key={width + index} className="h-2.5 animate-pulse rounded-full bg-neutral-100" style={{ width }} />
        ))}
      </div>
      <p className="text-[11px] tracking-[0.055px] text-muted">The report appears when all three steps finish.</p>
      <Caution />
    </>
  );
}

function FailedReport({ error, onRetry, onSample, onOpenLast }: { error: string; onRetry: () => void; onSample: () => void; onOpenLast: () => void }) {
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">PANEL REPORT</p>
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">This run did not finish</h2>
      </header>
      <div className="rounded-lg border border-blocked-border bg-blocked-bg px-3.5 py-3 text-blocked-fg">
        <p className="text-sm font-semibold">× {error || "The run stopped before a report was written"}</p>
        <p className="mt-1.5 text-[11px] leading-4 tracking-[0.055px]">No report was produced and no mail was sent. Open last report loads the newest completed report still on the server.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRetry} className={button.primary}>
          Retry run
        </button>
        <button type="button" onClick={onOpenLast} className={button.secondary}>
          Open last report
        </button>
      </div>
      <button type="button" onClick={onSample} className={button.secondary}>
        Sample report
      </button>
      <Caution />
    </>
  );
}

function ReadyReport({ phase, selectedId, onSelectPatient, report, patients, sources, cohortSize, reviewCount }: ReportPanelProps) {
  const total = cohortSize ?? patients.length;
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">{report?.kicker || "PANEL REPORT"}</p>
        <h2 className="font-display text-xl font-semibold leading-7 tracking-[-0.1px] text-ink">{report?.title || "Panel report"}</h2>
      </header>
      {sources.length > 0 ? <SourcesDropdown sources={sources} /> : null}
      {report?.placeholder && <Caution text="Sample report. The sources are fixed landmark trials, not a live PubMed search. The write-up is from Grok." />}
      <Caution text={report?.placeholder ? "Synthetic records. Decision support, not a treatment recommendation." : report?.footer} />
      <Section index="1" title="THE QUESTION THIS RUN ASKED">
        <p className="text-base leading-6 text-ink">{report?.question}</p>
      </Section>
      <Section index="2" title="WHAT THE LITERATURE SUPPORTS">
        <Findings lines={report?.supports ?? []} rule="border-violet" />
      </Section>
      <Section index="3" title="WHAT IT DOES NOT SUPPORT">
        <Findings lines={report?.limits ?? []} rule="border-caution-border" />
      </Section>
      <section className="space-y-2 pt-1">
        <h3 className="text-[15px] font-bold leading-5 tracking-[0.2px] text-violet">4&nbsp;&nbsp;PATIENTS TO REVIEW</h3>
        {phase === "empty" || reviewCount === 0 ? (
          <div className="rounded-lg border border-cleared-border bg-cleared-bg px-3.5 py-3">
            <p className="text-sm font-semibold text-cleared-fg">✓ No patients to review this run</p>
            <p className="mt-1 text-[11px] leading-4 tracking-[0.055px] text-secondary">All {total} synthetic patients were checked. None matched this evidence closely enough to flag. That is a complete, successful run.</p>
          </div>
        ) : (
          patients.map((patient) => {
            const colors = levelColors(patient.level);
            const selected = patient.id === selectedId;
            return (
              <button key={patient.id} type="button" onClick={() => onSelectPatient(patient.id)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left ${selected ? "border-violet bg-cleared-bg" : "border-line bg-surface"}`}>
                <span>
                  <span className="block text-base font-semibold leading-6 text-ink">{patient.name}</span>
                  <span className="block text-xs leading-4 text-secondary">{patient.summary}</span>
                </span>
                <span className="rounded px-2 py-0.5 text-xs font-medium tracking-[0.06px]" style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
                  {patient.level}
                </span>
              </button>
            );
          })
        )}
      </section>
    </>
  );
}

/** Splits a finding into the clause that says who it is about and the rest, so the eye can land on the subject first. */
function leadOf(line: string): [string, string] {
  if (!/^(for|in|across|among|with|without)\b/i.test(line)) return ["", line];
  // The subject can itself be a list with commas, so the cut is the comma that the main clause follows.
  const clause = /,(?=\s(?:a|an|the|one|two|three|no|none|this|these|those|it|there|each|every|some|several)\b)/i.exec(line);
  if (!clause || clause.index < 12 || clause.index > 90) return ["", line];
  return [line.slice(0, clause.index + 1), line.slice(clause.index + 1)];
}

/** The report's findings as separate items: one rule down the side of each, with room between them. */
function Findings({ lines, rule }: { lines: string[]; rule: string }) {
  if (lines.length === 1) return <p className="text-base leading-6 text-ink">{lines[0]}</p>;
  return (
    <ul className="space-y-3 pt-1">
      {lines.map((line) => {
        const [lead, rest] = leadOf(line);
        return (
          <li key={line} className={`border-l-2 pl-3 text-base leading-6 text-ink ${rule}`}>
            {lead && <span className="font-semibold">{lead}</span>}
            {rest}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 pt-1">
      <h3 className="text-[15px] font-bold leading-5 tracking-[0.2px] text-violet">
        {index}&nbsp;&nbsp;{title}
      </h3>
      {children}
    </section>
  );
}

function Caution({ text = "Synthetic records. Decision support, not a treatment recommendation." }: { text?: string }) {
  return <p className="rounded-md border border-caution-border bg-caution-bg px-2.5 py-2 text-[11px] leading-4 tracking-[0.055px] text-caution-fg">{text}</p>;
}

export function ConditionMenu({
  ids,
  query,
  onQuery,
  onToggle,
  onClear,
}: {
  ids: string[];
  query: string;
  onQuery: (value: string) => void;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const visible = CONDITIONS.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div data-interactive className="absolute right-5 top-[168px] z-20 w-[300px] rounded-xl border border-line bg-surface p-2.5 shadow-[0_12px_40px_rgba(18,25,51,0.08)]">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-2.5 text-sm text-muted">
        <span aria-hidden>⌕</span>
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Filter conditions" className="w-full bg-transparent text-ink outline-none placeholder:text-muted" />
      </label>
      <p className="px-1.5 pb-1 pt-3 text-[11px] tracking-[0.055px] text-muted">IN YOUR PANEL</p>
      <ul>
        {visible.map((item) => {
          const checked = ids.includes(item.id);
          return (
            <li key={item.id}>
              <button type="button" onClick={() => onToggle(item.id)} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-2 text-left hover:bg-canvas">
                <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[10px] ${checked ? "border-violet bg-violet text-white" : "border-line-strong bg-surface text-transparent"}`}>✓</span>
                <span className="flex-1 text-sm leading-5 text-ink">{item.label}</span>
                <span className="text-[11px] tracking-[0.055px] text-secondary">{item.count} patients</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex items-center justify-between border-t border-line px-1.5 pt-2 text-[11px] tracking-[0.055px]">
        <span className="text-secondary">{matchCountLabel(ids)}</span>
        <button type="button" onClick={onClear} className="text-[11px] font-semibold tracking-[0.055px] text-violet">
          Clear
        </button>
      </div>
    </div>
  );
}
