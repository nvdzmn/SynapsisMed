"use client";

import type { ReactNode } from "react";
import type { ReportView } from "../../lib/triallens";
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
  onQuery: (value: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onToggleConditions: () => void;
  onTogglePatients: () => void;
  onConditionQuery: (value: string) => void;
  onToggleCondition: (id: string) => void;
  onClearConditions: () => void;
  onStart: () => void;
  onSelectPatient: (id: string) => void;
  onRetry: () => void;
  onOpenLast: () => void;
};

export default function ReportPanel(props: ReportPanelProps) {
  const { phase, searchOpen } = props;
  return (
    <div className="flex h-full flex-col gap-[18px] overflow-y-auto p-5">
      {searchOpen ? <SearchComposer {...props} /> : <SearchCollapsed onOpen={props.onOpenSearch} />}
      {searchOpen ? <MinimizedReport phase={phase} report={props.report} reviewCount={props.reviewCount} cohortSize={props.cohortSize} onShow={props.onCloseSearch} /> : <ReportBody {...props} />}
    </div>
  );
}

function SearchCollapsed({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="border-b border-line pb-4">
      <button type="button" onClick={onOpen} className="flex h-10 w-full items-center gap-2.5 rounded-full border border-line bg-canvas px-3.5 text-sm text-muted">
        <span aria-hidden>⌕</span>
        Ask your panel a question…
      </button>
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
        <button type="button" onClick={onTogglePatients} className={`flex h-[42px] items-center justify-between rounded-lg border px-3 text-left ${patientsOpen ? "border-violet" : "border-line"}`}>
          <span className="text-[11px] tracking-[0.055px] text-muted">Patients</span>
          <span className="text-sm text-ink">{cohortSize ? `All ${cohortSize}` : "All"}</span>
          <span className="text-secondary">▾</span>
        </button>
        <button type="button" onClick={onToggleConditions} className={`flex h-[42px] items-center justify-between gap-2 rounded-lg border px-3 text-left ${conditionOpen ? "border-violet bg-cleared-bg" : "border-line"}`}>
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
      <button type="button" onClick={onStart} disabled={phase === "running"} className="h-10 rounded-lg bg-violet text-sm font-semibold text-white hover:bg-violet-press disabled:opacity-60">
        {phase === "running" ? "Running…" : "Start run"}
      </button>
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
  if (props.phase === "idle") return <IdleReport cohortSize={props.cohortSize} />;
  if (props.phase === "running") return <RunningReport />;
  if (props.phase === "failed") return <FailedReport error={props.error} onRetry={props.onRetry} onOpenLast={props.onOpenLast} />;
  return <ReadyReport {...props} />;
}

function IdleReport({ cohortSize }: { cohortSize: number | null }) {
  const count = cohortSize ? `${cohortSize} synthetic patients` : "your synthetic patients";
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">PANEL REPORT</p>
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">No report yet</h2>
      </header>
      <div className="rounded-xl border border-dashed border-line px-5 py-6 text-sm leading-5 text-secondary">
        <p>Start a run to check recent literature against {count}. The report will appear here, one section per matched patient.</p>
        <p className="mt-4">Or wait for the scheduled run on weekdays at 07:00. Scheduled runs never send mail.</p>
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

function FailedReport({ error, onRetry, onOpenLast }: { error: string; onRetry: () => void; onOpenLast: () => void }) {
  return (
    <>
      <header>
        <p className="text-[11px] tracking-[0.055px] text-muted">PANEL REPORT</p>
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">This run did not finish</h2>
      </header>
      <div className="rounded-lg border border-blocked-border bg-blocked-bg px-3.5 py-3 text-blocked-fg">
        <p className="text-sm font-semibold">× {error || "The run stopped before a report was written"}</p>
        <p className="mt-1.5 text-[11px] leading-4 tracking-[0.055px]">No report was produced and no mail was sent. A completed report from earlier in this session is unchanged.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onRetry} className="h-10 rounded-lg bg-violet text-sm font-semibold text-white hover:bg-violet-press">
          Retry run
        </button>
        <button type="button" onClick={onOpenLast} className="h-10 rounded-lg border border-line-strong text-sm font-semibold text-ink">
          Open last report
        </button>
      </div>
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
        <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">{report?.title || "Panel report"}</h2>
      </header>
      <Caution text={report?.footer} />
      <Section index="1" title="THE QUESTION THIS RUN ASKED">
        <p className="text-sm leading-5 text-ink">{report?.question}</p>
      </Section>
      <Section index="2" title="WHAT THE LITERATURE SUPPORTS">
        {(report?.supports ?? []).map((line) => (
          <p key={line} className="text-sm leading-5 text-ink">
            {line}
          </p>
        ))}
      </Section>
      <Section index="3" title="WHAT IT DOES NOT SUPPORT">
        {(report?.limits ?? []).map((line) => (
          <p key={line} className="text-sm leading-5 text-ink">
            {line}
          </p>
        ))}
      </Section>
      <section className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-[0.06px] text-accent">4&nbsp;&nbsp;PATIENTS TO REVIEW</h3>
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
                  <span className="block text-sm font-semibold text-ink">{patient.name}</span>
                  <span className="block text-[11px] tracking-[0.055px] text-secondary">{patient.summary}</span>
                </span>
                <span className="rounded px-2 py-0.5 text-xs font-medium tracking-[0.06px]" style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
                  {patient.level}
                </span>
              </button>
            );
          })
        )}
      </section>
      <section className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-[0.06px] text-accent">5&nbsp;&nbsp;SOURCES</h3>
        {sources.map((source) => (
          <div key={source.id} className="flex items-center justify-between gap-3 text-[11px] leading-4">
            <p className="min-w-0 text-ink">
              <span className="mr-2 font-mono text-xs font-medium text-secondary">{source.label}</span>
              <span className="tracking-[0.055px]">{source.pmid ? `${source.citation} · PMID ${source.pmid}` : source.citation}</span>
            </p>
            {source.pmid ? (
              <a className="shrink-0 tracking-[0.055px] text-accent" href={`https://pubmed.ncbi.nlm.nih.gov/${source.pmid}/`} target="_blank" rel="noreferrer">
                PubMed ↗
              </a>
            ) : null}
          </div>
        ))}
      </section>
    </>
  );
}

function Section({ index, title, children }: { index: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium tracking-[0.06px] text-accent">
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
        <button type="button" onClick={onClear} className="font-medium text-accent">
          Clear
        </button>
      </div>
    </div>
  );
}
