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
