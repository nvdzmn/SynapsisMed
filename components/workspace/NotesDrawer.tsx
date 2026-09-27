"use client";
import { useEffect, useState } from "react";
import { addNote, deleteNote, listNotes, suggestNote, type PatientNote } from "../../lib/triallens";
import { button } from "./ui";

type NotesDrawerProps = {
  patientId: string;
  patientName: string;
  runId: string | null;
  /** Changes when a note is saved from outside the drawer, such as by voice, so the list reloads. */
  version?: number;
  onChanged: () => void;
  onClose: () => void;
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The physician's own notes on one patient. The starting bullets come from this report's review; saved notes are never sent to the patient or to a model. */
export default function NotesDrawer({ patientId, patientName, runId, version = 0, onChanged, onClose }: NotesDrawerProps) {
  const [notes, setNotes] = useState<PatientNote[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestedFrom, setSuggestedFrom] = useState<"model" | "review" | null>(null);

  useEffect(() => {
    let live = true;
    listNotes(patientId)
      .then((found) => live && setNotes(found))
      .catch((cause) => live && setError(cause instanceof Error && cause.message ? cause.message : "Could not load the notes"))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [patientId, version]);

  /** Fills the box with bullets from this report. Anything the physician has already typed is left alone. */
  const suggest = async (replace: boolean) => {
    if (!runId) return;
    setSuggesting(true);
    setError("");
    try {
      const found = await suggestNote(runId, patientId);
      const bullets = found.bullets.map((bullet) => `• ${bullet}`).join("\n");
      if (!bullets) return;
      setText((current) => (replace || !current.trim() ? bullets : current));
      setSuggestedFrom(found.source);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Could not suggest a note");
    } finally {
      setSuggesting(false);
    }
  };

  useEffect(() => {
    void suggest(false);
    // Runs once when the drawer opens for this patient and report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, runId]);

  const save = async () => {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await addNote(patientId, text.trim(), runId);
      setNotes((current) => [saved, ...current]);
      setText("");
      setSuggestedFrom(null);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Could not save the note");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: string) => {
    setRemovingId(noteId);
    setError("");
    try {
      await deleteNote(noteId);
      setNotes((current) => current.filter((note) => note.note_id !== noteId));
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "Could not delete the note");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold leading-[26px] tracking-[-0.09px] text-ink">Patient notes</h2>
          <p className="text-[11px] tracking-[0.055px] text-secondary">For {patientName} · only you see these</p>
        </div>
        <button type="button" onClick={onClose} className={`${button.icon} text-lg leading-none`} aria-label="Close notes">
          ×
        </button>
      </header>
      <p className="rounded-md border border-cleared-border bg-cleared-bg px-2.5 py-2 text-[11px] leading-4 tracking-[0.055px] text-cleared-fg">Your own notes, never sent to the patient. Mishti writes the starting bullets from this report and never reads what you save.</p>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium tracking-[0.06px] text-accent">NEW NOTE</h3>
          {suggesting ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-[0.055px] text-violet">
              <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-violet border-t-transparent" />
              Writing what to remember
            </span>
          ) : (
            runId && (
              <button type="button" onClick={() => void suggest(true)} className={button.small}>
                {suggestedFrom ? "Suggest again" : "Suggest from report"}
              </button>
            )
          )}
        </div>
        <textarea
          value={text}
          aria-busy={suggesting}
          maxLength={8000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void save();
          }}
          placeholder={suggesting ? "" : "What do you want to remember about this chart?"}
          className={`h-[168px] w-full resize-none rounded-xl border bg-surface p-3.5 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-violet ${suggesting ? "animate-pulse border-violet" : "border-line"}`}
        />
        {suggestedFrom && text.trim() && (
          <p className="text-[11px] leading-4 tracking-[0.055px] text-muted">{suggestedFrom === "model" ? "Suggested by Mishti from this report. Edit it before you save." : "Copied from this report because Mishti did not respond. Edit it before you save."}</p>
        )}
        <button type="button" disabled={!text.trim() || saving} onClick={() => void save()} className={`${button.primary} w-full`}>
          {saving ? "Saving…" : "Save note"}
        </button>
        {error && <p className="text-[11px] leading-4 tracking-[0.055px] text-blocked-fg">{error}</p>}
      </section>
      <section className="space-y-2">
        <h3 className="text-xs font-medium tracking-[0.06px] text-accent">SAVED NOTES{notes.length ? ` · ${notes.length}` : ""}</h3>
        {loading ? (
          <div className="space-y-2">
            {["100%", "100%"].map((width, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-neutral-100" style={{ width }} />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm leading-5 text-muted">No notes on this patient yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.note_id} className="rounded-lg border border-line px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] tracking-[0.055px] text-muted">
                    {when(note.created_at)}
                    {note.run_id && note.run_id === runId ? " · this report" : ""}
                    {note.source === "voice" ? " · by voice" : ""}
                  </p>
                  <button type="button" disabled={removingId === note.note_id} onClick={() => void remove(note.note_id)} className={button.small}>
                    {removingId === note.note_id ? "Deleting…" : "Delete"}
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-ink">{note.text}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
