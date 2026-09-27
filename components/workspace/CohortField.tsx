"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphEdge } from "../../lib/triallens";
import { QUIET_DOTS, levelColors, type PanelPatient, type Phase, type QuietDot, type SourceNode } from "../../lib/workspace-data";

type CohortFieldProps = {
  phase: Phase;
  patients: PanelPatient[];
  quiet: QuietDot[];
  sources: SourceNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  showCard: boolean;
  showVoice: boolean;
  muted: boolean;
  voiceYou: string;
  voiceReply: string;
  voiceError: string;
  onSelect: (id: string) => void;
  onTalk: () => void;
  onDraft: () => void;
  onEndVoice: () => void;
  onToggleMute: () => void;
};

const WAVE = [6, 12, 20, 14, 26, 18, 10, 22, 30, 16, 8, 20, 12, 24, 14, 6, 18, 10, 4, 12, 8];

export default function CohortField({
  phase,
  patients,
  quiet,
  sources,
  edges,
  selectedId,
  showCard,
  showVoice,
  muted,
  voiceYou,
  voiceReply,
  voiceError,
  onSelect,
  onTalk,
  onDraft,
  onEndVoice,
  onToggleMute,
}: CohortFieldProps) {
  const [angle, setAngle] = useState(0);
  const [scale, setScale] = useState(1);
  const drag = useRef<{ x: number; angle: number } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const showGraph = phase === "ready";
  const showSources = (phase === "ready" || phase === "running" || phase === "empty") && sources.length > 0;
  const selected = patients.find((patient) => patient.id === selectedId) ?? null;
  const dots = quiet.length ? quiet : QUIET_DOTS;
  const located = (id: string) => patients.find((patient) => patient.id === id) ?? sources.find((source) => source.id === id);

  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setScale((current) => Math.min(1.35, Math.max(0.8, current + (event.deltaY < 0 ? 0.05 : -0.05))));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-interactive]")) return;
    drag.current = { x: event.clientX, angle };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setAngle(drag.current.angle + (event.clientX - drag.current.x) * 0.35);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      ref={fieldRef}
      className="relative min-h-[420px] flex-1 overflow-hidden rounded-xl border border-line bg-surface"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg viewBox="0 0 920 689" className="absolute inset-0 h-full w-full" role="img" aria-label="Patient cohort field">
        <g transform={`translate(460 344) rotate(${angle}) scale(${scale}) translate(-460 -344)`}>
          <ellipse cx="430" cy="300" rx="330" ry="110" fill="none" stroke="var(--border-strong)" strokeDasharray="4 6" opacity="0.7" />
          <ellipse cx="430" cy="300" rx="240" ry="80" fill="none" stroke="var(--border-strong)" strokeDasharray="4 6" opacity="0.55" />
          <ellipse cx="430" cy="300" rx="150" ry="50" fill="none" stroke="var(--border-strong)" strokeDasharray="4 6" opacity="0.4" />
          {dots.map((dot, index) => (
            <circle key={`${dot.x}-${dot.y}`} cx={dot.x} cy={dot.y} r={dot.r} fill={index % 3 === 0 ? "var(--neutral-400)" : "var(--border-strong)"} />
          ))}
          {showGraph &&
            edges.map((edge) => {
              const from = located(edge.from);
              const to = located(edge.to);
              if (!from || !to) return null;
              return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edge.color} strokeWidth="1.5" />;
            })}
          {showSources &&
            sources.map((source) => (
              <g key={source.id} transform={`translate(${source.x} ${source.y}) rotate(${-angle})`}>
                <rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)" fill="var(--source-ink)" />
                <text x="14" y="16" textAnchor="start" fill="var(--text-secondary)" fontFamily="var(--font-mono), monospace" fontSize="12" fontWeight="500">
                  {source.label}
                </text>
              </g>
            ))}
          {(showGraph ? patients : []).map((patient) => {
            const active = showGraph;
            const colors = levelColors(patient.level);
            const radius = active ? patient.r : 6;
            return (
              <g key={patient.id} data-interactive={active ? "true" : undefined} transform={`translate(${patient.x} ${patient.y}) rotate(${-angle})`} className={active ? "cursor-pointer" : undefined} onClick={() => active && onSelect(patient.id)}>
                {active && selectedId === patient.id && <circle r="20" fill="none" stroke="var(--action-primary)" strokeWidth="1.5" />}
                <circle r={radius} fill={active ? colors.node : "var(--border-strong)"} />
                {active && (
                  <text x={22} y="4" fill="var(--text-primary)" fontFamily="var(--font-inter), Inter, sans-serif" fontSize="12" fontWeight="500">
                    {patient.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <p className="pointer-events-none absolute bottom-4 right-4 text-[11px] tracking-[0.055px] text-muted">Drag to rotate · scroll to zoom · quiet patients have no edge</p>
      {showCard && selected && <PatientCard patient={selected} onTalk={onTalk} onDraft={onDraft} />}
      {showVoice && <VoicePanel patientName={selected?.name || "this report"} muted={muted} you={voiceYou} reply={voiceReply} error={voiceError} onToggleMute={onToggleMute} onEnd={onEndVoice} />}
    </div>
  );
}

function PatientCard({ patient, onTalk, onDraft }: { patient: PanelPatient; onTalk: () => void; onDraft: () => void }) {
  const colors = levelColors(patient.level);
  return (
    <article data-interactive className="absolute bottom-4 left-4 flex w-[320px] max-w-[calc(100%-2rem)] flex-col gap-2.5 rounded-xl border-[1.5px] border-violet bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold leading-5 text-ink">{patient.name}</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">{patient.meta}</p>
        </div>
        <span className="rounded px-2 py-0.5 text-xs font-medium tracking-[0.06px]" style={{ background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}` }}>
          {patient.level}
        </span>
      </header>
      <div className="space-y-1 text-[11px] leading-4 tracking-[0.055px]">
        <p className="text-muted">CHART FIELDS USED</p>
        {patient.fields.map((field) => (
          <p key={field} className="text-ink">
            {field}
          </p>
        ))}
      </div>
      {patient.mismatches.length > 0 && (
        <div className="space-y-1 text-[11px] leading-4 tracking-[0.055px]">
          <p className="text-muted">MISMATCHES</p>
          {patient.mismatches.map((item) => (
            <p key={item} className="text-caution-fg">
              {item}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-1 text-[11px] leading-4 tracking-[0.055px]">
        <p className="text-muted">CLINICIAN REVIEW NOTE</p>
        <p className="text-ink">{patient.review}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onTalk} className="flex h-10 flex-1 items-center justify-center rounded-lg border border-line-strong bg-surface text-sm font-semibold text-ink">
          ● Talk about {patient.name.split(" ")[0]}
        </button>
        <button type="button" onClick={onDraft} className="h-10 flex-1 rounded-lg bg-violet text-sm font-semibold text-white hover:bg-violet-press">
          Draft a note
        </button>
      </div>
    </article>
  );
}

function VoicePanel({ patientName, muted, you, reply, error, onToggleMute, onEnd }: { patientName: string; muted: boolean; you: string; reply: string; error: string; onToggleMute: () => void; onEnd: () => void }) {
  return (
    <section data-interactive className="absolute bottom-4 left-4 flex w-[360px] max-w-[calc(100%-2rem)] flex-col gap-3 rounded-xl border-[1.5px] border-violet bg-surface p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold leading-5 text-ink">Grok Voice</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">Discussing {patientName} · briefed on this report</p>
        </div>
        <span className="pt-2 text-xs font-medium tracking-[0.06px] text-cleared-fg">{muted ? "Muted" : "Listening"}</span>
      </header>
      <div className="flex h-[38px] items-center gap-[3px]" aria-hidden>
        {WAVE.map((height, index) => (
          <span
            key={index}
            className="w-1 rounded-sm bg-violet"
            style={{
              height,
              transformOrigin: "center",
              opacity: muted ? 0.35 : 0.9,
              animation: muted ? undefined : `voice-bar 1.1s ease-in-out ${index * 0.05}s infinite`,
            }}
          />
        ))}
      </div>
      <div>
        <p className="text-[11px] tracking-[0.055px] text-muted">You</p>
        <p className="text-sm leading-5 text-ink">{you || "Your question will appear here."}</p>
      </div>
      <div>
        <p className="text-[11px] tracking-[0.055px] text-muted">Grok</p>
        <p className="text-sm leading-5 text-ink">{error || reply}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onToggleMute} className="h-10 flex-1 rounded-lg border border-line-strong bg-surface text-sm font-semibold text-ink">
          {muted ? "Unmute" : "Mute"}
        </button>
        <button type="button" onClick={onEnd} className="h-10 flex-1 rounded-lg border border-line-strong bg-surface text-sm font-semibold text-ink">
          End voice
        </button>
      </div>
      <p className="text-[11px] leading-4 tracking-[0.055px] text-muted">Voice discusses the report only. It can&apos;t search, draft, or send.</p>
    </section>
  );
}
