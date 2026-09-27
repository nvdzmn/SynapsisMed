"""Adapter for a Synthea CSV export; absent fields get deterministic demo values."""
from __future__ import annotations
import csv
from pathlib import Path

def _rows(path: Path) -> list[dict]:
    return list(csv.DictReader(path.open())) if path.exists() else []

def load_synthea_csv(directory: Path) -> list[dict]:
    patients = _rows(directory / "patients.csv")
    if not patients: return []
    conditions, observations, medications = _rows(directory / "conditions.csv"), _rows(directory / "observations.csv"), _rows(directory / "medications.csv")
    grouped = {"conditions": conditions, "observations": observations, "medications": medications}
    index = {kind: {} for kind in grouped}
    for kind, rows in grouped.items():
        for row in rows: index[kind].setdefault(row.get("PATIENT"), []).append(row)
    result = []
    for i, row in enumerate(patients):
        pid = row.get("Id") or row.get("ID"); conds = [item.get("DESCRIPTION", "") for item in index["conditions"].get(pid, [])]
        metrics = {}; units = {}
        for obs in index["observations"].get(pid, []):
            name, value = obs.get("DESCRIPTION", ""), obs.get("VALUE", "")
            key = "eGFR" if "glomerular filtration" in name.lower() else "Blood_Eosinophils" if "eosinophil" in name.lower() else None
            if key:
                try: metrics[key] = float(value); units[key] = obs.get("UNITS", "")
                except ValueError: pass
        # Mock only the indicators our demo needs when Synthea did not export them.
        text = " ".join(conds).lower()
        if "asthma" in text: metrics.setdefault("Blood_Eosinophils", 360 + (i % 4) * 55); units.setdefault("Blood_Eosinophils", "cells/µL")
        result.append({"id": f"SYN-{i+1:03d}", "patient_id": f"SYN-{i+1:03d}", "name": f"{row.get('FIRST', 'Synthetic')} {row.get('LAST', 'Patient')}", "age": 45 + (i % 30), "gender": row.get("GENDER", "unknown").title(), "conditions": conds or ["No coded conditions"], "metrics": metrics, "metric_units": units, "current_medications": [item.get("DESCRIPTION", "") for item in index["medications"].get(pid, [])], "synthetic": True, "contact_email": "synthetic-patient@example.invalid"})
    return result
