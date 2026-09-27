"use client";

type NotePoint = { text: string; checked: boolean };

type NoteDrawerProps = {
  patientName: string;
  draft: string;
  points: NotePoint[];
  approved: boolean;
  sent: boolean;
  sentDetail: string;
  drafting: boolean;
  sending: boolean;
  reasons: string[];
  error: string;
  onDraft: (value: string) => void;
  onTogglePoint: (index: number) => void;
  onToggleApproved: () => void;
  onSend: () => void;
  onClose: () => void;
};

export default function NoteDrawer({ patientName, draft, points, approved, sent, sentDetail, drafting, sending, reasons, error, onDraft, onTogglePoint, onToggleApproved, onSend, onClose }: NoteDrawerProps) {
  const blocked = reasons.length > 0;
  const locked = approved || sent || drafting;
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">Patient note</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">For {patientName} · separate from voice</p>
        </div>
        <button type="button" onClick={onClose} className="px-1 text-lg leading-none text-secondary" aria-label="Close note">
          ×
        </button>
      </header>
      <p className="rounded-md border border-cleared-border bg-cleared-bg px-2.5 py-2 text-[11px] leading-4 tracking-[0.055px] text-cleared-fg">Synthetic panel. Delivery goes only to the test inbox.</p>
      <section className="space-y-2">
        <h3 className="text-xs font-medium tracking-[0.06px] text-accent">1&nbsp;&nbsp;POINTS FROM THE REPORT</h3>
        {points.map((point, index) => (
          <label key={point.text} className="flex items-start gap-2.5 text-sm leading-5 text-ink">
            <button
              type="button"
              aria-pressed={point.checked}
              onClick={() => onTogglePoint(index)}
              className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[10px] ${point.checked ? "border-violet bg-violet text-white" : "border-line-strong bg-surface text-transparent"}`}
            >
              ✓
            </button>
            <span>{point.text}</span>
          </label>
        ))}
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-[0.06px] text-accent">2&nbsp;&nbsp;PLAIN-LANGUAGE DRAFT</h3>
          <span className="text-[11px] tracking-[0.055px] text-muted">{drafting ? "Writing" : locked ? "Locked" : "Editable"}</span>
        </div>
        <textarea
          value={drafting ? "Writing a plain-language note from the points you selected…" : draft}
          readOnly={locked}
          onChange={(event) => onDraft(event.target.value)}
          className="h-[220px] w-full resize-none rounded-xl border border-line bg-surface p-3.5 text-sm leading-6 text-ink outline-none read-only:bg-canvas"
        />
      </section>
      {blocked && (
        <div className="rounded-lg border border-blocked-border bg-blocked-bg px-3.5 py-3 text-blocked-fg">
          <p className="text-sm font-semibold">Send blocked</p>
          <ul className="mt-2 space-y-1 text-[11px] leading-4 tracking-[0.055px]">
            {reasons.map((reason) => (
              <li key={reason}>× {reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-4 tracking-[0.055px]">Remove the highlighted text, then approve the new wording.</p>
        </div>
      )}
      <button
        type="button"
        disabled={blocked || sent || drafting || sending}
        onClick={onToggleApproved}
        className={`flex items-start gap-2.5 rounded-lg border px-3 py-3 text-left ${approved ? "border-violet bg-cleared-bg" : "border-line"} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[10px] ${approved ? "border-violet bg-violet text-white" : "border-line-strong text-transparent"}`}>✓</span>
        <span>
          <span className="block text-sm font-semibold text-ink">I approve this exact text</span>
          <span className="block text-[11px] tracking-[0.055px] text-secondary">
            {blocked ? "Unavailable until the blocked items are removed" : approved ? "Approved 08:12 · editing will reset approval" : "Any edit after approving resets it"}
          </span>
        </span>
      </button>
      {sent ? (
        <div className="rounded-lg border border-cleared-border bg-cleared-bg px-3.5 py-3">
          <p className="text-sm font-semibold text-cleared-fg">✓ Sent to test inbox</p>
          <p className="mt-1 text-[11px] tracking-[0.055px] text-secondary">{sentDetail || "Synthetic patient, no real delivery"}</p>
        </div>
      ) : (
        <>
          {error && <p className="text-[11px] leading-4 tracking-[0.055px] text-blocked-fg">{error}</p>}
          <button type="button" disabled={!approved || blocked || drafting || sending} onClick={onSend} className="h-10 rounded-lg text-sm font-semibold disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400 enabled:bg-violet enabled:text-white enabled:hover:bg-violet-press">
            {sending ? "Sending…" : approved ? "Send to test inbox" : "Send"}
          </button>
          <p className="text-center text-[11px] tracking-[0.055px] text-muted">{approved ? "Sends the approved text exactly as shown." : "Send stays off until you approve the exact text."}</p>
        </>
      )}
    </div>
  );
}
