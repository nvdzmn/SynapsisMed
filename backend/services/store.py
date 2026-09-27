"""Small SQLite repository for TrialLens v1 operational state."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from fastapi import HTTPException

DB_PATH = Path(__file__).parents[1] / "data" / "triallens.db"

def connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def initialize() -> None:
    with connection() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS patients (
          patient_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS drafts (
          draft_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, patient_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notes (
          note_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL, text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_notes_patient_id ON notes(patient_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_drafts_run_id ON drafts(run_id);
        """)

def replace_patients(patients: list[dict]) -> None:
    initialize()
    with connection() as db:
        db.execute("DELETE FROM patients")
        db.executemany("INSERT INTO patients(patient_id, payload, synthetic) VALUES (?, ?, 1)", [(item["id"], json.dumps(item),) for item in patients])

def patients() -> list[dict]:
    initialize()
    with connection() as db:
        return [json.loads(row["payload"]) for row in db.execute("SELECT payload FROM patients ORDER BY patient_id")]

def save_run(run: dict) -> None:
    initialize()
    with connection() as db:
        db.execute("INSERT INTO runs(run_id, created_at, status, payload) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, payload=excluded.payload", (run["run_id"], run["created_at"], run["status"], json.dumps(run)))

def latest_completed_run() -> dict | None:
    initialize()
    with connection() as db:
        row = db.execute("SELECT payload FROM runs WHERE status = 'complete' ORDER BY created_at DESC LIMIT 1").fetchone()
    return json.loads(row["payload"]) if row else None

def completed_runs(limit: int = 40) -> list[dict]:
    initialize()
    with connection() as db:
        rows = db.execute("SELECT payload FROM runs WHERE status = 'complete' ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(row["payload"]) for row in rows]

def get_run(run_id: str) -> dict:
    initialize()
    with connection() as db:
        row = db.execute("SELECT payload FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if not row: raise HTTPException(404, "Run not found")
    return json.loads(row["payload"])

def save_draft(draft: dict) -> None:
    initialize()
    with connection() as db:
        db.execute("INSERT INTO drafts(draft_id, run_id, patient_id, created_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(draft_id) DO UPDATE SET payload=excluded.payload", (draft["draft_id"], draft["run_id"], draft["patient_id"], draft["created_at"], json.dumps(draft)))

def get_draft(draft_id: str) -> dict:
    initialize()
    with connection() as db:
        row = db.execute("SELECT payload FROM drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if not row: raise HTTPException(404, "Draft not found")
    return json.loads(row["payload"])

def add_note(note: dict) -> None:
    """The physician's own notes on a patient. They are never sent to the patient or to a model."""
    initialize()
    with connection() as db:
        db.execute("INSERT INTO notes(note_id, patient_id, run_id, created_at, text) VALUES (?, ?, ?, ?, ?)", (note["note_id"], note["patient_id"], note.get("run_id"), note["created_at"], note["text"]))

def notes_for(patient_id: str) -> list[dict]:
    initialize()
    with connection() as db:
        return [dict(row) for row in db.execute("SELECT note_id, patient_id, run_id, created_at, text FROM notes WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,))]

def note_counts() -> dict[str, int]:
    initialize()
    with connection() as db:
        return {row["patient_id"]: row["total"] for row in db.execute("SELECT patient_id, COUNT(*) AS total FROM notes GROUP BY patient_id")}

def delete_note(note_id: str) -> None:
    initialize()
    with connection() as db:
        removed = db.execute("DELETE FROM notes WHERE note_id = ?", (note_id,)).rowcount
    if not removed: raise HTTPException(404, "Note not found")
