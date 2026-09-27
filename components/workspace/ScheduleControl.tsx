"use client";
import { useEffect, useRef, useState } from "react";
import { button } from "./ui";

/** Days are numbered as JavaScript numbers them: 0 is Sunday. */
export type Schedule = { on: boolean; days: number[]; time: string };

const DEFAULT_SCHEDULE: Schedule = { on: true, days: [1, 2, 3, 4, 5], time: "07:00" };
const STORE_KEY = "synapsemed.schedule";
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PRESETS: { label: string; days: number[] }[] = [
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
];

const same = (a: number[], b: number[]) => a.length === b.length && a.every((day) => b.includes(day));

function valid(value: unknown): value is Schedule {
  const item = value as Schedule;
  return Boolean(item) && typeof item.on === "boolean" && Array.isArray(item.days) && item.days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) && /^\d{2}:\d{2}$/.test(item.time);
}

/** "Weekdays at 07:00", "Mon, Wed, Fri at 18:30", or that scheduled runs are off. */
export function describeSchedule(schedule: Schedule): string {
  if (!schedule.on || schedule.days.length === 0) return "Scheduled runs are off";
  const days = same(schedule.days, PRESETS[0]!.days) ? "Weekdays" : schedule.days.length === 7 ? "Every day" : same(schedule.days, [0, 6]) ? "Weekends" : WEEK.filter((day) => schedule.days.includes(day)).map((day) => SHORT[day]).join(", ");
  return `${days} at ${schedule.time}`;
}

/** The schedule as the end of a sentence: "on weekdays at 07:00", "on Mon, Wed at 18:30". Null when runs are off. */
export function scheduleInSentence(schedule: Schedule): string | null {
  if (!schedule.on || schedule.days.length === 0) return null;
  const words = describeSchedule(schedule);
  if (words.startsWith("Every day")) return `every day${words.slice("Every day".length)}`;
  return /^Week/.test(words) ? `on ${words.charAt(0).toLowerCase()}${words.slice(1)}` : `on ${words}`;
}

/** The next time the schedule fires after `now`, as "Mon 07:00", "Today 18:30" or "Tomorrow 07:00". */
export function nextRun(schedule: Schedule, now: Date): string | null {
  if (!schedule.on || schedule.days.length === 0) return null;
  const [hours = 0, minutes = 0] = schedule.time.split(":").map(Number);
  for (let ahead = 0; ahead <= 7; ahead += 1) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ahead, hours, minutes);
    if (!schedule.days.includes(at.getDay()) || at <= now) continue;
    return `${ahead === 0 ? "Today" : ahead === 1 ? "Tomorrow" : SHORT[at.getDay()]} ${schedule.time}`;
  }
  return null;
}

/** The schedule the physician set, kept in this browser. It is a preference only: nothing here starts a run. */
export function useSchedule(): [Schedule, (next: Schedule) => void] {
  const [schedule, setSchedule] = useState<Schedule>(DEFAULT_SCHEDULE);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? "null");
      if (valid(saved)) setSchedule(saved);
    } catch {
      /* A damaged or blocked store falls back to the default schedule. */
    }
  }, []);
  const save = (next: Schedule) => {
    setSchedule(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* The schedule still applies for this visit. */
    }
  };
  return [schedule, save];
}

export default function ScheduleControl({ schedule, onSave }: { schedule: Schedule; onSave: (next: Schedule) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Schedule>(schedule);
  // The clock is read after mount so the server and the browser render the same first frame.
  const [now, setNow] = useState<Date | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const next = now ? nextRun(schedule, now) : null;
  const headline = !schedule.on || schedule.days.length === 0 ? "No scheduled run" : next ? `Next scheduled run · ${next}` : "Next scheduled run";
  const draftNext = now ? nextRun(draft, now) : null;
  const unset = draft.on && draft.days.length === 0;
  const changed = draft.on !== schedule.on || draft.time !== schedule.time || !same(draft.days, schedule.days);

  const toggleDay = (day: number) => setDraft((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day] }));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(schedule);
          setOpen((current) => !current);
        }}
        className={`group flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-right transition-colors hover:bg-canvas ${open ? "bg-canvas" : ""}`}
      >
        <span>
          <span className="block text-sm font-semibold leading-5">{headline}</span>
          <span className="block text-[11px] tracking-[0.055px] text-secondary">{next ? `${describeSchedule(schedule)} · scheduled runs never send mail` : schedule.on && schedule.days.length ? describeSchedule(schedule) : "Scheduled runs are off · start a run yourself"}</span>
        </span>
        <span aria-hidden className={`text-xs text-muted transition-transform group-hover:text-ink ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label="Scheduled run" className="absolute right-0 top-[calc(100%+8px)] z-30 w-[336px] rounded-xl border border-line bg-surface p-4 text-left shadow-[0_12px_40px_rgba(18,25,51,0.12)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold leading-5 text-ink">Scheduled run</h2>
              <p className="text-[11px] leading-4 tracking-[0.055px] text-secondary">Checks the whole panel against new evidence.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={draft.on}
              aria-label="Scheduled runs"
              onClick={() => setDraft((current) => ({ ...current, on: !current.on }))}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${draft.on ? "bg-violet" : "bg-neutral-100"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(18,25,51,0.3)] transition-[left] ${draft.on ? "left-[22px]" : "left-0.5"}`} />
            </button>
          </div>

          <fieldset disabled={!draft.on} className="mt-4 space-y-4 disabled:opacity-50">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] tracking-[0.055px] text-muted">DAYS</p>
                <div className="flex gap-1.5">
                  {PRESETS.map((preset) => (
                    <button key={preset.label} type="button" onClick={() => setDraft((current) => ({ ...current, days: preset.days }))} className={`${button.small} ${same(draft.days, preset.days) ? "border-violet text-violet" : ""}`}>
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1.5">
                {WEEK.map((day) => {
                  const picked = draft.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={picked}
                      aria-label={LONG[day]}
                      onClick={() => toggleDay(day)}
                      className={`h-9 min-w-0 flex-1 rounded-lg border text-xs font-semibold transition-colors ${picked ? "border-violet bg-violet text-white" : "border-line bg-surface text-secondary hover:bg-canvas hover:text-ink"}`}
                    >
                      {SHORT[day]?.slice(0, 2)}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block space-y-2">
              <span className="block text-[11px] tracking-[0.055px] text-muted">TIME</span>
              <input
                type="time"
                value={draft.time}
                onChange={(event) => event.target.value && setDraft((current) => ({ ...current, time: event.target.value }))}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-violet"
              />
            </label>
          </fieldset>

          <p className="mt-4 rounded-md border border-cleared-border bg-cleared-bg px-2.5 py-2 text-[11px] leading-4 tracking-[0.055px] text-cleared-fg">
            {!draft.on ? "Scheduled runs are off. You can still start a run yourself." : unset ? "Pick at least one day." : `${describeSchedule(draft)}${draftNext ? ` · next ${draftNext}` : ""}. Scheduled runs never send mail.`}
          </p>

          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className={`${button.secondary} flex-1`}>
              Cancel
            </button>
            <button
              type="button"
              disabled={unset || !changed}
              onClick={() => {
                onSave({ ...draft, days: WEEK.filter((day) => draft.days.includes(day)) });
                setOpen(false);
              }}
              className={`${button.primary} flex-1`}
            >
              Save schedule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
