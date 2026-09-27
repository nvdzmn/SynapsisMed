"use client";

import { AlertTriangle, ChevronRight, Mic, ShieldAlert } from "lucide-react";
import type { CohortMatch, Patient, RiskLevel } from "../lib/types";

const riskStyles: Record<RiskLevel, string> = {
  CRITICAL: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  HIGH: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  MODERATE: "border-sky-500/30 bg-sky-500/10 text-sky-300",
};

type PatientCohortPanelProps = {
  matches: CohortMatch[];
  onSelect: (patient: Patient) => void;
};

export default function PatientCohortPanel({ matches, onSelect }: PatientCohortPanelProps) {
  return (
    <aside className="flex min-h-[420px] flex-col rounded-2xl border border-slate-800 bg-slate-900/65 p-4 backdrop-blur">
      <div className="mb-3 flex items-start justify-between border-b border-slate-800 pb-3">
        <div>
          <p className="text-xs font-semibold text-slate-100">Actionable cohort</p>
          <p className="mt-0.5 text-[11px] text-slate-500">Evidence-aligned clinical review queue</p>
        </div>
        <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-1 font-mono text-[10px] text-rose-300">
          {matches.length} flagged
        </span>
      </div>
      <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
        {matches.length ? (
          matches.map((match) => (
            <button
              key={match.patient.id}
              onClick={() => onSelect(match.patient)}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/75 p-3 text-left transition hover:border-sky-500/60 hover:bg-slate-800/70"
            >
              <div className="flex justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-100">{match.patient.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {match.patient.id} · {match.patient.age} years
                  </p>
                </div>
                <span className={`h-fit rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${riskStyles[match.risk_level]}`}>
                  <ShieldAlert className="mr-1 inline h-3 w-3" />
                  {match.risk_level}
                </span>
              </div>
              <p className="mt-2 line-clamp-1 text-[11px] text-slate-400">{match.patient.conditions.join(" · ")}</p>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-sky-300">
                <AlertTriangle className="h-3 w-3" />
                {match.match_reasons[0]}
              </p>
              <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2 text-[10px]">
                <span className="text-slate-500">{match.recommended_action}</span>
                <span className="flex items-center gap-1 text-sky-400">
                  Triage <Mic className="h-3 w-3" />
                  <ChevronRight className="h-3 w-3" />
                </span>
              </div>
            </button>
          ))
        ) : (
          <div className="grid h-full place-items-center text-center">
            <p className="text-sm text-slate-400">No cohort members match this study.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
