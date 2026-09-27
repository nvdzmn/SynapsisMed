"use client";
import { useState } from "react";
import { button } from "./ui";

type MessagePoint = { text: string; checked: boolean };

type MessageDrawerProps = {
  patientName: string;
  draft: string;
  points: MessagePoint[];
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
  onRewrite: (instruction: string) => void;
  onSend: () => void;
  onClose: () => void;
};

export default function MessageDrawer({ patientName, draft, points, approved, sent, sentDetail, drafting, sending, reasons, error, onDraft, onTogglePoint, onToggleApproved, onRewrite, onSend, onClose }: MessageDrawerProps) {
  const [instruction, setInstruction] = useState("");
  const blocked = reasons.length > 0;
  const locked = approved || sent || drafting;
  const rewriting = drafting && draft.length > 0;
  const noPoints = !points.some((point) => point.checked);
  // With no points ticked the message is personal, so the writer needs to be told what to say.
  const rewriteOff = drafting || sending || sent || approved || (noPoints && !instruction.trim());
  const rewrite = () => {
    if (rewriteOff) return;
    onRewrite(instruction);
    setInstruction("");
  };
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">Patient message</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">For {patientName} · separate from voice</p>
        </div>
        <button type="button" onClick={onClose} className={`${button.icon} text-lg leading-none`} aria-label="Close message">
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
          {drafting ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.055px] text-violet">
              <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-violet border-t-transparent" />
              {rewriting ? "Rewriting" : "Writing"}
            </span>
          ) : (
            <span className="text-[11px] tracking-[0.055px] text-muted">{locked ? "Locked" : "Editable"}</span>
          )}
        </div>
        <div className="relative">
          <textarea
            value={draft}
            readOnly={locked}
            aria-busy={drafting}
            onChange={(event) => onDraft(event.target.value)}
            className={`h-[220px] w-full resize-none rounded-xl border bg-surface p-3.5 text-sm leading-6 text-ink outline-none transition-colors read-only:bg-canvas ${drafting ? "border-violet text-muted" : "border-line"}`}
          />
          {drafting && !rewriting && (
            <div aria-hidden className="pointer-events-none absolute inset-0 space-y-2.5 rounded-xl p-4">
              {["92%", "78%", "86%", "64%", "81%", "45%"].map((width) => (
                <div key={width} className="h-2.5 animate-pulse rounded-full bg-neutral-100" style={{ width }} />
              ))}
            </div>
          )}
          {rewriting && <div aria-hidden className="pointer-events-none absolute inset-0 animate-pulse rounded-xl bg-cleared-bg opacity-60" />}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            maxLength={500}
            disabled={rewriteOff}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") rewrite();
            }}
            placeholder={noPoints ? "What should the message say?" : "What should change? (optional)"}
            aria-label="Rewrite instruction"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-violet disabled:cursor-not-allowed disabled:bg-canvas"
          />
          <button type="button" disabled={rewriteOff} onClick={rewrite} className={button.secondary}>
            {rewriting ? "Rewriting…" : "Rewrite"}
          </button>
        </div>
        <p className="text-[11px] leading-4 tracking-[0.055px] text-muted">
          {approved ? "Untick approval to rewrite." : noPoints ? "No points ticked: the message is written only from what you type here, with no findings." : "Rewrites use the points ticked above and replace the text here."}
        </p>
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
          <p className="mt-1 text-[11px] tracking-[0.055px] text-secondary">{sentDetail || "Emailed to the test inbox · synthetic patient"}</p>
        </div>
      ) : (
        <>
          {error && <p className="text-[11px] leading-4 tracking-[0.055px] text-blocked-fg">{error}</p>}
          <button type="button" disabled={!approved || blocked || drafting || sending} onClick={onSend} className={button.primary}>
            {sending ? "Sending…" : approved ? "Send to test inbox" : "Send"}
          </button>
          <p className="text-center text-[11px] tracking-[0.055px] text-muted">{approved ? "Sends the approved text exactly as shown." : "Send stays off until you approve the exact text."}</p>
        </>
      )}
    </div>
  );
}
