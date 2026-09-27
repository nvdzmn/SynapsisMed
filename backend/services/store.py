"""Operational persistence for TrialLens.

Railway production uses ``DATABASE_URL`` (PostgreSQL). SQLite remains a
local-only convenience when that variable is absent.
"""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
import sqlite3
from pathlib import Path
from typing import Iterator, Any

from fastapi import HTTPException

DB_PATH = Path(__file__).parents[1] / "data" / "triallens.db"


def uses_postgres() -> bool:
    return bool(os.getenv("DATABASE_URL"))


@contextmanager
def connection() -> Iterator[Any]:
    """Yield a transactional connection for PostgreSQL or local SQLite."""
    if uses_postgres():
        import psycopg
        from psycopg.rows import dict_row

        conn = psycopg.connect(os.environ["DATABASE_URL"], row_factory=dict_row)
    else:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def execute(db: Any, statement: str, params: tuple = ()):  # qmark syntax stays portable in callers.
    if uses_postgres():
        statement = statement.replace("?", "%s")
    return db.execute(statement, params)


SCHEMA = (
    "CREATE TABLE IF NOT EXISTS patients (patient_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synthetic INTEGER NOT NULL DEFAULT 1)",
    "CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS drafts (draft_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, patient_id TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS notes (note_id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL, text TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_notes_patient_id ON notes(patient_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_drafts_run_id ON drafts(run_id)",
)


def initialize() -> None:
    with connection() as db:
        if not uses_postgres():
            execute(db, "PRAGMA journal_mode=WAL")
        for statement in SCHEMA:
            execute(db, statement)
        if uses_postgres():
            columns = {row["name"] for row in execute(db, "SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'notes'").fetchall()}
        else:
            columns = {row["name"] for row in execute(db, "PRAGMA table_info(notes)").fetchall()}
        if "source" not in columns:
            execute(db, "ALTER TABLE notes ADD COLUMN source TEXT NOT NULL DEFAULT 'typed'")


def replace_patients(patients: list[dict]) -> None:
    initialize()
    with connection() as db:
        execute(db, "DELETE FROM patients")
        for item in patients:
            execute(db, "INSERT INTO patients(patient_id, payload, synthetic) VALUES (?, ?, 1)", (item["id"], json.dumps(item)))


def patients() -> list[dict]:
    initialize()
    with connection() as db:
        return [json.loads(row["payload"]) for row in execute(db, "SELECT payload FROM patients ORDER BY patient_id").fetchall()]


def save_run(run: dict) -> None:
    initialize()
    statement = "INSERT INTO runs(run_id, created_at, status, payload) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, payload=excluded.payload"
    with connection() as db:
        execute(db, statement, (run["run_id"], run["created_at"], run["status"], json.dumps(run)))


def latest_completed_run() -> dict | None:
    initialize()
    with connection() as db:
        row = execute(db, "SELECT payload FROM runs WHERE status = 'complete' ORDER BY created_at DESC LIMIT 1").fetchone()
    return json.loads(row["payload"]) if row else None


def completed_runs(limit: int = 40) -> list[dict]:
    initialize()
    with connection() as db:
        rows = execute(db, "SELECT payload FROM runs WHERE status = 'complete' ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
    return [json.loads(row["payload"]) for row in rows]


def get_run(run_id: str) -> dict:
    initialize()
    with connection() as db:
        row = execute(db, "SELECT payload FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    return json.loads(row["payload"])


def save_draft(draft: dict) -> None:
    initialize()
    statement = "INSERT INTO drafts(draft_id, run_id, patient_id, created_at, payload) VALUES (?, ?, ?, ?, ?) ON CONFLICT(draft_id) DO UPDATE SET payload=excluded.payload"
    with connection() as db:
        execute(db, statement, (draft["draft_id"], draft["run_id"], draft["patient_id"], draft["created_at"], json.dumps(draft)))


def get_draft(draft_id: str) -> dict:
    initialize()
    with connection() as db:
        row = execute(db, "SELECT payload FROM drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Draft not found")
    return json.loads(row["payload"])


def add_note(note: dict) -> None:
    initialize()
    with connection() as db:
        execute(db, "INSERT INTO notes(note_id, patient_id, run_id, created_at, text, source) VALUES (?, ?, ?, ?, ?, ?)", (note["note_id"], note["patient_id"], note.get("run_id"), note["created_at"], note["text"], note.get("source") or "typed"))


def notes_for(patient_id: str) -> list[dict]:
    initialize()
    with connection() as db:
        return [dict(row) for row in execute(db, "SELECT note_id, patient_id, run_id, created_at, text, source FROM notes WHERE patient_id = ? ORDER BY created_at DESC", (patient_id,)).fetchall()]


def note_counts() -> dict[str, int]:
    initialize()
    with connection() as db:
        return {row["patient_id"]: row["total"] for row in execute(db, "SELECT patient_id, COUNT(*) AS total FROM notes GROUP BY patient_id").fetchall()}


def delete_note(note_id: str) -> None:
    initialize()
    with connection() as db:
        removed = execute(db, "DELETE FROM notes WHERE note_id = ?", (note_id,)).rowcount
    if not removed:
        raise HTTPException(404, "Note not found")
